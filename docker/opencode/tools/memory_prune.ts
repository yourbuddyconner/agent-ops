import { tool } from "@opencode-ai/plugin"

type MemoryRecord = {
  id: string
  category?: string
  content?: string
  relevance?: number
  createdAt?: string
  lastAccessedAt?: string
}

function parseTimestamp(value?: string): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export default tool({
  description:
    "Prune stale memories in bulk using relevance/age thresholds. " +
    "Supports dry-run mode for safe previews and is suitable for nightly cleanup automation.",
  args: {
    category: tool.schema
      .enum(["preference", "workflow", "context", "project", "decision", "general"])
      .optional()
      .describe("Optional category filter."),
    query: tool.schema
      .string()
      .optional()
      .describe("Optional keyword query filter."),
    olderThanDays: tool.schema
      .number()
      .int()
      .min(1)
      .max(3650)
      .default(30)
      .describe("Only consider memories last accessed at least this many days ago."),
    relevanceAtMost: tool.schema
      .number()
      .min(0)
      .max(2)
      .default(1)
      .describe("Only consider memories with relevance at or below this value."),
    keepLatest: tool.schema
      .number()
      .int()
      .min(0)
      .max(200)
      .default(25)
      .describe("Always keep this many most recently created memories from the scanned set."),
    maxScan: tool.schema
      .number()
      .int()
      .min(1)
      .max(200)
      .default(200)
      .describe("Maximum memories to scan."),
    maxDeletes: tool.schema
      .number()
      .int()
      .min(1)
      .max(200)
      .default(20)
      .describe("Maximum memories to delete in this run."),
    dryRun: tool.schema
      .boolean()
      .default(true)
      .describe("If true, only report candidates without deleting."),
  },
  async execute(args) {
    try {
      const params = new URLSearchParams()
      if (args.category) params.set("category", args.category)
      if (args.query) params.set("query", args.query)
      params.set("limit", String(args.maxScan))

      const qs = params.toString()
      const listRes = await fetch(`http://localhost:9000/api/memories${qs ? `?${qs}` : ""}`)
      if (!listRes.ok) {
        const errText = await listRes.text()
        return `Failed to read memories for pruning: ${errText}`
      }

      const listData = (await listRes.json()) as { memories?: MemoryRecord[] }
      const memories = Array.isArray(listData.memories) ? listData.memories : []
      if (memories.length === 0) {
        return "No memories found to evaluate."
      }

      const now = Date.now()
      const cutoff = now - args.olderThanDays * 24 * 60 * 60 * 1000

      const newestIds = new Set(
        [...memories]
          .sort((a, b) => parseTimestamp(b.createdAt) - parseTimestamp(a.createdAt))
          .slice(0, args.keepLatest)
          .map((m) => m.id),
      )

      const candidates = memories
        .filter((m) => !newestIds.has(m.id))
        .filter((m) => (m.relevance ?? 1) <= args.relevanceAtMost)
        .filter((m) => {
          const lastAccessTs = parseTimestamp(m.lastAccessedAt)
          return lastAccessTs > 0 && lastAccessTs <= cutoff
        })
        .sort((a, b) => {
          const relevanceDiff = (a.relevance ?? 1) - (b.relevance ?? 1)
          if (relevanceDiff !== 0) return relevanceDiff
          return parseTimestamp(a.lastAccessedAt) - parseTimestamp(b.lastAccessedAt)
        })
        .slice(0, args.maxDeletes)

      if (candidates.length === 0) {
        return [
          "No prune candidates matched the current policy.",
          `Scanned: ${memories.length}`,
          `Policy: olderThanDays=${args.olderThanDays}, relevanceAtMost=${args.relevanceAtMost}, keepLatest=${args.keepLatest}`,
        ].join("\n")
      }

      if (args.dryRun) {
        return JSON.stringify(
          {
            dryRun: true,
            scanned: memories.length,
            candidates: candidates.length,
            policy: {
              olderThanDays: args.olderThanDays,
              relevanceAtMost: args.relevanceAtMost,
              keepLatest: args.keepLatest,
              maxDeletes: args.maxDeletes,
            },
            toDelete: candidates.map((m) => ({
              id: m.id,
              category: m.category,
              relevance: m.relevance,
              createdAt: m.createdAt,
              lastAccessedAt: m.lastAccessedAt,
              contentPreview: (m.content || "").slice(0, 140),
            })),
          },
          null,
          2,
        )
      }

      let deleted = 0
      const failed: string[] = []
      for (const candidate of candidates) {
        const encodedId = encodeURIComponent(candidate.id)
        const delRes = await fetch(`http://localhost:9000/api/memories/${encodedId}`, { method: "DELETE" })
        if (!delRes.ok) {
          failed.push(candidate.id)
          continue
        }
        const delData = (await delRes.json()) as { success?: boolean }
        if (delData.success) deleted += 1
        else failed.push(candidate.id)
      }

      return JSON.stringify(
        {
          dryRun: false,
          scanned: memories.length,
          attempted: candidates.length,
          deleted,
          failed,
        },
        null,
        2,
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `Failed to prune memories: ${msg}`
    }
  },
})
