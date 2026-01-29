import { tool } from "@opencode-ai/plugin"
import { readFileSync } from "fs"

export default tool({
  description:
    "Take a screenshot of the current virtual display (what's visible in VNC). The screenshot will be sent to the user's chat UI.",
  args: {
    filename: tool.schema
      .string()
      .optional()
      .describe(
        "Optional filename for the screenshot. Defaults to /tmp/screenshot.png",
      ),
  },
  async execute(args) {
    const filepath = args.filename || "/tmp/screenshot.png"

    // Brief delay to let the display settle (e.g. after a navigation)
    await new Promise((resolve) => setTimeout(resolve, 1000))

    const proc = Bun.spawn(
      ["import", "-display", ":99", "-window", "root", filepath],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, DISPLAY: ":99" },
      },
    )

    const exitCode = await proc.exited

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      return `Failed to take screenshot: ${stderr}`
    }

    // Send image out-of-band via the runner's gateway
    try {
      const data = readFileSync(filepath)
      const base64 = data.toString("base64")

      await fetch("http://localhost:9000/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: base64,
          description: `Screenshot of virtual display`,
          mimeType: "image/png",
        }),
      })
    } catch (e) {
      // Non-fatal — the file is still saved on disk
      const msg = e instanceof Error ? e.message : String(e)
      return `Screenshot saved to ${filepath} but failed to send to chat: ${msg}`
    }

    return `Screenshot saved to ${filepath} and sent to chat.`
  },
})
