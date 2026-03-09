import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Detach a skill from a persona. The skill will no longer be loaded when sessions start " +
    "with this persona. Only the persona creator can modify attachments.",
  args: {
    personaId: tool.schema.string().describe("Persona ID to detach the skill from"),
    skillId: tool.schema.string().describe("Skill ID to detach"),
  },
  async execute(args) {
    if (!args.personaId?.trim()) return "Error: personaId is required"
    if (!args.skillId?.trim()) return "Error: skillId is required"

    try {
      const res = await fetch(
        `http://localhost:9000/api/personas/${args.personaId}/skills/${args.skillId}`,
        { method: "DELETE", headers: { "Content-Type": "application/json" } }
      )

      if (!res.ok) {
        if (res.status === 404) return "Persona or skill attachment not found."
        if (res.status === 403) return "Only the persona creator can modify attachments."
        const errText = await res.text()
        return `Failed to detach skill: ${errText}`
      }

      return `Skill ${args.skillId} detached from persona ${args.personaId}.`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to detach skill: ${msg}`
    }
  },
})
