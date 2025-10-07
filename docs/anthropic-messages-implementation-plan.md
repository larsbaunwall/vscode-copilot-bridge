# Anthropic Messages API Implementation Plan

## Goals

- Add full support for the Anthropic Messages API alongside the existing OpenAI-compatible endpoints.
- Preserve strict separation between provider-specific logic (OpenAI vs. Anthropic).
- Introduce a shared provider infrastructure that maximizes reuse while keeping contracts explicit.
- Maintain backward compatibility for all existing clients and configuration.

## Scope

### In scope

- New `/v1/messages` endpoint with streaming and tool-calling support.
- Refactoring OpenAI-specific code into a provider module to consume the shared infrastructure.
- New provider-agnostic abstractions for request normalization, language model invocation, streaming, and error handling.
- Documentation, configuration, and testing updates reflecting the new provider architecture.

### Out of scope

- Non-text Anthropic content blocks (e.g., images) beyond graceful degradation.
- Broader VS Code Language Model API enhancements (we consume the existing surface).
- Changes to authentication, rate limiting, or logging beyond reuse of current utilities.

## Design Principles

1. **Provider isolation** – OpenAI and Anthropic code paths live in independent modules with mirrored interfaces.
2. **Shared core** – Common functionality (types, LM invocation, streaming scaffolding, utilities) resides in a provider-neutral layer.
3. **Minimum surprise** – Route handlers remain thin and follow current patterns for auth, rate limiting, and SSE wiring.
4. **Extensibility** – Adding future providers should require only a new module that plugs into the shared abstractions.
5. **Backward compatibility** – Existing API contracts and configuration keys keep their behavior unless explicitly versioned.
6. **Safe migration** – Before refactoring existing OpenAI functionality, carefully inspect current implementation behavior (streaming, tool calls, error paths, edge cases). Extract logic into provider modules in a way that preserves **exact** behavior, with verification at each step (compare outputs, test edge cases, validate no regressions).

## Spec Coverage Priorities

- **Authentication** – Support both OpenAI (`Authorization: Bearer <token>`) and Anthropic (`x-api-key: <token>`) headers using the **same** configured token. Routes accept either format; the bridge validates against a single shared token setting.
- **Headers** – Accept `anthropic-version` (fall back to supported default) and `anthropic-beta` while preserving existing auth headers. Document unsupported betas explicitly.
- **Request parameters** – Handle all top-level fields from the spec, including `system` (string or content array), `messages` with mixed content blocks, `max_tokens`, `metadata`, `context_management`, `container`, `mcp_servers`, `service_tier`, `stop_sequences`, `thinking`, `tool_choice` (`auto`, `any`, `tool`, `none`), `temperature`, `top_p`, `top_k`.
- **Tools** – Support JSON Schema-based tool definitions, align `tool_use` and `tool_result` content blocks with shared canonical types, and degrade gracefully on server tools that require Anthropic infrastructure (documented as unsupported).
- **Streaming contract** – Emit the complete Anthropic SSE event suite (`message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`, plus `error`), with support for `thinking` and `tool_use` phases.
- **Responses** – Populate `stop_reason`, `stop_sequence`, `usage`, `model`, and contextual fields; surface `thinking` blocks and multi-part content when available.
- **Limitations** – Call out unsupported features (image inputs, container uploads, computer use tools) with rationale and future hooks.

## Architecture Overview

```text
OpenAI route ──► normalize to vscode.LanguageModelChatMessage[] ──┐
                                                                   ├──► vscode.lm.selectChatModels() + sendRequest()
Anthropic route ──► normalize to vscode.LanguageModelChatMessage[] ──┘
                    ▲
                    │
            providers/{openai,anthropic}.ts
```

- **Routes** handle HTTP concerns: authentication, rate limiting, parameter validation, SSE lifecycle.
- **Provider modules** normalize provider-specific payloads to **VS Code LM API types** (no intermediate abstraction), format responses according to their spec (OpenAI vs Anthropic SSE events), and map errors.
- **Shared utilities** handle common SSE streaming, error responses, and auth validation.
- **No custom canonical types**—we use `vscode.LanguageModelChatMessage`, `vscode.LanguageModelChatResponse`, `vscode.LanguageModelTool` directly.

