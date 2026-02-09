import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Send a reply to a specific channel (e.g. Telegram, Slack). Use this when a user's message came " +
    "from an external channel (indicated by [via <channelType> | chatId: <id>] prefix) and you want " +
    "to respond on that same channel. The response will be delivered directly to the user on the " +
    "originating platform. You can optionally attach an image file.",
  args: {
    channel_type: tool.schema
      .enum(["telegram", "slack"])
      .describe("The channel type to reply on (e.g. 'telegram')"),
    channel_id: tool.schema
      .string()
      .describe("The channel/chat identifier (e.g. Telegram chatId from the message prefix)"),
    message: tool.schema
      .string()
      .describe("The message text to send back on the channel (can be empty when sending an image)"),
    image_path: tool.schema
      .string()
      .optional()
      .describe("Absolute path to an image file to send (PNG, JPEG, GIF, WebP)"),
    follow_up: tool.schema
      .boolean()
      .optional()
      .describe(
        "Set to false if this is just an acknowledgment and you plan to follow up later with a substantive reply. " +
        "The system will remind you to send a substantive reply. Defaults to true (substantive reply that clears the reminder timer)."
      ),
  },
  async execute(args) {
    if (!args.channel_type || !args.channel_id || (!args.message?.trim() && !args.image_path)) {
      return "Error: channel_type, channel_id, and either message or image_path are required"
    }

    try {
      const payload: Record<string, unknown> = {
        channelType: args.channel_type,
        channelId: args.channel_id,
        message: args.message || "",
        followUp: args.follow_up !== false,
      }

      if (args.image_path) {
        const fs = await import("fs")
        if (!fs.existsSync(args.image_path)) {
          return `Error: file not found: ${args.image_path}`
        }
        const data = fs.readFileSync(args.image_path)
        payload.imageBase64 = Buffer.from(data).toString("base64")

        const ext = args.image_path.split(".").pop()?.toLowerCase()
        const mimeMap: Record<string, string> = {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          webp: "image/webp",
        }
        payload.imageMimeType = mimeMap[ext || ""] || "image/jpeg"
      }

      const res = await fetch("http://localhost:9000/api/channel-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to send channel reply: ${errText}`
      }

      const resData = (await res.json()) as { success: boolean }
      const what = args.image_path ? "Image reply" : "Reply"
      return resData.success
        ? `${what} sent to ${args.channel_type} (${args.channel_id})`
        : `Channel reply failed`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to send channel reply: ${msg}`
    }
  },
})
