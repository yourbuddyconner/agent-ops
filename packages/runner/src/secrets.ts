/**
 * Secrets orchestrator — provider-agnostic secret resolution.
 *
 * Detects configured providers from env vars, routes references to the
 * correct provider, and provides file injection + command execution with
 * secret masking. Actual secret values never leave this module's return
 * boundary unmasked.
 */

// ─── Provider Interface ─────────────────────────────────────────────────

export interface SecretListEntry {
  provider: string;
  vault: string;
  item: string;
  reference: string;
  fields?: { label: string; reference: string }[];
}

export interface SecretsProvider {
  readonly name: string;
  readonly referencePattern: RegExp;

  initialize(): Promise<void>;
  listSecrets(options?: { vaultId?: string }): Promise<SecretListEntry[]>;
  resolveSecret(reference: string): Promise<string>;
}

// ─── Provider Registry ──────────────────────────────────────────────────

let cachedProviders: SecretsProvider[] | null = null;

export async function getConfiguredProviders(): Promise<SecretsProvider[]> {
  if (cachedProviders) return cachedProviders;

  const providers: SecretsProvider[] = [];

  if (process.env.OP_SERVICE_ACCOUNT_TOKEN) {
    const { OnePasswordProvider } = await import("./onepassword-provider.js");
    const provider = new OnePasswordProvider();
    await provider.initialize();
    providers.push(provider);
  }

  cachedProviders = providers;
  return providers;
}

export async function isConfigured(): Promise<boolean> {
  const providers = await getConfiguredProviders();
  return providers.length > 0;
}

// ─── List Secrets ───────────────────────────────────────────────────────

export async function listSecrets(vaultId?: string): Promise<SecretListEntry[]> {
  const providers = await getConfiguredProviders();
  const results: SecretListEntry[] = [];

  for (const provider of providers) {
    const entries = await provider.listSecrets(vaultId ? { vaultId } : undefined);
    results.push(...entries);
  }

  return results;
}

// ─── Resolve Secrets ────────────────────────────────────────────────────

export async function resolveSecrets(refs: string[]): Promise<Map<string, string>> {
  const providers = await getConfiguredProviders();
  const results = new Map<string, string>();

  for (const ref of refs) {
    let resolved = false;
    for (const provider of providers) {
      // Reset lastIndex for global regex
      provider.referencePattern.lastIndex = 0;
      if (provider.referencePattern.test(ref)) {
        try {
          const value = await provider.resolveSecret(ref);
          results.set(ref, value);
        } catch (err) {
          console.error(`[Secrets] Failed to resolve ${ref}:`, err);
          results.set(ref, `[RESOLUTION_FAILED: ${ref}]`);
        }
        resolved = true;
        break;
      }
    }
    if (!resolved) {
      results.set(ref, `[RESOLUTION_FAILED: ${ref}]`);
    }
  }

  return results;
}

// ─── Find References ────────────────────────────────────────────────────

function findAllReferences(text: string, providers: SecretsProvider[]): string[] {
  const refs = new Set<string>();
  for (const provider of providers) {
    const pattern = new RegExp(provider.referencePattern.source, "g");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      refs.add(match[0]);
    }
  }
  return Array.from(refs);
}

// ─── File Injection ─────────────────────────────────────────────────────

export async function injectSecretsIntoFile(
  templatePath: string,
  outputPath: string,
): Promise<{ secretCount: number; outputPath: string; errors: string[] }> {
  const providers = await getConfiguredProviders();
  const errors: string[] = [];

  const templateFile = Bun.file(templatePath);
  if (!(await templateFile.exists())) {
    throw new Error(`Template file not found: ${templatePath}`);
  }

  let content = await templateFile.text();
  const refs = findAllReferences(content, providers);

  if (refs.length === 0) {
    await Bun.write(outputPath, content, { mode: 0o600 });
    return { secretCount: 0, outputPath, errors: [] };
  }

  const resolved = await resolveSecrets(refs);
  let secretCount = 0;

  for (const [ref, value] of resolved) {
    if (value.startsWith("[RESOLUTION_FAILED:")) {
      errors.push(`Failed to resolve: ${ref}`);
    } else {
      content = content.split(ref).join(value);
      secretCount++;
    }
  }

  await Bun.write(outputPath, content, { mode: 0o600 });

  // chmod 600 — Bun.write mode may not work on all platforms
  const { spawnSync } = await import("child_process");
  spawnSync("chmod", ["600", outputPath]);

  return { secretCount, outputPath, errors };
}