## Detailed Work Plan

This plan is organized into **four discrete phases** that can be implemented independently without breaking the existing OpenAI endpoint. Each phase is self-contained and can be tested before moving to the next.

---

### Phase 1: Foundation – Anthropic Types & Dual Auth (No behavior changes)

**Goal**: Define Anthropic API types and update auth middleware to accept both header formats without touching OpenAI route logic.

#### 1.1 Anthropic Types (`src/types/anthropic-types.ts`)

- Mirror the Anthropic Messages API specification: request bodies, content blocks, streaming event payloads, error schema.
- Provide discriminated unions for `content` elements (`text`, `tool_use`, `tool_result`, `input_json`, `thinking`, `redacted_thinking`, etc.).
- Define `AnthropicStreamEvent` union matching SSE event names (`message_start`, `content_block_delta`, ...).
- These are **input/output types only**—we normalize Anthropic requests to `vscode.LanguageModelChatMessage[]` internally.

#### 1.2 Auth Middleware Enhancement (`src/http/auth.ts`)

- Extend `isAuthorized()` to accept **either** `Authorization: Bearer <token>` **or** `x-api-key: <token>`.
- Both formats validate against the **same** configured token from settings.
- Preserve existing caching logic; update cache to handle dual header formats.
- **No changes to route handlers**—they continue using `isAuthorized()` transparently.

#### 1.3 Testing

- Verify OpenAI endpoint still works with `Authorization` header.
- Verify OpenAI endpoint now also accepts `x-api-key` header with same token.
- Run `npm run compile` and confirm no regressions.

---

### Phase 2: OpenAI Provider Refactor (Encapsulate existing logic)

**Goal**: Extract current OpenAI logic into a provider module without introducing custom abstraction layers. Use VS Code LM API types directly.

**Critical**: Before making any changes, thoroughly inspect the existing implementation to understand all behaviors, edge cases, and optimizations. The refactor must preserve exact functionality.

#### 2.0 Pre-Refactor Inspection & Documentation

**Current implementation analysis** (as of inspection):

**Message normalization** (`src/messages.ts` → `normalizeMessagesLM()`):

- Extracts last system message and injects it into first user message with `[SYSTEM]` prefix
- Filters to user/assistant/tool messages and applies history window (default: 3 turns × 3 roles = 9 messages)
- Tool messages are converted to user messages with `[TOOL_RESULT:id]` prefix
- Assistant messages with tool_calls are formatted as `[TOOL_CALL:id] name(args)`
- Uses `LanguageModelChatMessage.User()` and `.Assistant()` factory methods when available
- Handles both content strings and content arrays by flattening to text

**Tool handling** (`src/messages.ts` + `src/http/routes/chat.ts`):

- `mergeTools()` combines `tools` and deprecated `functions` arrays
- Respects `tool_choice: 'none'` by returning empty array
- Handles specific tool selection via `tool_choice: { type: 'function', function: { name } }`
- Converts to `vscode.LanguageModelChatTool[]` with `name`, `description`, `inputSchema`
- Streaming emits tool calls as `{ id, type: 'function', function: { name, arguments: JSON.stringify(input) } }`

**Streaming lifecycle** (`src/http/routes/chat.ts` → `streamResponse()`):

- Sets `socket.setNoDelay(true)` to disable Nagle's algorithm
- Writes SSE headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- Calls `res.flushHeaders()` if available
- Emits initial role chunk: `data: { choices: [{ delta: { role: 'assistant' } }] }`
- Streams text content chunks as `delta: { content }`
- Streams tool calls as `delta: { tool_calls: [...] }`
- Final chunk includes `finish_reason: 'tool_calls' | 'stop'`
- Terminates with `data: [DONE]\n\n`

**Error paths**:

- Auth failures: `writeUnauthorized()` / `writeTokenRequired()` (401)
- Model not found: 404 with `model_not_found` code
- Copilot unavailable: 503 with `copilot_unavailable` + reason (`missing_language_model_api` or `copilot_model_unavailable`)
- Rate limit: `writeRateLimit()` (429) with `Retry-After: 1` header
- Malformed request: 400 with `invalid_request_error`
- LM errors: 500 with `server_error`

