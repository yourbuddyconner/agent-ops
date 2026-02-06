import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Write a memory to the orchestrator's long-term memory store. " +
    "Memories persist across sessions and sandbox hibernation/wake cycles. " +
    "Use this to store user preferences, project context, decisions, and workflows. " +
    "There is a 200-memory cap per user — lowest-relevance memories are pruned automatically.",
  args: {
    content: tool.schema
      .string()
      .describe("The memory content to store. Be concise but specific."),
    category: tool.schema
      .enum(["preference", "workflow", "context", "project", "decision", "general"])
      .describe(
        "Category for the memory: 'preference' (user likes/dislikes), " +
        "'workflow' (recurring patterns), 'context' (project-specific knowledge), " +
        "'project' (high-level project info), 'decision' (architectural decisions), " +
        "'general' (anything else)",
      ),
  },
  async execute(args) {
    try {
      const res = await fetch("http://localhost:9000/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: args.content,
          category: args.category,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to write memory: ${errText}`
      }

      const data = (await res.json()) as { memory: { id: string } }
      return `Memory stored (id: ${data.memory.id}, category: ${args.category})`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to write memory: ${msg}`
    }
  },
})
