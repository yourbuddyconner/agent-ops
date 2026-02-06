import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Spawn a new autonomous child agent session. The child runs in its own sandbox with the given task as its initial prompt. " +
    "Use this for parallel work: delegating subtasks, working on multiple repos, or fire-and-forget operations. " +
    "The child inherits your environment (API keys, GitHub token, git config). " +
    "Returns the child session ID which you can use with send_message and read_messages to communicate with it.",
  args: {
    task: tool.schema
      .string()
      .describe("The task/prompt for the child agent to work on autonomously"),
    workspace: tool.schema
      .string()
      .describe("Short human-readable workspace name for the child session. Use a simple identifier like the repo name (e.g. 'my-app', 'frontend', 'api-server'). Do NOT use file paths, URLs, or Modal volume paths — just a short name."),
    repo_url: tool.schema
      .string()
      .optional()
      .describe("Git repository URL for the child to clone (optional, inherits parent's repo if not specified)"),
    branch: tool.schema
      .string()
      .optional()
      .describe("Git branch for the child to check out (optional)"),
    title: tool.schema
      .string()
      .optional()
      .describe("Human-readable title for the child session (defaults to workspace name)"),
    source_type: tool.schema
      .enum(["pr", "issue", "branch", "manual"])
      .optional()
      .describe("Source type for the child session (defaults to parent's source type)"),
    source_pr_number: tool.schema
      .number()
      .optional()
      .describe("PR number when the child works on a pull request"),
    source_issue_number: tool.schema
      .number()
      .optional()
      .describe("Issue number when the child works on an issue"),
    source_repo_full_name: tool.schema
      .string()
      .optional()
      .describe("Repository full name as owner/repo (e.g. 'octocat/hello-world')"),
    model: tool.schema
      .string()
      .optional()
      .describe("Model ID for the child session to use (e.g. 'anthropic/claude-sonnet-4-5-20250929'). If not specified, inherits parent's model preferences."),
  },
  async execute(args) {
    if (args.workspace.includes("/")) {
      return `Error: workspace must be a short name (e.g. 'my-app'), not a file path. You provided: "${args.workspace}". Use just the repo name.`
    }

    try {
      const res = await fetch("http://localhost:9000/api/spawn-child", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: args.task,
          workspace: args.workspace,
          repoUrl: args.repo_url,
          branch: args.branch,
          title: args.title || args.workspace,
          sourceType: args.source_type,
          sourcePrNumber: args.source_pr_number,
          sourceIssueNumber: args.source_issue_number,
          sourceRepoFullName: args.source_repo_full_name,
          model: args.model,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to spawn child session: ${errText}`
      }

      const data = (await res.json()) as { childSessionId: string }
      return `Child session spawned: ${data.childSessionId}`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to spawn child session: ${msg}`
    }
  },
})
