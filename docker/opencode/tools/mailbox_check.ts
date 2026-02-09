import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Check for unread mailbox messages sent to this session. " +
    "Returns persistent cross-session messages (distinct from session chat history). " +
    "Messages are automatically marked as read after retrieval. " +
    "Use this to check for messages from other agents, the orchestrator, or users.",
  args: {
    limit: tool.schema
      .number()
      .optional()
      .describe("Maximum number of messages to return (default: 50)"),
    after: tool.schema
      .string()
      .optional()
      .describe("Only return messages created after this ISO timestamp"),
  },
  async execute(args) {
    try {
      const params = new URLSearchParams()
      if (args.limit) params.set("limit", String(args.limit))
      if (args.after) params.set("after", args.after)
      const qs = params.toString()

      const res = await fetch(`http://localhost:9000/api/mailbox${qs ? `?${qs}` : ""}`)

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to check mailbox: ${errText}`
      }

      const data = (await res.json()) as { messages: unknown[] }
      if (!data.messages || data.messages.length === 0) {
        return "No unread mailbox messages."
      }
      return JSON.stringify(data.messages, null, 2)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to check mailbox: ${msg}`
    }
  },
})
