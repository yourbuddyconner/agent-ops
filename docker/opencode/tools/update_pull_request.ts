import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Update an existing GitHub pull request's title, body, state, or labels. " +
    "Use this instead of `gh pr edit`. Routes through the platform so the session tracks changes.",
  args: {
    pr_number: tool.schema
      .number()
      .describe("The PR number to update"),
    title: tool.schema
      .string()
      .optional()
      .describe("New title for the PR"),
    body: tool.schema
      .string()
      .optional()
      .describe("New body/description for the PR (markdown)"),
    state: tool.schema
      .enum(["open", "closed"])
      .optional()
      .describe("Set the PR state to 'open' or 'closed'"),
    labels: tool.schema
      .string()
      .optional()
      .describe("Comma-separated list of label names to set on the PR (replaces existing labels)"),
  },
  async execute(args) {
    try {
      const res = await fetch("http://localhost:9000/api/update-pull-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pr_number: args.pr_number,
          title: args.title,
          body: args.body,
          state: args.state,
          labels: args.labels ? args.labels.split(",").map((l) => l.trim()) : undefined,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to update pull request: ${errText}`
      }

      const data = (await res.json()) as { number: number; url: string; title: string; state: string }
      return `PR #${data.number} updated: ${data.url}`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to update pull request: ${msg}`
    }
  },
})
