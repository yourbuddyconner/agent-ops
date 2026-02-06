import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Yield control and wait for the next incoming event. Call this when you have finished " +
    "your current work and are waiting for something external — a child session's notify_parent, " +
    "a user message, or any other prompt. Your turn ends after this tool returns. " +
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
  },
  async execute(args) {
    return (
      `Yielding control.${args.reason ? " Reason: " + args.reason : ""} ` +
      "Your turn is now over — do NOT call any more tools or generate further output. " +
      "You will be re-activated automatically when a notification or message arrives."
    )
  },
})
