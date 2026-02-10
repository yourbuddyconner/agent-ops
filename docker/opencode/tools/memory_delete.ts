import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Delete a memory from the orchestrator's long-term memory store by ID. " +
    "Use this when a memory is stale, incorrect, duplicated, or no longer useful.",
  args: {
    memoryId: tool.schema
      .string()
      .min(1)
      .describe("The memory ID to delete."),
  },
  async execute(args) {
    try {
      const encodedId = encodeURIComponent(args.memoryId)
      const res = await fetch(`http://localhost:9000/api/memories/${encodedId}`, {
        method: "DELETE",
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to delete memory: ${errText}`
      }

      const data = (await res.json()) as { success?: boolean }
      if (!data.success) {
        return `Memory not deleted (id: ${args.memoryId})`
      }

      return `Memory deleted (id: ${args.memoryId})`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to delete memory: ${msg}`
    }
  },
})
