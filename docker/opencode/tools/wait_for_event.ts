import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Yield control and wait for the next incoming event. Call this when you have finished " +
    "your current work and are waiting for something external — a child session's notify_parent, " +
    "a user message, or any other prompt. Your turn ends after this tool returns. " +
    "The next message you receive will be from whoever wakes you (child notification, user, etc.). " +
    "Prefer this over sleep loops when the wait time is unknown or when you expect a child " +
    "to notify you proactively.",
  args: {
    reason: tool.schema
      .string()
      .optional()
      .describe(
        "Brief note about what you're waiting for (e.g. 'Waiting for child session to complete')",
      ),
    session_ids: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe(
        "Optional list of child session IDs to monitor. If omitted, all child sessions are monitored.",
      ),
    notify_on: tool.schema
      .enum(["terminal", "status_change", "started"])
      .optional()
      .describe(
        "Which events should wake you. 'terminal' (default) only fires when a child reaches a terminal status.",
      ),
    statuses: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe(
        "Optional list of statuses to trigger on (e.g. ['terminated','error']). Overrides notify_on.",
      ),
  },
  async execute(args) {
    const sessionId = process.env.SESSION_ID
    if (!sessionId) {
      return (
        "Cannot wait for events because SESSION_ID is not set. " +
        "Your turn is now over — do NOT call any more tools or generate further output."
      )
    }

    const pollIntervalMs = 2000
    const terminalStatuses = new Set(["terminated", "error", "hibernated"])
    const notifyOn = args.notify_on || "terminal"
    const statusFilter = args.statuses?.length ? new Set(args.statuses) : null
    let lastSnapshot = new Map<string, string>()
    let initialized = false

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    while (true) {
      try {
        const res = await fetch("http://localhost:9000/api/child-sessions")
        if (!res.ok) {
          await sleep(pollIntervalMs)
          continue
        }

        const data = (await res.json()) as {
          children?: Array<{ id: string; title?: string; status: string }>
        }
        const allChildren = data.children ?? []
        const children = args.session_ids?.length
          ? allChildren.filter((c) => args.session_ids!.includes(c.id))
          : allChildren
        const current = new Map<string, string>(
          children.map((c) => [c.id, c.status]),
        )

        if (initialized) {
          // New child spawned
          if (notifyOn === "started") {
            for (const [id, status] of current) {
              if (!lastSnapshot.has(id)) {
                const event = terminalStatuses.has(status)
                  ? `Child session event: ${id} is ${status}.`
                  : `Child session event: ${id} started.`
                return (
                  `${event} ` +
                  `Yielding control.${args.reason ? " Reason: " + args.reason : ""} ` +
                  "Your turn is now over — do NOT call any more tools or generate further output."
                )
              }
            }
          }

          // Status changes (explicit opt-in)
          if (notifyOn === "status_change") {
            for (const [id, status] of current) {
              const prev = lastSnapshot.get(id)
              if (prev && prev !== status) {
                if (statusFilter && !statusFilter.has(status)) continue
                const event = `Child session event: ${id} changed status from ${prev} to ${status}.`
                return (
                  `${event} ` +
                  `Yielding control.${args.reason ? " Reason: " + args.reason : ""} ` +
                  "Your turn is now over — do NOT call any more tools or generate further output."
                )
              }
            }
          }

          // Terminal transitions (non-terminal -> terminal) or filtered statuses
          for (const [id, status] of current) {
            const prev = lastSnapshot.get(id)
            const isTerminal = terminalStatuses.has(status)
            const matchesFilter = statusFilter ? statusFilter.has(status) : false
            if (prev && prev !== status && (matchesFilter || (notifyOn === "terminal" && !terminalStatuses.has(prev) && isTerminal))) {
              const event = `Child session event: ${id} is ${status}.`
              return (
                `${event} ` +
                `Yielding control.${args.reason ? " Reason: " + args.reason : ""} ` +
                "Your turn is now over — do NOT call any more tools or generate further output."
              )
            }
          }
        }

        lastSnapshot = current
        initialized = true
      } catch {
        // Ignore transient failures and keep waiting
      }

      await sleep(pollIntervalMs)
    }
  },
})
