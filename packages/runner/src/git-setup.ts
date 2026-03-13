import { $ } from "bun";

export async function setupGitConfig(config: Record<string, string>) {
  for (const [key, value] of Object.entries(config)) {
    await $`git config --global ${key} ${value}`.quiet();
  }

  // Set up credential helper pointing to runner gateway
  await $`git config --global credential.helper ${"!f() { curl -s --data-binary @- http://localhost:9000/git/credentials; }; f"}`.quiet();
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
      await $`git clone --depth 1 --branch ${opts.branch} --single-branch ${opts.repoUrl} ${clonePath}`.quiet();
    } else {
      await $`git clone --depth 1 ${opts.repoUrl} ${clonePath}`.quiet();
    }

    if (opts.ref) {
      await $`cd ${clonePath} && git fetch origin ${opts.ref} && git checkout FETCH_HEAD`.quiet();
    }

    return { success: true };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
