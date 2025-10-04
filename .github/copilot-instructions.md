## Copilot Usage Notes

Always skim [AGENTS.md](../AGENTS.md) before making changes—the document is the single source of truth for architecture, performance targets, and workflow expectations.

### Hot-path rules

- Reuse the helpers in `src/http/utils.ts` (`writeUnauthorized`, `writeNotFound`, `writeRateLimit`, `writeErrorResponse`) instead of hand-written JSON responses.
- Preserve the SSE contract in `src/http/routes/chat.ts`: emit role chunk first, follow with `data: { ... }` payloads, and terminate with `data: [DONE]`.
- When streaming, keep `socket.setNoDelay(true)` on the response socket to avoid latency regressions.
- Honor `state.activeRequests` concurrency guard and return early 429s via `writeRateLimit`.

### Tool calling compatibility

- `mergeTools` already merges deprecated `functions`; prefer extending it over new code paths.
- The bridge treats `tool_choice: "required"` like `"auto"` and ignores `parallel_tool_calls`—reflect this limitation in docs if behavior changes.
- Stream tool call deltas using `delta.tool_calls` chunks containing JSON-encoded argument strings. Downstream clients should replace, not append, argument fragments.

### Scope & contracts

- Public endpoints are `/health`, `/v1/models`, `/v1/chat/completions`. Changing contracts requires README updates and a version bump.
- Keep the bridge loopback-only unless a new configuration knob is explicitly approved.
- Update configuration docs when introducing new `bridge.*` settings and run `npm run compile` before handing off changes.

### Workflow

- Plan with the todo-list tool, keep diffs minimal, and avoid formatting unrelated regions.
- Capture limitations or behavior differences (e.g., missing OpenAI response fields) in comments or docs so clients aren’t surprised.
- Summarize reality after each change: what was touched, how it was verified, and any follow-ups.