**Performance optimizations**:

- Pre-serialized error responses (`UNAUTHORIZED_ERROR`, `RATE_LIMIT_ERROR`, etc.)
- Cached auth header (`Bearer ${token}`) to avoid string concatenation
- Early returns on auth/rate-limit checks before parsing body
- `activeRequests` counter for concurrency management
- Reusable header objects (`JSON_HEADERS`, `SSE_HEADERS`)

**Edge cases**:

- Empty messages array → adds single empty user message
- No system message in history → system injected on first user message
- Empty response stream → still emits role chunk
- Tool calls with no content → content is `null` in response
- Consecutive same-role messages → current implementation doesn't merge (VS Code LM API handles it)
- `function_call` (deprecated) → converted to `function_call` field in response for backward compatibility

**Capture baseline test cases**:

- Non-streaming: simple query, multi-turn, with system prompt
- Streaming: text chunks, tool calls (single + multiple), empty response
- Tool calling: tool selection, `tool_choice: none`, deprecated `functions`
- Errors: no auth, bad model, rate limit, malformed JSON
- Edge cases: empty content, tool-only response, assistant prefill

**Document findings**: Create `docs/phase2-migration-checklist.md` with:

- [ ] System message injection format preserved
- [ ] History window math unchanged (slice behavior)
- [ ] Tool format conversion exact match
- [ ] SSE event sequence identical (role chunk → content/tools → finish → DONE)
- [ ] Error response formats byte-identical
- [ ] Performance optimizations retained (pre-serialized responses, socket tuning)
- [ ] Deprecated `function_call` backward compatibility maintained

#### 2.1 OpenAI Provider Module (`src/providers/openai.ts`)

- Move normalization logic from `src/messages.ts` into `normalizeOpenAIRequest()`:
  - Input: OpenAI chat completion request
  - Output: `vscode.LanguageModelChatMessage[]` and options
  - Preserve existing message merging, system prompt handling, tool conversion
- Implement `streamOpenAIResponse()` that converts VS Code LM stream chunks into OpenAI-compatible SSE events:
  - Input: `vscode.LanguageModelChatResponse` stream
  - Output: OpenAI SSE events (`data: { choices: [...] }`, `data: [DONE]`)
  - Preserve current behavior exactly
- Provide `formatOpenAIError()` to translate internal errors to OpenAI schema.
- Export provider interface exposing `{ normalize, stream, formatError }`.

#### 2.2 HTTP Utility Enhancements (`src/http/utils.ts`)

- Extract common SSE initialization logic into `initializeSSEStream(res)` if not already present.
- Keep error response helpers (`writeUnauthorized`, `writeNotFound`, etc.) unchanged.
- No need for provider-agnostic abstraction—utilities are simple HTTP helpers.

#### 2.3 Chat Completion Route Refactor (`src/http/routes/chat.ts`)

- Replace inline normalization/streaming with calls to the OpenAI provider module.
- Route flow:
  1. Validate auth and concurrency (unchanged).
  2. Delegate to `OpenAIProvider.normalize(request)` → get `vscode.LanguageModelChatMessage[]`.
  3. Call VS Code LM API directly: `vscode.lm.selectChatModels()` and `sendRequest()`.
  4. Pipe stream through `OpenAIProvider.stream()` to format as OpenAI SSE events.
  5. Handle errors via `OpenAIProvider.formatError()`.
- **API contract remains identical**—clients see no difference.
- **Migration verification**:
  - Re-run all baseline test cases from 2.0.
  - Compare outputs byte-for-byte where possible (JSON responses, event sequences).
  - Document any unavoidable differences (e.g., timestamp variations) and validate they are benign.

#### 2.4 Testing

- Verify `/v1/chat/completions` streams and non-streaming responses match previous behavior.
- Test tool calling, error handling, and rate limiting still function correctly.
- Run `npm run compile` and validate no regressions.

---

### Phase 3: Anthropic Provider & Messages Endpoint (New functionality)

**Goal**: Add Anthropic-specific provider and new `/v1/messages` route without touching OpenAI code paths.

