import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Read messages from another agent session's conversation. Returns recent messages including both user prompts and assistant responses. " +
    "Use this to check on a child session's progress, read its results, or monitor what it's working on. " +
    "Only works with sessions belonging to the same user.",
  args: {
    session_id: tool.schema
      .string()
      .describe("The target session ID to read messages from"),
    limit: tool.schema
      .number()
      .optional()
      .describe("Maximum number of messages to return (default 20)"),
    after: tool.schema
      .string()
      .optional()
      .describe("ISO timestamp cursor — only return messages after this time (for pagination)"),
  },
  async execute(args) {
    try {
      const params = new URLSearchParams({ sessionId: args.session_id })
      if (args.limit) params.set("limit", String(args.limit))
      if (args.after) params.set("after", args.after)

      const res = await fetch(
        `http://localhost:9000/api/session-messages?${params}`,
      )

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to read messages: ${errText}`
      }

      const data = (await res.json()) as {
        messages: Array<{ role: string; content: string; createdAt: string }>
      }

      if (!data.messages || data.messages.length === 0) {
        return "No messages found in this session."
      }

      return JSON.stringify(data.messages, null, 2)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to read messages: ${msg}`
    }
  },
})
