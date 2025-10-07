<img src="images/icon.png" width="100" />

# Copilot Bridge (VS Code Extension)

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/thinkability.copilot-bridge)](https://marketplace.visualstudio.com/items?itemName=thinkability.copilot-bridge)
[![Visual Studio Marketplace Installs](https://img.s## 🧩 Architecture

The extension uses VS Code's built-in Language Model API to select available Copilot chat models.  
Requests are normalized and sent through VS Code itself, never directly to GitHub Copilot servers.  
Responses stream back via SSE with concurrency controls for editor stability.

### Provider Architecture

Copilot Bridge uses a **provider pattern** to support multiple API formats while sharing the same VS Code LM backend:

```
┌─────────────────────────────────────────────────┐
│          HTTP Request (localhost:port)           │
└────────────┬─────────────────────┬───────────────┘
             │                     │
    ┌────────▼─────────┐  ┌───────▼──────────┐
    │  /v1/chat/       │  │  /v1/messages    │
    │  completions     │  │  (Anthropic)     │
    └────────┬─────────┘  └───────┬──────────┘
             │                     │
    ┌────────▼─────────┐  ┌───────▼──────────┐
    │  OpenAI Provider │  │ Anthropic Provider│
    │  (openai.ts)     │  │ (anthropic.ts)   │
    └────────┬─────────┘  └───────┬──────────┘
             │                     │
             │  Normalize messages │
             │  Convert tools      │
             └──────────┬──────────┘
                        │
           ┌────────────▼────────────────┐
           │  VS Code Language Model API │
           │  (vscode.lm)                │
           └────────────┬────────────────┘
                        │
           ┌────────────▼────────────────┐
           │  GitHub Copilot             │
           └─────────────────────────────┘
```

**Key components:**
- **Route layer** (`src/http/routes/`) - Thin HTTP handlers, auth/rate limiting
- **Provider layer** (`src/providers/`) - Format-specific request/response handling
- **Message normalization** (`src/messages.ts`) - Shared message conversion logic
- **VS Code LM integration** (`src/models.ts`) - Model selection and availability

Both providers:
- Use the same token configuration and dual auth header support
- Share the same VS Code Language Model backend
- Normalize messages to VS Code format with `[SYSTEM]`, `[TOOL_CALL:id]`, `[TOOL_RESULT:id]` prefixes
- Apply the same concurrency limits and error handling


### How it calls models (pseudocode)o/visual-studio-marketplace/d/thinkability.copilot-bridge?label=installs)](https://marketplace.visualstudio.com/items?itemName=thinkability.copilot-bridge)

> **A local interface for GitHub Copilot built on the official VS Code Language Models API.**

Copilot Bridge lets you access your personal Copilot session locally through an OpenAI-compatible interface — **without calling any private GitHub endpoints**. It’s designed for developers experimenting with AI agents, CLI tools, and custom integrations inside their own editor environment.

> **API Surface:** Uses only the public VS Code **Language Model API** (`vscode.lm`) for model discovery and chat. No private Copilot endpoints, tokens, or protocol emulation.
---

## ✨ Key Features

- Local HTTP server locked to `127.0.0.1`
- **OpenAI-compatible** `/v1/chat/completions` endpoint with SSE streaming
- **Anthropic-compatible** `/v1/messages` endpoint with Anthropic SSE format
- **Dual authentication**: supports both `Authorization: Bearer` (OpenAI) and `x-api-key` (Anthropic) headers
- `/v1/models` and `/health` endpoints for discovery and monitoring
- Real-time model discovery via VS Code Language Model API
- Tool calling support for both OpenAI and Anthropic formats
- Concurrency and rate limits to keep VS Code responsive
- Mandatory token authentication with `HTTP 401 Unauthorized` protection
- Lightweight Polka-based server integrated directly with the VS Code runtime

---

## ⚖️ Compliance & Usage Notice

- Uses **only** the public VS Code Language Models API.
- Does **not** contact or emulate private GitHub Copilot endpoints.
- Requires an active GitHub Copilot subscription.
- Subject to [GitHub Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) and the [Github Acceptable Use Policy](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies).
- Intended for **personal, local experimentation** only.
- No affiliation with GitHub or Microsoft.

> ❗ The author provides this project as a technical demonstration. Use responsibly and ensure your own compliance with applicable terms.

---

## 🚧 Scope and Limitations

| ✅ Supported | 🚫 Not Supported |
|--------------|------------------|
| Local, single-user loopback use | Multi-user or shared deployments |
| Testing local agents or CLI integrations | Continuous automation or CI/CD use |
| Educational / experimental use | Public or commercial API hosting |

---

## 🧠 Motivation

Copilot Bridge was built to demonstrate how VS Code’s **Language Model API** can power local-first AI tooling.  
It enables developers to reuse OpenAI-compatible SDKs and workflows while keeping all traffic on-device.

This is **not** a Copilot proxy, wrapper, or reverse-engineered client — it’s a bridge built entirely on the editor’s public extension surface.

---

## ⚠️ Disclaimer

This software is provided *as is* for research and educational purposes.  
Use at your own risk.  
You are solely responsible for ensuring compliance with your Copilot license and applicable terms.  
The author collects no data and has no access to user prompts or completions.

---

## 🚀 Quick Start

### Requirements
- Visual Studio Code Desktop with GitHub Copilot signed in  
- (Optional) Node.js 18+ and npm for local builds

### Installation

1. Install from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=thinkability.copilot-bridge) or load the `.vsix`.
2. Set **Copilot Bridge › Token** to a secret value (Settings UI or JSON). Requests without this token receive `401 Unauthorized`.
3. Open the **Command Palette** → “Copilot Bridge: Enable” to start the bridge.
4. Check status anytime with “Copilot Bridge: Status” or by hovering the status bar item (it links directly to the token setting when missing).
5. Keep VS Code open — the bridge runs only while the editor is active.

---

## 📡 Using the Bridge

Replace `PORT` with the one shown in “Copilot Bridge: Status”. Use the same token value you configured in VS Code:

```bash
export PORT=12345                 # Replace with the port from the status command
export BRIDGE_TOKEN="<your-copilot-bridge-token>"
```

List models:

```bash
curl -H "Authorization: Bearer $BRIDGE_TOKEN" \
  http://127.0.0.1:$PORT/v1/models
```

Stream a completion:

```bash
curl -N \
  -H "Authorization: Bearer $BRIDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-copilot","messages":[{"role":"user","content":"hello"}]}' \
  http://127.0.0.1:$PORT/v1/chat/completions
```

Use with OpenAI SDK:

```ts
import OpenAI from "openai";

if (!process.env.BRIDGE_TOKEN) {
  throw new Error("Set BRIDGE_TOKEN to the same token configured in VS Code settings (bridge.token).");
}

const client = new OpenAI({
  baseURL: `http://127.0.0.1:${process.env.PORT}/v1`,
  apiKey: process.env.BRIDGE_TOKEN,
});

