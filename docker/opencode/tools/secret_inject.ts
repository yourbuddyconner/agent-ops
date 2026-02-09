import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Inject secrets into a template file. Write a file containing secret references " +
    "(e.g. op://vault/item/field), then call this tool to produce an output file with " +
    "references replaced by actual secret values. The output file is created with " +
    "restricted permissions (chmod 600). " +
    "IMPORTANT: Do NOT read the output file — it contains plaintext secrets.",
  args: {
    template_path: tool.schema
      .string()
      .describe("Absolute path to the template file containing secret references"),
    output_path: tool.schema
      .string()
      .describe("Absolute path where the resolved file should be written"),
  },
  async execute(args) {
    try {
      const res = await fetch("http://localhost:9000/api/secrets/inject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templatePath: args.template_path,
          outputPath: args.output_path,
        }),
      })

      if (res.status === 501) {
        return "No secrets provider is configured for this sandbox."
      }

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to inject secrets: ${errText}`
      }

      const data = (await res.json()) as {
        ok: boolean
        secretCount: number
        outputPath: string
        errors: string[]
      }

      let result = `Injected ${data.secretCount} secret(s) into ${data.outputPath}`
      if (data.errors && data.errors.length > 0) {
        result += `\nWarnings:\n${data.errors.map((e) => `  - ${e}`).join("\n")}`
      }
      return result
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to inject secrets: ${msg}`
    }
  },
})
