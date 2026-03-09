import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Attach a skill to a persona. When a session starts with this persona, the attached skills " +
    "are automatically loaded into the agent's context. Only the persona creator can modify attachments.",
  args: {
    personaId: tool.schema.string().describe("Persona ID to attach the skill to"),
    skillId: tool.schema.string().describe("Skill ID to attach (from search_skills or create_skill)"),
    sortOrder: tool.schema
      .number()
      .optional()
      .describe("Sort order for the skill within the persona (default: 0, lower = loaded first)"),
  },
  async execute(args) {
    if (!args.personaId?.trim()) return "Error: personaId is required"
    if (!args.skillId?.trim()) return "Error: skillId is required"

    try {
      const body: Record<string, unknown> = { skillId: args.skillId }
      if (args.sortOrder !== undefined) body.sortOrder = args.sortOrder

      const res = await fetch(
        `http://localhost:9000/api/personas/${args.personaId}/skills`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      )

      if (!res.ok) {
        if (res.status === 404) return "Persona not found."
        if (res.status === 403) return "Only the persona creator can modify attachments."
        const errText = await res.text()
        return `Failed to attach skill: ${errText}`
      }

      return `Skill ${args.skillId} attached to persona ${args.personaId}.`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to attach skill: ${msg}`
    }
  },
})
