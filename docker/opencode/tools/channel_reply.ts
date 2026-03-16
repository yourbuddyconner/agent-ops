import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Send a reply to a specific channel (e.g. Telegram, Slack). Use this when a user's message came " +
    "from an external channel (indicated by [via <channelType> | chatId: <id>] prefix) and you want " +
    "to respond on that same channel. The response will be delivered directly to the user on the " +
    "originating platform. You can optionally attach an image or file.",
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
    file_path: tool.schema
      .string()
      .optional()
      .describe("Absolute path to a file to attach (any type: PDF, CSV, ZIP, etc.)"),
    file_name: tool.schema
      .string()
      .optional()
      .describe("Override the filename shown to the recipient (defaults to the basename of file_path)"),
    follow_up: tool.schema
      .boolean()
      .optional()
      .describe(
        "Controls whether this reply clears the follow-up reminder timer. Defaults to true. " +
        "IMPORTANT: For most replies, you do NOT need to set this — just omit it and the default (true) " +
        "will mark the conversation as handled. Only set follow_up=false when you are sending a brief " +
        "acknowledgment AND you plan to do async/deferred work (spawning a child session, long research, etc.) " +
        "before sending a real answer later. If your reply IS the answer (even a short one like 'Hey, how can I help?'), " +
        "leave follow_up unset or set it to true so the reminder timer is cleared."
      ),
  },
  async execute(args) {
    if (!args.channel_type || !args.channel_id || (!args.message?.trim() && !args.image_path && !args.file_path)) {
      return "Error: channel_type, channel_id, and either message, image_path, or file_path are required"
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

      if (args.file_path) {
        const fs = await import("fs")
        const path = await import("path")
        if (!fs.existsSync(args.file_path)) {
          return `Error: file not found: ${args.file_path}`
        }
        const data = fs.readFileSync(args.file_path)
        payload.fileBase64 = Buffer.from(data).toString("base64")

        const ext = args.file_path.split(".").pop()?.toLowerCase()
        const fileMimeMap: Record<string, string> = {
          pdf: "application/pdf",
          csv: "text/csv",
          zip: "application/zip",
          json: "application/json",
          txt: "text/plain",
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          webp: "image/webp",
        }
        payload.fileMimeType = fileMimeMap[ext || ""] || "application/octet-stream"
        payload.fileName = args.file_name || path.basename(args.file_path)
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
      const what = args.file_path ? "File reply" : args.image_path ? "Image reply" : "Reply"
      return resData.success
        ? `${what} sent to ${args.channel_type} (${args.channel_id})`
        : `Channel reply failed`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to send channel reply: ${msg}`
    }
  },
})
