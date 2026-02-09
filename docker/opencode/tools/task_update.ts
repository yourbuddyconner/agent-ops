import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Update a task on the shared task board. Use this to change status, record results, " +
    "reassign to a session, or update the description.",
  args: {
    task_id: tool.schema
      .string()
      .describe("ID of the task to update"),
    status: tool.schema
      .enum(["pending", "in_progress", "completed", "failed", "blocked"])
      .optional()
      .describe("New status for the task"),
    result: tool.schema
      .string()
      .optional()
      .describe("Result or output of the task (for completed/failed tasks)"),
    description: tool.schema
      .string()
      .optional()
      .describe("Updated description"),
    session_id: tool.schema
      .string()
      .optional()
      .describe("Reassign the task to a different session"),
    title: tool.schema
      .string()
      .optional()
      .describe("Updated title"),
  },
  async execute(args) {
    if (!args.task_id) {
      return "Error: task_id is required"
    }

    try {
      const res = await fetch(`http://localhost:9000/api/tasks/${encodeURIComponent(args.task_id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: args.status,
          result: args.result,
          description: args.description,
          session_id: args.session_id,
          title: args.title,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to update task: ${errText}`
      }

      const data = (await res.json()) as { task: { id: string; title: string; status: string } }
      return `Task updated: ${data.task.id} — "${data.task.title}" (${data.task.status})`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to update task: ${msg}`
    }
  },
})
