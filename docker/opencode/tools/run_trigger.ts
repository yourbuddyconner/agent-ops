import { tool } from "@opencode-ai/plugin"
import { z } from "zod"

function parseJsonObject(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "JSON must be an object." }
    }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `Invalid JSON: ${message}` }
  }
}

export default tool({
  description:
    "Run a trigger immediately by trigger ID. " +
    "For schedule target=orchestrator triggers, this dispatches the configured prompt to orchestrator.",
  args: {
    trigger_id: z.string().min(1).describe("Trigger ID"),
    variables_json: z.string().optional().describe("Optional JSON object for manual runtime variables"),
  },
  async execute(args) {
    try {
      let variables: Record<string, unknown> | undefined
      if (args.variables_json && args.variables_json.trim().length > 0) {
        const parsed = parseJsonObject(args.variables_json)
        if (!parsed.ok) {
          return `Failed to run trigger: invalid variables_json. ${parsed.error}`
        }
        variables = parsed.value
      }

      const res = await fetch(`http://localhost:9000/api/triggers/${args.trigger_id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variables,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to run trigger: ${errText}`
      }

      const data = (await res.json()) as Record<string, unknown>
      return JSON.stringify(data, null, 2)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to run trigger: ${msg}`
    }
  },
})
