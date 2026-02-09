import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Create a task on the shared task board. Tasks are scoped to the orchestrator and visible " +
    "to all sessions in the hierarchy. Use this to track work items, coordinate between sessions, " +
    "and maintain a shared view of what needs to be done.",
  args: {
    title: tool.schema
      .string()
      .describe("Short title for the task"),
    description: tool.schema
      .string()
      .optional()
      .describe("Detailed description of what needs to be done"),
    session_id: tool.schema
      .string()
      .optional()
      .describe("Session ID to assign this task to (optional)"),
    parent_task_id: tool.schema
      .string()
      .optional()
      .describe("Parent task ID for subtask hierarchy"),
    blocked_by: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Array of task IDs that must complete before this task can start"),
  },
  async execute(args) {
    if (!args.title?.trim()) {
      return "Error: title is required"
    }

    try {
      const res = await fetch("http://localhost:9000/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: args.title,
          description: args.description,
          session_id: args.session_id,
          parent_task_id: args.parent_task_id,
          blocked_by: args.blocked_by,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to create task: ${errText}`
      }

      const data = (await res.json()) as { task: { id: string; title: string; status: string } }
      return `Task created: ${data.task.id} — "${data.task.title}" (${data.task.status})`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to create task: ${msg}`
    }
  },
})
