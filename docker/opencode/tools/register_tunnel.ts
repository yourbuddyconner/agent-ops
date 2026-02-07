import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Register a tunnel for a local service running in the sandbox. " +
    "This exposes it at /t/<name> through the authenticated gateway so the user can access it.",
  args: {
    name: tool.schema
      .string()
      .describe("Tunnel name (1-32 chars: a-z A-Z 0-9 _ -)"),
    port: tool.schema
      .number()
      .describe("Local port of the service inside the sandbox"),
    protocol: tool.schema
      .string()
      .optional()
      .describe("Protocol hint: http | ws | auto (default: http)"),
  },
  async execute(args) {
    try {
      const res = await fetch("http://localhost:9000/api/tunnels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: args.name,
          port: args.port,
          protocol: args.protocol,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to register tunnel: ${errText}`
      }

      const data = await res.json() as { tunnel?: { name: string; path: string } }
      const path = data.tunnel?.path || `/t/${args.name}`
      return `Tunnel registered: ${args.name} -> ${path}`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to register tunnel: ${msg}`
    }
  },
})
