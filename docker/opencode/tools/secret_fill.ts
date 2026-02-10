import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Fill a browser form field with a secret value without exposing it in the conversation. " +
    "First take a browser snapshot (`agent-browser --headed snapshot -i -c`) to identify the " +
    "target field's selector (e.g. @e7 or a CSS selector), then call this tool with the " +
    "selector and a secret reference (e.g. op://vault/login/password). The secret is typed " +
    "into the field server-side and never appears in chat.",
  args: {
    selector: tool.schema
      .string()
      .describe(
        "Browser element selector for the target field. " +
        "Use an @-ref from a snapshot (e.g. @e7) or a CSS selector (e.g. input[type=password])",
      ),
    secret_ref: tool.schema
      .string()
      .describe(
        "Secret reference URI (e.g. op://vault/item/field). " +
        "Use secret_list to discover available references.",
      ),
    timeout: tool.schema
      .number()
      .optional()
      .describe("Timeout in milliseconds (default: 30000)"),
  },
  async execute(args) {
    try {
      const res = await fetch("http://localhost:9000/api/secrets/fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selector: args.selector,
          secret_ref: args.secret_ref,
          timeout: args.timeout,
        }),
      })

      if (res.status === 501) {
        return "No secrets provider is configured for this sandbox."
      }

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to fill field with secret: ${errText}`
      }

      const data = (await res.json()) as {
        exitCode: number
        stdout: string
        stderr: string
        timedOut: boolean
      }

      if (data.timedOut) {
        return "Fill operation timed out."
      }

      if (data.exitCode !== 0) {
        const parts: string[] = [`Fill failed (exit code ${data.exitCode}).`]
        if (data.stderr) {
          parts.push(`Error: ${data.stderr}`)
        }
        return parts.join("\n")
      }

      return "Secret value filled into the browser field successfully."
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to fill field with secret: ${msg}`
    }
  },
})
