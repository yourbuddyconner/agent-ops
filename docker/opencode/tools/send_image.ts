import { tool } from "@opencode-ai/plugin"
import { readFileSync, existsSync } from "fs"
import { extname, isAbsolute, resolve } from "path"

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

function resolveSourcePath(source: string): string {
  if (isAbsolute(source)) return source
  const workspaceRoot =
    process.env.WORKSPACE_DIR || process.env.OPENCODE_WORKSPACE || "/workspace"
  return resolve(workspaceRoot, source)
}

function decodeEmbeddedBase64Image(data: Buffer): {
  bytes: Buffer
  mimeType?: string
} | null {
  const text = data.toString("utf8").trim()
  if (!text) return null

  // Support full data URI payloads written to disk.
  const dataUriMatch = text.match(
    /^data:(image\/[a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/=\s]+)$/,
  )
  if (dataUriMatch) {
    try {
      const mimeType = dataUriMatch[1]
      const b64 = dataUriMatch[2].replace(/\s+/g, "")
      return { bytes: Buffer.from(b64, "base64"), mimeType }
    } catch {
      return null
    }
  }

  // Support raw base64 blobs (no data URI prefix).
  const compact = text.replace(/\s+/g, "")
  if (
    compact.length >= 32 &&
    compact.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(compact)
  ) {
    try {
      return { bytes: Buffer.from(compact, "base64") }
    } catch {
      return null
    }
  }

  return null
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
    const resolvedSource = resolveSourcePath(source)
    if (!existsSync(resolvedSource)) {
      return `File not found: ${resolvedSource}`
    }

    try {
      const data = readFileSync(resolvedSource)
      const decoded = decodeEmbeddedBase64Image(data)
      const payload = decoded?.bytes ?? data
      const mime = decoded?.mimeType || getMimeType(resolvedSource)
      const base64 = payload.toString("base64")

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
      return `Failed to read image file ${resolvedSource}: ${msg}`
    }
  },
})
