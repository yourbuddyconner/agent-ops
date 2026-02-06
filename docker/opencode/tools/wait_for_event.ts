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
    let lastSnapshot = new Map<string, string>()

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
        const children = data.children ?? []
        const current = new Map<string, string>(
          children.map((c) => [c.id, c.status]),
        )

        // Trigger immediately if any child is already in a terminal state.
        for (const child of children) {
          if (terminalStatuses.has(child.status)) {
            const message = `Child session event: ${child.id} is ${child.status}.`
            await fetch("http://localhost:9000/api/session-message", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId, content: message }),
            })
            return (
              `Yielding control.${args.reason ? " Reason: " + args.reason : ""} ` +
              "Your turn is now over — do NOT call any more tools or generate further output."
            )
          }
        }

        if (lastSnapshot.size > 0) {
          // New child spawned
          for (const [id] of current) {
            if (!lastSnapshot.has(id)) {
              const message = `Child session event: ${id} started.`
              await fetch("http://localhost:9000/api/session-message", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId, content: message }),
              })
              return (
                `Yielding control.${args.reason ? " Reason: " + args.reason : ""} ` +
                "Your turn is now over — do NOT call any more tools or generate further output."
              )
            }
          }

          // Status changes
          for (const [id, status] of current) {
            const prev = lastSnapshot.get(id)
            if (prev && prev !== status) {
              const message = `Child session event: ${id} changed status from ${prev} to ${status}.`
              await fetch("http://localhost:9000/api/session-message", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId, content: message }),
              })
              return (
                `Yielding control.${args.reason ? " Reason: " + args.reason : ""} ` +
                "Your turn is now over — do NOT call any more tools or generate further output."
              )
            }
          }
        }

        lastSnapshot = current
      } catch {
        // Ignore transient failures and keep waiting
      }

      await sleep(pollIntervalMs)
    }
  },
})
