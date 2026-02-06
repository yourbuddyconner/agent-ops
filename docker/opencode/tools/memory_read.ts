import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Read memories from the orchestrator's long-term memory store. " +
    "Memories persist across sessions and sandbox hibernation/wake cycles. " +
    "Use this to recall user preferences, project context, past decisions, and workflows. " +
    "Memories are returned sorted by relevance — frequently accessed memories rank higher.",
  args: {
    category: tool.schema
      .enum(["preference", "workflow", "context", "project", "decision", "general"])
      .optional()
      .describe("Filter by memory category"),
    query: tool.schema
      .string()
      .optional()
      .describe("Search query to filter memories by content"),
    limit: tool.schema
      .number()
      .optional()
      .describe("Maximum number of memories to return (default 20)"),
  },
  async execute(args) {
    try {
      const params = new URLSearchParams()
      if (args.category) params.set("category", args.category)
      if (args.query) params.set("query", args.query)
      if (args.limit) params.set("limit", String(args.limit))

      const qs = params.toString()
      const res = await fetch(
        `http://localhost:9000/api/memories${qs ? `?${qs}` : ""}`,
      )

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to read memories: ${errText}`
      }

      const data = (await res.json()) as { memories: unknown[] }

      if (!data.memories || data.memories.length === 0) {
        return "No memories found."
      }

      return JSON.stringify(data.memories, null, 2)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to read memories: ${msg}`
    }
  },
})
