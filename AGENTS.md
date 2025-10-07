# AI Agent Contribution Guide

This document gives coding agents (and human maintainers) a clear, opinionated playbook for making safe, coherent, high‑quality changes to this repository.

---

## 1. Project Purpose

Expose GitHub Copilot through local **OpenAI‑compatible** and **Anthropic‑compatible** HTTP bridges inside VS Code. Primary user stories:

- Run a local `/v1/chat/completions` endpoint (OpenAI format) that forwards to Copilot via the VS Code Language Model API.
- Run a local `/v1/messages` endpoint (Anthropic format) that forwards to Copilot via the VS Code Language Model API.
- List available Copilot model families through `/v1/models`.
- Basic health & availability via `/health`.

The server is **local only** (loopback host by default) and is not meant for multi‑tenant or remote exposure.

---

## 2. Architecture Snapshot

| Layer | Key Files | Notes |
|-------|-----------|-------|
| VS Code Extension Activation | `src/extension.ts` | Enables/Disables bridge, manages status command. |
| HTTP Server (Polka) | `src/http/server.ts` | Routes + middleware + error handling. |
| Routes | `src/http/routes/*.ts` | `health.ts`, `models.ts`, `chat.ts`, `messages.ts`. |
| **Providers** | `src/providers/*.ts` | **`openai.ts`, `anthropic.ts` - Format-specific request/response handling.** |
| LM / Copilot Integration | `src/models.ts` | Model selection, status updates. |
| Message Normalization | `src/messages.ts` | Shapes user/assistant/system to LM API format (shared by both providers). |
| Status & State | `src/status.ts`, `src/state.ts` | In‑memory server + model state, status bar text. |
| Config & Logging | `src/config.ts`, `src/log.ts` | Reads `bridge.*` settings, output channel. |
| Utilities | `src/http/utils.ts` | JSON helpers, typed error responses. |
| **Types** | `src/types/*.ts` | **`openai-types.ts`, `anthropic-types.ts` - API-specific type definitions.** |

### Provider Pattern

The bridge uses a **provider architecture** to support multiple API formats (OpenAI, Anthropic) while sharing the same VS Code LM backend:

```
HTTP Request → Route Layer → Provider Layer → VS Code LM API
```

**Route Layer** (`src/http/routes/`):
- Thin HTTP handlers (read JSON, delegate to provider)
- Auth and rate limiting handled by server middleware
- Examples: `chat.ts` → `handleOpenAIRequest()`, `messages.ts` → `handleAnthropicRequest()`

**Provider Layer** (`src/providers/`):
- Format-specific request normalization and response formatting
- OpenAI provider (`openai.ts`):
  - Normalizes OpenAI requests to VS Code `LanguageModelChatMessage[]`
  - Streams responses using OpenAI SSE format (`data: {...}` + `data: [DONE]`)
  - Returns `OpenAIResponse` objects
- Anthropic provider (`anthropic.ts`):
  - Normalizes Anthropic requests to VS Code `LanguageModelChatMessage[]`
  - Streams responses using Anthropic SSE format (`event: type\ndata: {...}`)
  - Returns `AnthropicResponse` objects
- Both providers:
  - Use `normalizeMessagesLM()` patterns from `src/messages.ts`
  - Convert tools to `vscode.LanguageModelChatTool[]`
  - Share active request tracking via `state.activeRequests`
  - Use same error handling patterns

**Message Normalization Patterns** (shared across providers):
- **System prompts**: Injected into first user message with `[SYSTEM]\n<content>` prefix
- **Tool calls** (assistant → user): `[TOOL_CALL:id] name(json_args)`
- **Tool results** (user → assistant): `[TOOL_RESULT:id]\n<content>`
- **History window**: Applied before normalization (configured via `bridge.historyWindow`)

**Adding a New Provider**:
1. Create `src/types/<provider>-types.ts` with request/response types
2. Create `src/providers/<provider>.ts` with:
   - `handle<Provider>Request(body, res)` - Main entry point
   - Message normalization to `LanguageModelChatMessage[]`
   - Tool conversion to `LanguageModelChatTool[]`
   - Streaming function with provider-specific SSE format
   - Non-streaming collection and response formatting
3. Create `src/http/routes/<endpoint>.ts` as thin route wrapper
4. Register route in `src/http/server.ts` with auth middleware
5. Update README with endpoint documentation and examples
6. Bump version (MINOR for new endpoint)

---

## 3. Coding Standards

1. **TypeScript Strictness**: No `any` or loose `unknown` unless inside *typed* external shim declarations. Use strong VS Code API types (`vscode.LanguageModelChat`, etc.).
2. **Imports**: All imports at file top. No inline `import('module')` types.
3. **ES Module Style**: Use `import` syntax (even though `commonjs` output). No `require` in source except in isolated legacy shims (currently none).
4. **Polka Typings**: The custom declaration in `src/types/polka.d.ts` must stay minimal but strongly typed. Extend only when you need new surface.
5. **Error Handling**: Use central `onError` (`server.ts`). Avoid swallowing errors; bubble or log via `verbose`. Prefer the pre-serialized helpers in `src/http/utils.ts` (`writeUnauthorized`, `writeNotFound`, `writeRateLimit`, `writeErrorResponse`) instead of hand-crafted JSON bodies.
6. **Logging**: Use `verbose()` for debug (guarded by config), `info()` for one‑time start messages, `error()` sparingly (currently not widely used—add only if user‑facing severity).
7. **Status Bar**: Use `updateStatus(kind)` with kinds: `start | error | success`. Initial pending state relies on `state.modelAttempted`.
8. **Model Selection**: Always feature-detect the LM API (`hasLMApi`). Return early on missing API with clear `state.lastReason` codes.
9. **Endpoint Stability**: Public paths (`/health`, `/v1/models`, `/v1/chat/completions`, `/v1/messages`). Changes require README updates and semantic version bump.
10. **Streaming & Tool Calling**:
    - **OpenAI format**: SSE contract with `data: {chunk}` events + final `data: [DONE]`. Tool call chunks emit `delta.tool_calls` entries.
    - **Anthropic format**: SSE contract with `event: type\ndata: {...}` events (no `[DONE]` sentinel). Tool calls use `content_block_start` + `content_block_delta` (type: `input_json_delta`) + `content_block_stop`.
    - The bridge treats `tool_choice: "required"` the same as `"auto"` and ignores `parallel_tool_calls` because the VS Code LM API lacks those controls.
