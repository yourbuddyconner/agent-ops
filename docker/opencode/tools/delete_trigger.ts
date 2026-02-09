import { tool } from "@opencode-ai/plugin"
import { z } from "zod"

export default tool({
  description: "Delete a trigger by ID.",
  args: {
    trigger_id: z.string().min(1).describe("Trigger ID"),
  },
  async execute(args) {
    const endpoint = `http://localhost:9000/api/triggers/${encodeURIComponent(args.trigger_id)}`

    // Use curl subprocess to avoid Bun fetch() connection reuse bugs
    // that cause "socket connection was closed unexpectedly" errors.
    const proc = Bun.spawn(["curl", "-sf", "-X", "DELETE", "-H", "Content-Type: application/json", endpoint], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const exitCode = await proc.exited

    if (exitCode !== 0) {
      const detail = stderr.trim() || stdout.trim() || `curl exit code ${exitCode}`
      return `Failed to delete trigger: ${detail}`
    }

    try {
      const data = JSON.parse(stdout)
      if (data.error) {
        return `Failed to delete trigger: ${data.error}`
      }
    } catch {
      // Non-JSON response is fine — success with no body
    }

    return `Trigger deleted: ${args.trigger_id}`
  },
})
