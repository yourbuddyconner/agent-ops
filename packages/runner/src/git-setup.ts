import { $ } from "bun";

// Per-session secret for authenticating git credential helper requests.
// Generated once at setup; verified by the gateway endpoint.
let credentialSecret: string | null = null;

export function getCredentialSecret(): string | null {
  return credentialSecret;
}

export async function setupGitConfig(config: Record<string, string>) {
  for (const [key, value] of Object.entries(config)) {
    await $`git config --global ${key} ${value}`.quiet();
  }

  // Generate a per-session secret to authenticate credential helper requests
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  credentialSecret = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

  // Set up credential helper pointing to runner gateway with secret header
  const helperScript = `!f() { curl -s -H "X-Credential-Secret: ${credentialSecret}" --data-binary @- http://localhost:9000/git/credentials; }; f`;
  await $`git config --global credential.helper ${helperScript}`.quiet();
}

export async function cloneRepo(opts: {
  repoUrl: string;
  branch?: string;
  ref?: string;
  workdir?: string;
}): Promise<{ success: boolean; error?: string }> {
  const workdir = opts.workdir || "/workspace";
  const repoName =
    opts.repoUrl.split("/").pop()?.replace(".git", "") || "repo";
  const clonePath = `${workdir}/${repoName}`;

  try {
    if (opts.branch) {
      await $`git clone --branch ${opts.branch} --single-branch ${opts.repoUrl} ${clonePath}`.quiet();
    } else {
      await $`git clone ${opts.repoUrl} ${clonePath}`.quiet();
    }

    if (opts.ref) {
      await $`cd ${clonePath} && git checkout ${opts.ref}`.quiet();
    }

    return { success: true };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
