import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Send a message to your parent session (the orchestrator or session that spawned you). " +
    "Use this to report progress, deliver results, ask for clarification, or flag blockers. " +
    "The message is queued as a user prompt in the parent session. " +
    "Only available in child sessions — orchestrators and top-level sessions do not have a parent.",
  args: {
    message: tool.schema
      .string()
      .describe("The message to send to your parent session"),
    interrupt: tool.schema
      .boolean()
      .optional()
      .describe("If true, abort the parent's current work before delivering. Default: false (message is queued)."),
  },
  async execute(args) {
    const parentSessionId = process.env.PARENT_SESSION_ID
    if (!parentSessionId) {
      return "No parent session — this is a top-level session. Use send_message with a specific session ID instead."
    }

    try {
      const res = await fetch("http://localhost:9000/api/session-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: parentSessionId,
          content: args.message,
          interrupt: args.interrupt ?? false,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to notify parent: ${errText}`
      }

      return `Message sent to parent session (${parentSessionId})`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to notify parent: ${msg}`
    }
  },
})
