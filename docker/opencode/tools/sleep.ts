import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Pause execution for a specified duration. Use this when you need to wait before checking " +
    "on a child session's progress, poll for results, or give a task time to complete. " +
    "This keeps the agent loop alive (preventing idle timeout) while waiting.",
  args: {
    seconds: tool.schema
      .number()
      .describe("Number of seconds to sleep (1-300)"),
    reason: tool.schema
      .string()
      .optional()
      .describe("Why you are sleeping (shown to the user while waiting)"),
  },
  async execute(args) {
    const seconds = Math.max(1, Math.min(300, Math.round(args.seconds)))

    await new Promise((resolve) => setTimeout(resolve, seconds * 1000))

    return `Slept for ${seconds} seconds.${args.reason ? ` Reason: ${args.reason}` : ""}`
  },
})
