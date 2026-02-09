import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Send a reply to a specific channel (e.g. Telegram, Slack). Use this when a user's message came " +
    "from an external channel (indicated by [via <channelType> | chatId: <id>] prefix) and you want " +
    "to respond on that same channel. The response will be delivered directly to the user on the " +
    "originating platform.",
  args: {
    channel_type: tool.schema
      .enum(["telegram", "slack"])
      .describe("The channel type to reply on (e.g. 'telegram')"),
    channel_id: tool.schema
      .string()
      .describe("The channel/chat identifier (e.g. Telegram chatId from the message prefix)"),
    message: tool.schema
      .string()
      .describe("The message text to send back on the channel"),
  },
  async execute(args) {
    if (!args.channel_type || !args.channel_id || !args.message?.trim()) {
      return "Error: channel_type, channel_id, and message are all required"
    }

    try {
      const res = await fetch("http://localhost:9000/api/channel-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelType: args.channel_type,
          channelId: args.channel_id,
          message: args.message,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to send channel reply: ${errText}`
      }

      const data = (await res.json()) as { success: boolean }
      return data.success
        ? `Reply sent to ${args.channel_type} (${args.channel_id})`
        : `Channel reply failed`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to send channel reply: ${msg}`
    }
  },
})
