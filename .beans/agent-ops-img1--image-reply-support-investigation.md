---
# agent-ops-img1
title: "Image reply support: end-to-end investigation and upstream blocker"
status: blocked
type: research
priority: medium
tags:
    - runner
    - worker
    - client
    - upstream
created_at: 2026-02-09T20:00:00Z
updated_at: 2026-02-09T20:00:00Z
---

## Summary

Investigated whether native model image replies (e.g. GPT-4o inline image generation) are supported end-to-end through OpenCode → Runner → SessionAgent DO → Frontend. **They are not.** The root cause is upstream in OpenCode's stream processor.

## Findings

### Root Cause (Upstream — OpenCode)

OpenCode's `processor.ts` stream loop handles 17 event types from Vercel AI SDK's `streamText().fullStream` but **does not handle the `"file"` event type**. When models generate images inline, the Vercel AI SDK emits a `"file"` event with `base64`, `uint8Array`, and `mediaType`. OpenCode drops this silently in its default `"unhandled"` log branch.

OpenCode's type system already has a `FilePart` type (`{ type: "file", mediaType, url }`) in the `MessagePart` union, so the schema is ready — the processor just never creates one from model output.

Filed upstream: https://github.com/anomalyco/opencode/issues/12859

### Gap 2 — Runner (`packages/runner/src/prompt.ts`)

`handlePartUpdated` (line 2023) handles `text`, `tool`, `step-start`, `step-finish`, `reasoning` part types. There is **no `file` handler**. Unknown types hit a fallback log at line 2134. Even if OpenCode started emitting `FilePart` events, our runner would ignore the image data.

### Gap 3 — SessionAgent DO

Assistant messages are stored with `content` (text only) — the `parts` column is not populated for assistant responses. Images only flow through `parts` for system messages (screenshots) and tool results.

### Gap 4 — Frontend

`getScreenshotParts()` in `message-item.tsx` already extracts `type: "image"` and `type: "screenshot"` from `parts`, but it's only called for system/tool messages — not assistant messages. Partially ready.

### What DOES work for images today

| Path | Status |
|------|--------|
| `send_image` tool (gateway `/api/image`) | Works |
| User-uploaded images as input | Works |
| Tool result images (MCP) | Works |
| Screenshots (system messages) | Works |
| **Model inline image generation** | **Broken (upstream)** |

## Upstream Issue

https://github.com/anomalyco/opencode/issues/12859

Related OpenCode issues (symptoms, not root-caused):
- https://github.com/anomalyco/opencode/issues/7646
- https://github.com/anomalyco/opencode/issues/9539
- https://github.com/anomalyco/opencode/issues/6604

## When to revisit

Once the upstream issue is resolved and OpenCode emits `FilePart` events for model-generated images, we need to:

1. **Runner**: Add `file` case in `handlePartUpdated` → send image data to DO (similar to `sendScreenshot`)
2. **SessionAgent DO**: Populate `parts` column for assistant messages containing file content
3. **Frontend**: Extend image extraction to assistant message parts (mostly ready)

**Done when:** A model that supports inline image generation (e.g. GPT-4o) returns an image and it's visible in the Agent-Ops chat UI.
