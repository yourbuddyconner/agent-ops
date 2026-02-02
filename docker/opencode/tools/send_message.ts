import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Send a message or prompt to another agent session. The message is queued as a user prompt in the target session. " +
    "Use this to give follow-up instructions to child sessions you spawned, or to communicate with sibling sessions. " +
    "Only works with sessions belonging to the same user.",
  args: {
    session_id: tool.schema
      .string()
      .describe("The target session ID to send the message to"),
    message: tool.schema
      .string()
      .describe("The message content to send as a prompt to the target session"),
    interrupt: tool.schema
      .boolean()
      .optional()
      .describe("If true, abort the target session's current work before delivering this message. Default: false (message is queued)."),
  },
  async execute(args) {
    try {
      const res = await fetch("http://localhost:9000/api/session-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: args.session_id,
          content: args.message,
          interrupt: args.interrupt ?? false,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to send message: ${errText}`
      }

      return `Message sent to session ${args.session_id}`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to send message: ${msg}`
    }
  },
})
