import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Unregister a previously registered tunnel by name.",
  args: {
    name: tool.schema
      .string()
      .describe("Tunnel name to remove"),
  },
  async execute(args) {
    try {
      const res = await fetch(`http://localhost:9000/api/tunnels/${encodeURIComponent(args.name)}`, {
        method: "DELETE",
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to unregister tunnel: ${errText}`
      }

      return `Tunnel unregistered: ${args.name}`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to unregister tunnel: ${msg}`
    }
  },
})
