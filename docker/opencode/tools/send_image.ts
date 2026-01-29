import { tool } from "@opencode-ai/plugin"
import { readFileSync, existsSync } from "fs"
import { extname } from "path"

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
}

function getMimeType(path: string): string {
  const ext = extname(path).toLowerCase()
  return MIME_TYPES[ext] || "image/png"
}

export default tool({
  description:
    "Send an image to the user's chat UI. The image will be displayed inline in the conversation. " +
    "Accepts a local file path (e.g. /tmp/screenshot.png, /workspace/diagram.png) or a URL (http/https). " +
    "Use this whenever you want the user to see an image — screenshots, generated charts, downloaded images, etc.",
  args: {
    source: tool.schema
      .string()
      .describe(
        "Path to a local image file (e.g. /tmp/screenshot.png) or an HTTP/HTTPS URL to fetch",
      ),
    caption: tool.schema
      .string()
      .optional()
      .describe("Optional caption to display with the image"),
  },
  async execute(args) {
    const { source, caption } = args
    const label = caption || "Image"

    // Handle URL sources
    if (source.startsWith("http://") || source.startsWith("https://")) {
      try {
        const res = await fetch(source)
        if (!res.ok) {
          return `Failed to fetch image from ${source}: HTTP ${res.status}`
        }

        const contentType = res.headers.get("content-type") || "image/png"
        const mime = contentType.split(";")[0].trim()
        const buffer = await res.arrayBuffer()
        const base64 = Buffer.from(buffer).toString("base64")

        await fetch("http://localhost:9000/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data: base64,
            description: label,
            mimeType: mime,
          }),
        })

        return `Image sent to chat.`
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return `Failed to fetch image from ${source}: ${msg}`
      }
    }

    // Handle local file sources
    if (!existsSync(source)) {
      return `File not found: ${source}`
    }

    try {
      const data = readFileSync(source)
      const mime = getMimeType(source)
      const base64 = data.toString("base64")

      await fetch("http://localhost:9000/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: base64,
          description: label,
          mimeType: mime,
        }),
      })

      return `Image sent to chat.`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to read image file ${source}: ${msg}`
    }
  },
})
