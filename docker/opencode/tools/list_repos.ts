import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "List all repositories registered with the organization. " +
    "Returns repo names, URLs, default branches, and any assigned personas. " +
    "Use this to find which repos are available before spawning child sessions.",
  args: {},
  async execute() {
    try {
      const res = await fetch("http://localhost:9000/api/org-repos")

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to list repos: ${errText}`
      }

      const data = (await res.json()) as { repos: unknown[] }

      if (!data.repos || data.repos.length === 0) {
        return "No repositories registered with the organization."
      }

      return JSON.stringify(data.repos, null, 2)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to list repos: ${msg}`
    }
  },
})
