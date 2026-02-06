import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Forward messages from another session into your current chat. " +
    "This copies the messages directly into your conversation so the user can see them — " +
    "without you having to read and retype them. Use this after read_messages when you want " +
    "to share a child session's output with the user. " +
    "The messages appear as quoted blocks attributed to the source session.",
  args: {
    session_id: tool.schema
      .string()
      .describe("The source session ID to forward messages from"),
    limit: tool.schema
      .number()
      .optional()
      .describe("Maximum number of messages to forward (default 20)"),
    after: tool.schema
      .string()
      .optional()
      .describe(
        "ISO timestamp cursor — only forward messages after this time (for pagination)",
      ),
  },
  async execute(args) {
    try {
      const res = await fetch("http://localhost:9000/api/forward-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: args.session_id,
          limit: args.limit,
          after: args.after,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to forward messages: ${errText}`
      }

      const data = (await res.json()) as {
        count: number
        sourceSessionId: string
      }

      if (data.count === 0) {
        return "No messages to forward from this session."
      }

      return `Forwarded ${data.count} message(s) from session ${data.sourceSessionId.slice(0, 8)}... into the chat. The user can now see them.`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to forward messages: ${msg}`
    }
  },
})
