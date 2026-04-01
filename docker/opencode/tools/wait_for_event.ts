import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Yield control and wait for the next incoming event. Call this when you have finished " +
    "your current work and are waiting for something external — a child session's notify_parent, " +
    "a user message, or any other prompt. Your turn ends immediately after this tool returns. " +
    "The next message you receive will be from whoever wakes you (child notification, user, etc.). " +
    "Prefer this over sleep loops when the wait time is unknown or when you expect a child " +
    "to notify you proactively.",
  args: {
    reason: tool.schema
      .string()
      .optional()
      .describe(
        "Brief note about what you're waiting for (e.g. 'Waiting for child session to complete')",
      ),
    session_ids: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe(
        "Optional list of child session IDs to monitor. If omitted, all child sessions are monitored.",
      ),
    notify_on: tool.schema
      .enum(["terminal", "status_change"])
      .optional()
      .describe(
        "Which events should wake you. 'terminal' (default) only fires when a child reaches a terminal status. " +
        "'status_change' fires on any child status transition.",
      ),
    statuses: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe(
        "Optional list of statuses to trigger on (e.g. ['terminated','error']). Overrides notify_on.",
      ),
  },
  async execute(args) {
    // This tool is a pure yield — it returns immediately.
    // The Runner intercepts the completion, records the subscription args,
    // and ends the agent's turn. The DO will wake the agent later with a
    // structured system message when a matching event arrives.
    const parts: string[] = ["Yielding control."]
    if (args.reason) parts.push(`Reason: ${args.reason}`)
    if (args.session_ids?.length) parts.push(`Monitoring sessions: ${args.session_ids.join(", ")}`)
    if (args.notify_on) parts.push(`Notify on: ${args.notify_on}`)
    if (args.statuses?.length) parts.push(`Status filter: ${args.statuses.join(", ")}`)
    parts.push("Your turn is now over — do NOT call any more tools or generate further output.")
    return parts.join(" ")
  },
})