#### 3.1 Anthropic Provider Module (`src/providers/anthropic.ts`)

- Implement `normalizeAnthropicRequest()`:
  - Input: Anthropic Messages API request
  - Output: `vscode.LanguageModelChatMessage[]` and options
  - Extract `system` prompt and convert to first message or handle per VS Code conventions.
  - Flatten content blocks to text (VS Code LM API is text-only currently).
  - Convert Anthropic tools to `vscode.LanguageModelTool[]` format.
  - Validate `max_tokens` and required headers; preserve optional fields for metadata.
- Implement `streamAnthropicResponse()` producing Anthropic SSE events:
  - Input: `vscode.LanguageModelChatResponse` stream
  - Output: Anthropic SSE events (`message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`)
  - Map VS Code tool call chunks to `tool_use` blocks with stable IDs.
  - Track `stop_reason`, `stop_sequence`, and usage metrics from VS Code response.
  - No `data: [DONE]` sentinel (Anthropic uses `message_stop` event).
- Implement `formatAnthropicError()` mapping internal failures to Anthropic error envelopes.
- Export provider interface matching OpenAI provider: `{ normalize, stream, formatError }`.

#### 3.2 HTTP Utility Enhancements (`src/http/utils.ts`)

- Add `initializeSSEStream(res, headers?)` to centralize SSE header writing, heartbeat handling, and Anthropic event error termination semantics.
- Provide `writeProviderError(res, error)` to format responses via the provider module (optional; can inline if minimal).

#### 3.3 Anthropic Messages Route (`src/http/routes/messages.ts`)

- Clone the route structure from chat, substituting Anthropic provider calls.
- Validate required headers (`anthropic-version`, API key via dual format) and `max_tokens` before delegation; surface informative errors when unsupported options (e.g., server tools) are requested.
- Route flow:
  1. Validate auth (dual header support) and concurrency.
  2. Parse Anthropic request, delegate to `AnthropicProvider.normalize()` → get `vscode.LanguageModelChatMessage[]`.
  3. Call VS Code LM API directly: `vscode.lm.selectChatModels()` and `sendRequest()`.
  4. Pipe stream through `AnthropicProvider.stream()` to format as Anthropic SSE events.
  5. Handle errors via `AnthropicProvider.formatError()`.

#### 3.4 Server Registration (`src/http/server.ts`)

- Register `/v1/messages` route alongside existing `/v1/chat/completions`.
- Ensure route ordering doesn't conflict and rate limiting applies.

#### 3.5 Testing

- Test `/v1/messages` with both `Authorization` and `x-api-key` headers.
- Verify streaming events match Anthropic spec (`message_start`, deltas, `message_stop`).
- Test tool calling and error responses.
- Confirm `/v1/chat/completions` remains unaffected.

---

### Phase 4: Configuration, Models Metadata, & Documentation (Polish & publish)

**Goal**: Expose configuration toggles, update models endpoint, and document the new architecture.

#### 4.1 Configuration Updates

- Extend `src/config.ts` to expose `bridge.providers` with toggles for OpenAI and Anthropic compatibility layers.
- Document new settings in `package.json` contributes configuration block.
- Default Anthropic provider to enabled; allow disabling via settings.
- Provide configuration for default `anthropic-version` and optional beta flags; allow override via settings for forward compatibility.

#### 4.2 Models Endpoint Enhancements (`src/http/routes/models.ts`)

- Extend the model list to include provider metadata so clients can distinguish capabilities.
- Optionally add `capabilities` array (e.g., `['chat-completions', 'messages']`).
- Keep existing fields unchanged for backward compatibility.

#### 4.3 Documentation Updates

- Update `README.md` with:
  - `/v1/messages` usage examples (streaming and tool calls).
  - Dual auth header support explanation.
  - Limitations (no image support, `max_tokens` best-effort, `tool_choice: any` treated as `auto`).
  - Configuration options.
- Expand `AGENTS.md` with architectural overview of provider abstraction and extension guidelines.
- Add a feature compatibility matrix comparing official Anthropic parameters and bridge support/limitations.
- Consider adding `docs/providers.md` summarizing shared types and patterns.

