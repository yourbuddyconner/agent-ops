import { tool } from "@opencode-ai/plugin"
import { z } from "zod"

export default tool({
  description: "Delete a trigger by ID.",
  args: {
    trigger_id: z.string().min(1).describe("Trigger ID"),
  },
  async execute(args) {
    try {
      const res = await fetch(`http://localhost:9000/api/triggers/${args.trigger_id}`, {
        method: "DELETE",
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to delete trigger: ${errText}`
      }

      return `Trigger deleted: ${args.trigger_id}`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to delete trigger: ${msg}`
    }
  },
})
