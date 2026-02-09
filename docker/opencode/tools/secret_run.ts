import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Run a shell command with secrets injected as environment variables. " +
    "Provide a command and a JSON object mapping env var names to secret references " +
    "(e.g. {\"DB_PASSWORD\": \"op://vault/db/password\"}). The secrets are resolved, " +
    "passed as env vars to the command, and any secret values in stdout/stderr are " +
    "automatically redacted before being returned.",
  args: {
    command: tool.schema
      .string()
      .describe("The shell command to execute"),
    env_json: tool.schema
      .string()
      .describe(
        "JSON string mapping environment variable names to secret references. " +
        "Example: '{\"DB_PASSWORD\": \"op://vault/db/password\", \"API_KEY\": \"op://vault/api/key\"}'",
      ),
    cwd: tool.schema
      .string()
      .optional()
      .describe("Working directory for the command"),
    timeout: tool.schema
      .number()
      .optional()
      .describe("Timeout in milliseconds (default: 60000)"),
  },
  async execute(args) {
    let env: Record<string, string>
    try {
      env = JSON.parse(args.env_json)
    } catch {
      return "Failed to parse env_json — must be a valid JSON object mapping var names to secret references."
    }

    try {
      const res = await fetch("http://localhost:9000/api/secrets/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: args.command,
          env,
          cwd: args.cwd,
          timeout: args.timeout,
        }),
      })

      if (res.status === 501) {
        return "No secrets provider is configured for this sandbox."
      }

      if (!res.ok) {
        const errText = await res.text()
        return `Failed to run command with secrets: ${errText}`
      }

      const data = (await res.json()) as {
        exitCode: number
        stdout: string
        stderr: string
        timedOut: boolean
      }

      const parts: string[] = []
      if (data.timedOut) {
        parts.push("Command timed out.")
      }
      parts.push(`Exit code: ${data.exitCode}`)
      if (data.stdout) {
        parts.push(`stdout:\n${data.stdout}`)
      }
      if (data.stderr) {
        parts.push(`stderr:\n${data.stderr}`)
      }
      return parts.join("\n")
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to run command with secrets: ${msg}`
    }
  },
})
