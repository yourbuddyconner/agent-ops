import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Create a GitHub pull request for the current branch. This routes through the platform so the session tracks the PR. " +
    "Use this instead of `gh pr create`. You must push the branch to the remote before calling this tool.",
  args: {
    branch: tool.schema
      .string()
      .describe("The head branch name to create the PR from (e.g. 'feature/my-change')"),
    title: tool.schema
      .string()
      .describe("The PR title"),
    body: tool.schema
      .string()
      .optional()
      .describe("The PR body/description (markdown)"),
    base: tool.schema
      .string()
      .optional()
      .describe("The base branch to merge into (defaults to the repo's default branch)"),
  },
  async execute(args) {
    try {
      const res = await fetch("http://localhost:9000/api/create-pull-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch: args.branch,
          title: args.title,
          body: args.body,
          base: args.base,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to create pull request: ${errText}`
      }

      const data = (await res.json()) as { number: number; url: string; title: string; state: string }
      return `PR #${data.number} created: ${data.url}`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to create pull request: ${msg}`
    }
  },
})
