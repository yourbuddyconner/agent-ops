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
    // Check if the repo already exists (e.g. from snapshot restore or previous boot).
    // Verify it has a valid working tree — a partial clone may have .git/ but no files.
    const { existsSync } = await import("node:fs");
    if (existsSync(`${clonePath}/.git`)) {
      // Repo directory exists — force-populate the working tree.
      // A previous clone may have been interrupted after fetch but before checkout,
      // leaving .git/ populated but the working tree empty. Plain `git checkout`
      // (no args) only restores modified files — it won't create files that were
      // never checked out. `checkout HEAD -- .` forces a full tree write.
      //
      // If a specific ref/branch was requested, check that out instead of HEAD
      // so restored sessions land on the correct revision.
      const target = opts.ref || opts.branch || "HEAD";
      await $`git -C ${clonePath} checkout ${target} -- .`.quiet();
      return { success: true };
    }

    if (opts.branch) {
      await $`git clone --branch ${opts.branch} --single-branch ${opts.repoUrl} ${clonePath}`.quiet();
    } else {
      await $`git clone ${opts.repoUrl} ${clonePath}`.quiet();
    }

    if (opts.ref) {
      await $`git -C ${clonePath} checkout ${opts.ref}`.quiet();
    }

    return { success: true };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
