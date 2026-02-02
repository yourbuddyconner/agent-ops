import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Report the current git state (branch, base branch, commit count) to the platform. " +
    "Call this after checking out a new branch, making commits, or any significant git operation " +
    "so the session UI stays up to date.",
  args: {
    branch: tool.schema
      .string()
      .optional()
      .describe("The current git branch name"),
    base_branch: tool.schema
      .string()
      .optional()
      .describe("The base branch this branch was created from (e.g. 'main')"),
    commit_count: tool.schema
      .number()
      .optional()
      .describe("Number of commits ahead of the base branch"),
  },
  async execute(args) {
    try {
      const res = await fetch("http://localhost:9000/api/git-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch: args.branch,
          base_branch: args.base_branch,
          commit_count: args.commit_count,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to report git state: ${errText}`
      }

      const parts: string[] = []
      if (args.branch) parts.push(`branch=${args.branch}`)
      if (args.base_branch) parts.push(`base=${args.base_branch}`)
      if (args.commit_count !== undefined) parts.push(`commits=${args.commit_count}`)

      return `Git state reported: ${parts.join(", ") || "ok"}`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to report git state: ${msg}`
    }
  },
})