// ─── Run With Secrets ───────────────────────────────────────────────────

export interface RunWithSecretsResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export async function runWithSecrets(
  command: string,
  envMap: Record<string, string>,
  options?: { cwd?: string; timeout?: number },
): Promise<RunWithSecretsResult> {
  const timeout = options?.timeout ?? 60_000;

  // Collect all references from env values
  const refs = Object.values(envMap).filter((v) => {
    // Only resolve values that look like provider references
    return v.startsWith("op://");
  });

  const resolved = refs.length > 0 ? await resolveSecrets(refs) : new Map<string, string>();

  // Build env with resolved secrets
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  const secretValues: string[] = [];

  for (const [key, value] of Object.entries(envMap)) {
    const resolvedValue = resolved.get(value);
    if (resolvedValue && !resolvedValue.startsWith("[RESOLUTION_FAILED:")) {
      env[key] = resolvedValue;
      secretValues.push(resolvedValue);
    } else {
      env[key] = value;
    }
  }

  // Spawn the command
  let timedOut = false;
  const proc = Bun.spawn(["bash", "-c", command], {
    env,
    cwd: options?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Set up timeout
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeout);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  await proc.exited;
  clearTimeout(timer);

  // Mask secret values in output
  const maskedStdout = maskSecrets(stdout, secretValues);
  const maskedStderr = maskSecrets(stderr, secretValues);

  return {
    exitCode: proc.exitCode ?? 1,
    stdout: maskedStdout,
    stderr: maskedStderr,
    timedOut,
  };
}

// ─── Fill Browser Field ──────────────────────────────────────────────

export interface FillBrowserFieldResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export async function fillBrowserField(
  selector: string,
  secretRef: string,
  options?: { timeout?: number },
): Promise<FillBrowserFieldResult> {
  if (!selector || !selector.trim()) {
    throw new Error("selector must be a non-empty string");
  }
  if (!secretRef || !secretRef.startsWith("op://")) {
    throw new Error("secret_ref must be a valid op:// reference");
  }

  const timeout = options?.timeout ?? 30_000;

  // Resolve the single secret reference
  const resolved = await resolveSecrets([secretRef]);
  const secretValue = resolved.get(secretRef);
  if (!secretValue || secretValue.startsWith("[RESOLUTION_FAILED:")) {
    throw new Error(`Failed to resolve secret: ${secretRef}`);
  }

  // Spawn agent-browser with args array (no shell) to avoid special char expansion
  let timedOut = false;
  const proc = Bun.spawn(["agent-browser", "--headed", "fill", selector, secretValue], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeout);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  await proc.exited;
  clearTimeout(timer);

  // Mask the secret value in any output
  const maskedStdout = maskSecrets(stdout, [secretValue]);
  const maskedStderr = maskSecrets(stderr, [secretValue]);

  return {
    exitCode: proc.exitCode ?? 1,
    stdout: maskedStdout,
    stderr: maskedStderr,
    timedOut,
  };
}

// ─── Secret Masking ─────────────────────────────────────────────────────

export function maskSecrets(text: string, secrets: string[]): string {
  if (!text || secrets.length === 0) return text;

  // Filter out very short values to avoid over-redacting
  const meaningful = secrets.filter((s) => s.length >= 3);

  // Sort longest-first to prevent partial matches
  const sorted = [...meaningful].sort((a, b) => b.length - a.length);

  let result = text;
  for (const secret of sorted) {
    // Use split/join — safe against regex special chars in secrets
    result = result.split(secret).join("[REDACTED]");
  }

  return result;
}
