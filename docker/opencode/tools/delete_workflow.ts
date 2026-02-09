import { tool } from "@opencode-ai/plugin"
import { z } from "zod"

export default tool({
  description: "Delete a workflow by ID or slug.",
  args: {
    workflow_id: z.string().min(1).describe("Workflow ID or slug"),
  },
  async execute(args) {
    try {
      const res = await fetch(`http://localhost:9000/api/workflows/${encodeURIComponent(args.workflow_id)}`, {
        method: "DELETE",
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to delete workflow: ${errText}`
      }

      return `Workflow deleted: ${args.workflow_id}`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to delete workflow: ${msg}`
    }
  },
})
