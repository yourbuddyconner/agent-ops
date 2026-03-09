import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "List all skills attached to a persona. Shows which skills will be automatically loaded " +
    "when a session starts with this persona.",
  args: {
    personaId: tool.schema.string().describe("Persona ID to list skills for"),
  },
  async execute(args) {
    if (!args.personaId?.trim()) return "Error: personaId is required"

    try {
      const res = await fetch(
        `http://localhost:9000/api/personas/${args.personaId}/skills`,
        { headers: { "Content-Type": "application/json" } }
      )

      if (!res.ok) {
        if (res.status === 404) return "Persona not found."
        const errText = await res.text()
        return `Failed to list persona skills: ${errText}`
      }

      const data = (await res.json()) as {
        skills: Array<{
          id: string
          name: string
          slug: string
          description: string | null
          source: string
          visibility: string
          sortOrder: number
        }>
      }

      if (data.skills.length === 0) {
        return "No skills attached to this persona."
      }

      const lines = data.skills.map(
        (s) =>
          `- **${s.name}** (${s.source}, order: ${s.sortOrder}) [id: ${s.id}]\n  ${s.description || "No description"}`
      )
      return `${data.skills.length} skill(s) attached:\n\n${lines.join("\n\n")}`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to list persona skills: ${msg}`
    }
  },
})