const rsp = await client.chat.completions.create({
  model: "gpt-4o-copilot",
  messages: [{ role: "user", content: "hello" }],
});

console.log(rsp.choices[0].message?.content);
```

### Using the Anthropic Messages API

The bridge also supports the Anthropic Messages API format at `/v1/messages`:

```bash
# Anthropic-style with x-api-key header
curl -N \
  -H "x-api-key: $BRIDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"gpt-4o-copilot",
    "max_tokens":1024,
    "messages":[{"role":"user","content":"hello"}]
  }' \
  http://127.0.0.1:$PORT/v1/messages
```

Use with Anthropic SDK:

```ts
import Anthropic from "@anthropic-ai/sdk";

if (!process.env.BRIDGE_TOKEN) {
  throw new Error("Set BRIDGE_TOKEN to the same token configured in VS Code settings (bridge.token).");
}

const client = new Anthropic({
  baseURL: `http://127.0.0.1:${process.env.PORT}`,
  apiKey: process.env.BRIDGE_TOKEN,
});

const rsp = await client.messages.create({
  model: "claude-3-5-sonnet-20241022", // Model name is passed through
  max_tokens: 1024,
  messages: [{ role: "user", content: "hello" }],
});

console.log(rsp.content[0].text);
```

> **Note**: Both authentication header formats work with both endpoints:
> - `/v1/chat/completions` accepts `Authorization: Bearer` **or** `x-api-key`
> - `/v1/messages` accepts `Authorization: Bearer` **or** `x-api-key`

---

## 🎯 API Endpoints

### `GET /health`
Returns bridge status and availability.

**Response:**
```json
{
  "status": "ok",
  "uptime": 1234.56,
  "reason": "success"
}
```

**Reason codes:**
- `success` - Bridge operational
- `copilot_model_unavailable` - No Copilot models available
- `missing_language_model_api` - VS Code LM API not available

### `GET /v1/models`
Lists available models from VS Code Language Model API.

**Response:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "copilot-gpt-4o",
      "object": "model",
      "created": 1234567890,
      "owned_by": "copilot"
    }
  ]
}
```