11. **Authentication**: Support both `Authorization: Bearer <token>` and `x-api-key: <token>` headers. Both validate against the same `bridge.token` setting. Cache both header formats in `src/http/auth.ts` for performance.

---

## 4. State & Reason Codes

`state.lastReason` drives health + status explanations. Allowed values (current):

- `missing_language_model_api`
- `copilot_model_unavailable`
- `not_found`
- (Potential future: `consent_required`, `rate_limited`)

If you introduce new reason codes, update:

- `README.md` troubleshooting section
- `handleModelSelectionError`
- Health output expectations

---

## 5. Configuration Contract (`bridge.*`)

See `package.json` contributes -> configuration. When adding new settings:

- Provide default
- Document in README table
- Use `cfg.get(key, default)` pattern
- Add to `BridgeConfig` and ensure `getBridgeConfig()` uses `satisfies` to keep type safety

---

## 6. Adding Endpoints

Before adding an endpoint:

- Justify purpose (user scenario). Keep scope tight; avoid feature creep.
- Enforce auth (token) uniformly—reuse existing middleware pattern.
- Return OpenAI‑compatible shapes only if endpoint is explicitly an OpenAI analog; otherwise define a minimal JSON schema and document it.
- Update README (Endpoints section) and bump version (PATCH or MINOR depending on scope).

---

## 7. Versioning & Releases

- Patch: bug fixes, doc updates, internal refactors.
- Minor: new endpoint, new config option, new visible status semantics.
- Major (future if ever): breaking API changes (endpoint removal, payload contract changes).

Use `npm version <type>` then rebuild & (optionally) package VSIX.

---
 
## 8. Logging Guidelines

| Use | Function | Example |
|-----|----------|---------|
| Startup/one‑off info | `info()` | Bound address, model availability summary |
| Debug/verbose flow | `verbose()` | Per‑request logging, selection outcomes, SSE lifecycle |
| Serious error (rare) | `error()` | Unrecoverable initialization failure |

Avoid high‑volume logs in hot loops. Guard truly verbose details behind feature flags if needed.

---

## 9. Performance & Concurrency

- Concurrency limit enforced in `/v1/chat/completions` before model call; maintain early 429 path.
- Streaming is async iteration; avoid buffering entire response unless `stream: false`.
- Disable Nagle’s algorithm on streaming sockets with `socket.setNoDelay(true)` before writing SSE payloads.
- Do not introduce global locks; keep per‑request ephemeral state.

---

## 10. Security

- Must not widen default host binding without explicit config.
- All non-health/model/chat endpoints (future) must preserve token auth.
- Never log bearer tokens or raw user messages verbatim if sensitive; current design logs only structural info.

---

## 11. Testing Philosophy (Future)

Tests are currently absent. If adding:

- Unit: message normalization, model selection error categorization.
- Integration (optional): spin up server with mock LM API (abstract LM provider behind interface for test harness).

Keep tests deterministic (no real network LM calls).

---

## 12. AI Agent Change Workflow

1. **Scan**: Read related files (avoid editing blindly). Use grep/search for symbol impact.
2. **Plan**: List concrete steps & affected files; ensure config/docs alignment.
3. **Edit**: Minimal diffs; avoid formatting unrelated sections.
4. **Validate**: `npm run compile` must pass. (If adding tests later: run them.)
5. **Docs**: Update README + this file if contracts change.
6. **Status**: Summarize what changed, why, and any follow‑ups.

Never leave the codebase with failing type checks.

---

## 13. Common Pitfalls

| Pitfall | Avoidance |
|---------|-----------|
| Using `any` for quick fixes | Introduce proper interface / generic or refine existing type guard |
| Forgetting health/status synchronization | Update `state.lastReason` & call `updateStatus` consistently |
| Adding silent failure paths | Always log via `verbose()` or propagate error to `onError` |
| Breaking SSE spec | Maintain final `data: [DONE]` sentinel |
| Undocumented reason codes | Update troubleshooting section immediately |

---

## 14. Future Enhancements (Backlog Ideas)

- Graceful shutdown hook (capture SIGINT in dev host context if feasible)
- Adaptive model selection (prefer family ordering / scoring)
- Rate limit headers (e.g., `X-RateLimit-Remaining`)
- Optional request timeout support
- Structured logging (JSON) behind a flag
- Basic test harness / mock LM provider

(Do **not** implement without explicit issue creation & approval.)

---

## 15. Style & Formatting

- Rely on TypeScript compiler; no implicit any.
- Prefer `const` and readonly arrays where practical.
- Use nullish coalescing & optional chaining.
- Use descriptive variable names (`shown`, `availability`, etc.).

---

## 16. When in Doubt

If a change touches:

- Endpoint contracts
- Security (auth / binding)
- Status semantics

…then treat it as a **feature change** and document thoroughly.

---

Happy bridging!