#### 4.4 Validation & Tooling

- Add targeted unit tests for normalization functions (if test harness exists) or create lightweight integration harness.
- Run `npm run compile` after refactor to ensure TypeScript correctness.
- Perform manual smoke tests for:
  - OpenAI `/v1/chat/completions` (non-streaming + streaming + tools).
  - Anthropic `/v1/messages` (same combinations).
- Capture known limitations in README "Gotchas" section.

#### 4.5 Version Bump

- Bump `package.json` to **1.3.0** (MINOR version—new endpoint is backward compatible).
- Update CHANGELOG if it exists.
- Build and package extension.

---

## Phase Summary

| Phase | Scope | OpenAI Impact | Deliverable | Migration Safety |
|-------|-------|---------------|-------------|------------------|
| **1. Foundation** | Anthropic types + dual auth | Zero (additive only) | Auth accepts both headers; Anthropic types defined | N/A (new code) |
| **2. OpenAI Refactor** | Extract to provider module | Refactor only (no contract change) | Modular OpenAI provider using VS Code types directly | **Pre-refactor inspection + baseline tests + output comparison** |
| **3. Anthropic** | New provider + endpoint | Zero (parallel path) | `/v1/messages` endpoint live | N/A (new code) |
| **4. Polish** | Config, docs, metadata | Zero (metadata addition) | Published 1.3.0 release | N/A (surface changes) |

Each phase can be committed, tested, and merged independently, reducing integration risk and allowing for feedback loops between phases.

**Key architectural decision**: No custom "canonical" types—both providers normalize their requests directly to `vscode.LanguageModelChatMessage[]` and consume VS Code LM API types. This eliminates unnecessary abstraction and keeps the codebase simpler.

**Phase 2 migration checklist** ensures the refactor preserves exact OpenAI behavior before adding Anthropic support.

---

## Implementation Validation Notes

After inspecting the current codebase, the following corrections were made to the plan:

### Corrections & Clarifications

1. **Message normalization is more nuanced than initially assumed**:
   - System messages use `[SYSTEM]` prefix injection into first user message
   - Tool results use `[TOOL_RESULT:id]` prefix convention
   - Tool calls from assistant are formatted as `[TOOL_CALL:id] name(args)`
   - History window is `3 × 3 = 9 messages` (not just 3 turns)
   - Uses factory methods `LanguageModelChatMessage.User()` / `.Assistant()` when available

2. **Performance optimizations must be preserved**:
   - Pre-serialized error responses (`UNAUTHORIZED_ERROR`, etc.) for hot paths
   - Cached auth header to avoid string concat per request
   - `socket.setNoDelay(true)` for streaming latency
   - Early returns before body parsing

3. **Streaming contract is precise**:
   - Always emit role chunk first, even for empty responses
   - Final chunk includes `finish_reason`
   - Terminates with literal `data: [DONE]\n\n`
   - Uses `res.flushHeaders()` when available

4. **Tool handling has backward compatibility requirements**:
   - Must support deprecated `functions` array
   - Must support deprecated `function_call` (both request and response)
   - `tool_choice: { type: 'function', function: { name } }` filters to specific tool
   - Tool call IDs come from `part.callId` in VS Code LM response

5. **Error response structure is standardized**:
   - All errors use `{ error: { message, type, code, reason? } }` format
   - Reason codes are specific: `missing_language_model_api`, `copilot_model_unavailable`, `model_not_found`
   - These reason codes drive health endpoint and status bar messaging

6. **Auth middleware runs before routes** (except `/health`):
   - Token validation happens before body parsing
   - Uses cached header comparison for performance
   - Dual header support (Phase 1) must preserve this caching logic

### Key Takeaways for Implementation

- **Don't abstract what VS Code already provides**: Message factories, tool types, response streams are all VS Code API primitives
- **Preserve performance tricks**: Pre-serialization, caching, socket tuning aren't premature optimization—they're hot-path necessities
- **Test backward compat carefully**: Deprecated `functions` and `function_call` must continue working
- **System prompt convention matters**: Anthropic uses top-level `system` field, OpenAI injects with `[SYSTEM]` prefix—document this difference clearly