### `POST /v1/chat/completions`
OpenAI-compatible chat completions endpoint.

**Request:**
```json
{
  "model": "gpt-4o-copilot",
  "messages": [
    {"role": "system", "content": "You are helpful."},
    {"role": "user", "content": "Hello!"}
  ],
  "stream": true,
  "temperature": 0.7,
  "tools": [...]
}
```

**Streaming Response (SSE):**
```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk",...}
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk",...}
data: [DONE]
```

**Supported parameters:**
- `model` - Model identifier (passed through to VS Code LM)
- `messages` - Conversation history (system, user, assistant, tool)
- `stream` - Enable SSE streaming (default: false)
- `tools` - Tool definitions for function calling
- `tool_choice` - Tool selection strategy (none/auto/required/specific)
- `temperature`, `top_p` - Sampling parameters (best-effort)
- Deprecated: `functions`, `function_call` (converted to tools)

**Limitations:**
- `max_tokens` is advisory only (VS Code LM controls actual length)
- `n` (multiple choices) not supported
- `logprobs`, `logit_bias` not supported
- Usage tokens always return 0 (VS Code LM doesn't expose counts)

### `POST /v1/messages`
Anthropic-compatible messages endpoint.

**Request:**
```json
{
  "model": "claude-3-5-sonnet-20241022",
  "max_tokens": 1024,
  "messages": [
    {"role": "user", "content": "Hello!"}
  ],
  "system": "You are helpful.",
  "stream": true,
  "tools": [...]
}
```

**Streaming Response (Anthropic SSE format):**
```
event: message_start
data: {"type":"message_start","message":{...}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{...}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{...}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},...}

event: message_stop
data: {"type":"message_stop"}
```

**Supported parameters:**
- `model` - Model identifier (required)
- `max_tokens` - Maximum tokens to generate (**required**)
- `messages` - Array of user/assistant messages
- `system` - System prompt (string or content blocks)
- `stream` - Enable SSE streaming (default: false)
- `tools` - Tool definitions
- `tool_choice` - Tool selection (auto/any/tool/none)
- `temperature`, `top_p`, `top_k` - Sampling parameters (best-effort)

**Limitations:**
- `max_tokens` is required but advisory (VS Code LM controls length)
- Content blocks support: text, tool_use, tool_result (no images)
- Thinking blocks not supported (VS Code LM doesn't expose reasoning)
- Usage tokens always return 0
- Stop sequences advisory only

---

## 📊 Feature Compatibility Matrix

| Feature | OpenAI `/v1/chat/completions` | Anthropic `/v1/messages` | Notes |
|---------|------------------------------|--------------------------|-------|
| **Authentication** | ✅ `Authorization: Bearer` | ✅ `x-api-key` | Both endpoints accept both headers |
| **Streaming** | ✅ SSE (OpenAI format) | ✅ SSE (Anthropic format) | Different event structures |
| **Tool Calling** | ✅ `tools` + `tool_calls` | ✅ `tools` + `tool_use` blocks | Both map to VS Code LM tools |
| **System Prompts** | ✅ Message with `role: system` | ✅ `system` field | Both inject via `[SYSTEM]` prefix |
| **Content Blocks** | ⚠️ Text only | ⚠️ Text + tool blocks only | No image/file support (VS Code LM limit) |
| **Thinking/Reasoning** | ❌ Not supported | ❌ Not supported | VS Code LM doesn't expose |
| **Temperature** | ✅ Best-effort | ✅ Best-effort | Passed to VS Code LM |
| **Max Tokens** | ⚠️ Advisory | ⚠️ Advisory (required param) | VS Code LM controls actual length |
| **Usage Tokens** | ⚠️ Always 0 | ⚠️ Always 0 | VS Code LM doesn't report counts |
| **Multiple Choices (n)** | ❌ | ❌ | VS Code LM single response only |
| **Logprobs** | ❌ | N/A | Not available from VS Code LM |



---

## 🧩 Architecture

The extension uses VS Code’s built-in Language Model API to select available Copilot chat models.  
Requests are normalized and sent through VS Code itself, never directly to GitHub Copilot servers.  
Responses stream back via SSE with concurrency controls for editor stability.


### How it calls models (pseudocode)

```ts
import * as vscode from "vscode";

const models = await vscode.lm.selectChatModels({
  where: { vendor: "copilot", supports: { reasoning: true } }
});
const model = models[0] ?? (await vscode.lm.selectChatModels({}))[0];
if (!model) throw new Error("No language models available (vscode.lm)");

const stream = await model.sendRequest(
  { kind: "chat", messages: [{ role: "user", content: "hello" }] },
  { temperature: 0.2 }
);

// Stream chunks → SSE to localhost client; no private Copilot protocol used.
```

---


## 🔧 Configuration

| Setting | Default | Description |
|----------|----------|-------------|
| `bridge.enabled` | false | Start automatically with VS Code |
| `bridge.port` | 0 | Ephemeral port |
| `bridge.token` | "" | Bearer token required for every request (leave empty to block API access) |
| `bridge.historyWindow` | 3 | Retained conversation turns |
| `bridge.maxConcurrent` | 1 | Max concurrent requests |
| `bridge.verbose` | false | Enable verbose logging |

> ℹ️ The bridge always binds to `127.0.0.1` and cannot be exposed to other interfaces.

> 💡 Hover the status bar item to confirm the token status; missing tokens show a warning link that opens the relevant setting.

---

## 🪶 Logging & Diagnostics

1. Enable `bridge.verbose`.
2. Open **View → Output → “Copilot Bridge”**.
3. Observe connection events, health checks, and streaming traces.

---

## 🔒 Security

> ⚠️ This extension is intended for **localhost use only**.  
> Never expose the endpoint to external networks.

- Loopback-only binding (non-configurable)  
- Mandatory bearer token gating (requests rejected without the correct header)  
- **Telemetry:** none collected or transmitted.

---

## 🧾 Changelog

- **v1.3.0** – Added Anthropic Messages API support (`/v1/messages`), dual auth headers (`Authorization` + `x-api-key`), provider architecture refactor
- **v1.2.0** – Authentication token now mandatory; status bar hover warns when missing  
- **v1.1.1** – Locked the HTTP server to localhost for improved safety  
- **v1.1.0** – Performance improvements (~30%)  
- **v1.0.0** – Modular core, OpenAI typings, tool-calling support  
- **v0.2.2** – Polka integration, improved model family selection  
- **v0.1.0–0.1.5** – Initial releases and bug fixes

---

## 🤝 Contributing

Pull requests and discussions are welcome.  
Please open an [issue](https://github.com/larsbaunwall/vscode-copilot-bridge/issues) to report bugs or suggest features.

---

## 📄 License

Apache 2.0 © 2025 [Lars Baunwall]  
Independent project — not affiliated with GitHub or Microsoft.  
For compliance or takedown inquiries, please open a GitHub issue.

---

### ❓ FAQ

#### Can I run this on a server?
No. Copilot Bridge is designed for **localhost-only**, single-user, interactive use.  
Running it on a shared host or exposing it over a network would violate its intended scope and could breach the Copilot terms.  
The host is bound to `127.0.0.1` (non-configurable).

#### Does it send any data to the author?
No. The bridge never transmits telemetry, prompts, or responses to any external service.  
All traffic stays on your machine and flows through VS Code’s built-in model interface.

#### What happens if Copilot is unavailable?
The `/health` endpoint will report a diagnostic reason such as `copilot_unavailable` or `missing_language_model_api`.  
This means VS Code currently has no accessible models via `vscode.lm`. Once Copilot becomes available again, the bridge will resume automatically.

#### Can I use non-Copilot models?
Yes, if other providers register with `vscode.lm`. The bridge will detect any available chat-capable models and use the first suitable one it finds.

#### How is this different from reverse-engineered Copilot proxies?
Reverse-engineered proxies call private endpoints directly or reuse extracted tokens.  
Copilot Bridge does neither—it communicates only through VS Code’s sanctioned **Language Model API**, keeping usage transparent and compliant.