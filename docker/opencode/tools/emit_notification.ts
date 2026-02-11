import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Emit a persistent notification into the notification queue for a session or user. " +
    "Use this for important async updates such as completions, escalations, or decisions needed while recipients may be offline.",
  args: {
    to_session_id: tool.schema
      .string()
      .optional()
      .describe("Target session ID"),
    to_user_id: tool.schema
      .string()
      .optional()
      .describe("Target user ID"),
    to_handle: tool.schema
      .string()
      .optional()
      .describe("Target orchestrator handle (resolved to a user)"),
    message_type: tool.schema
      .enum(["notification", "question", "escalation", "approval"])
      .optional()
      .describe("Notification type (default: notification)"),
    content: tool.schema
      .string()
      .describe("Notification body"),
    context_session_id: tool.schema
      .string()
      .optional()
      .describe("Optional related session ID"),
    context_task_id: tool.schema
      .string()
      .optional()
      .describe("Optional related task ID"),
    reply_to_id: tool.schema
      .string()
      .optional()
      .describe("Optional root notification/thread ID"),
  },
  async execute(args) {
    if (!args.to_session_id && !args.to_user_id && !args.to_handle) {
      return "Error: must specify at least one of to_session_id, to_user_id, or to_handle"
    }
    if (!args.content?.trim()) {
      return "Error: content is required"
    }

    try {
      const res = await fetch("http://localhost:9000/api/notifications/emit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to_session_id: args.to_session_id,
          to_user_id: args.to_user_id,
          to_handle: args.to_handle,
          message_type: args.message_type,
          content: args.content,
          context_session_id: args.context_session_id,
          context_task_id: args.context_task_id,
          reply_to_id: args.reply_to_id,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to emit notification: ${errText}`
      }

      const data = (await res.json()) as { notificationId?: string; messageId?: string }
      const id = data.notificationId || data.messageId
      return id
        ? `Notification emitted (id: ${id})`
        : "Notification emitted."
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to emit notification: ${msg}`
    }
  },
})
