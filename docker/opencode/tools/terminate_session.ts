import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Terminate a child session that you previously spawned. " +
    "Use this to stop a child agent that is no longer needed, stuck, or has gone off track. " +
    "You can only terminate sessions that are direct children of your own session.",
  args: {
    session_id: tool.schema
      .string()
      .describe("The session ID of the child session to terminate (returned by spawn_session)"),
  },
  async execute(args) {
    try {
      const res = await fetch("http://localhost:9000/api/terminate-child", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childSessionId: args.session_id }),
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to terminate child session: ${errText}`
      }

      return `Child session ${args.session_id} terminated successfully.`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to terminate child session: ${msg}`
    }
  },
})
