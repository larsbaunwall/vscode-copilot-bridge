<img src="images/icon.png" width="100" />

# Copilot Bridge (VS Code Extension)

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/thinkability.copilot-bridge)](https://marketplace.visualstudio.com/items?itemName=thinkability.copilot-bridge)
[![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/d/thinkability.copilot-bridge?label=installs)](https://marketplace.visualstudio.com/items?itemName=thinkability.copilot-bridge)

## 🛠️ Bring your Copilot subscription to your local toolchain

Copilot Bridge turns Visual Studio Code into a local OpenAI-compatible gateway to the GitHub Copilot access you already pay for. Point your favorite terminals, scripts, and desktop apps at the bridge and keep the chat experience you rely on inside the editor—without routing traffic to another vendor.

With the bridge running inside VS Code (the editor must stay open), every request stays on your machine while you:

- **Use Copilot from any CLI or automation** — Curl it, cron it, or wire it into dev tooling that expects the OpenAI Chat Completions API.
- **Reuse existing OpenAI integrations** — Swap the base URL and keep your Copilot responses flowing into the same workflows.
- **Stay in control** — Keep latency low, keep traffic loopback-only, and gate access with an optional bearer token.

## 💡 How developers use Copilot Bridge

- Script Copilot answers into local build helpers, documentation generators, or commit bots.
- Experiment with agents and prompts while keeping requests on-device.
- Trigger Copilot completions from Raycast, Alfred, or custom UI shells without leaving VS Code.

## ✨ Feature highlights

- Local HTTP server bound to 127.0.0.1 by default
- Fully OpenAI-style `/v1/chat/completions`, `/v1/models`, and `/health` endpoints
- Server-Sent Events (SSE) streaming for fast, incremental responses
- Real-time model discovery powered by the VS Code Language Model API
- Concurrency guard with early 429 handling to keep your IDE responsive
- Starts automatically with VS Code once enabled, so the bridge is always ready when you are

> [!IMPORTANT]
> ⚖️ **Usage note**: Copilot Bridge extends your personal GitHub Copilot subscription. Use it in accordance with the existing Copilot and VS Code terms of service; you are responsible for staying compliant.

## 🚀 Get started in minutes

### ✅ Prerequisites

- Visual Studio Code Desktop with GitHub Copilot signed in
- (Optional for local builds) Node.js 18+ and npm

### ▶️ Install & launch

1. Install the extension from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=thinkability.copilot-bridge) or side-load the latest `.vsix`.
2. In VS Code, press **F5** to open an Extension Development Host if you're iterating locally.
3. Remember the bridge lives inside VS Code—keep the editor running when you want the HTTP endpoint online.
4. Enable the bridge:
   - Command Palette → “Copilot Bridge: Enable”, or
   - Set the `bridge.enabled` setting to `true`.
5. Check the status anytime via “Copilot Bridge: Status” to see the bound address, port, and auth requirements.

> [!NOTE]
> Copilot Bridge stops listening as soon as VS Code closes. Keep the editor running whenever you need the endpoint available.

### 🏗️ Build from source (optional)

```bash
npm install
npm run compile
```

Package a VSIX when you need to distribute a build:

```bash
npm run package
```

## 📡 First requests

Replace `PORT` with what “Copilot Bridge: Status” reports.

- List models

```bash
curl http://127.0.0.1:$PORT/v1/models
```

- Stream a completion

```bash
curl -N -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-copilot","messages":[{"role":"user","content":"hello"}]}' \
  http://127.0.0.1:$PORT/v1/chat/completions
```

- Request a single JSON response

```bash
curl -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-copilot","stream":false,"messages":[{"role":"user","content":"hello"}]}' \
  http://127.0.0.1:$PORT/v1/chat/completions
```

> [!TIP]
> You can also pass a family such as `gpt-4o`. If unavailable, the bridge returns `404 model_not_found`.

### 💻 Use the OpenAI SDK (Node.js)

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: `http://127.0.0.1:${process.env.PORT}/v1`,
  apiKey: process.env.BRIDGE_TOKEN || "not-used-when-empty",
});

const rsp = await client.chat.completions.create({
  model: "gpt-4o-copilot",
  messages: [{ role: "user", content: "hello" }],
  stream: false,
});

console.log(rsp.choices[0].message?.content);
```

## 🧠 Architecture at a glance

The extension invokes VS Code’s Language Model API to select an available GitHub Copilot chat model, normalizes your recent conversation turns, and forwards the request from a local Polka HTTP server. Responses are streamed back via SSE (or buffered when `stream: false`). The server respects concurrency limits so multiple calls won’t stall the editor.

## 📚 Technical reference

### 🔌 Endpoints

- `GET /health` — Reports IDE version, Copilot availability, and reason codes like `missing_language_model_api`.
- `GET /v1/models` — Lists Copilot model IDs the bridge can access.
- `POST /v1/chat/completions` — Accepts OpenAI-compatible bodies and streams deltas with a terminating `data: [DONE]` event.

Supported `model` values include IDs returned by `/v1/models`, Copilot families such as `gpt-4o`, or the keyword `copilot` for default selection. Common error responses: `401 unauthorized`, `404 model_not_found`, `429 rate_limit_exceeded`, `503 copilot_unavailable`.

#### ℹ️ OpenAI compatibility notes

- Always returns a single choice (`n = 1`) and omits fields such as `usage`, `service_tier`, and `system_fingerprint`.
- Treats `tool_choice: "required"` the same as `"auto"`; `parallel_tool_calls` is ignored because the VS Code API lacks those hooks.
- Extra request options (`logprobs`, `response_format`, `seed`, `metadata`, `store`, etc.) are accepted but currently no-ops.
- Streaming tool call deltas send complete JSON fragments; clients should replace previously received argument snippets.

### ⚙️ Configuration (bridge.*)

Settings appear under **Copilot Bridge** in VS Code settings:

| Setting | Default | Description |
|---|---|---|
| bridge.enabled | false | Start the bridge automatically when VS Code launches. |
| bridge.host | 127.0.0.1 | Bind address. Keep it on loopback for safety. |
| bridge.port | 0 | HTTP port (0 requests an ephemeral port). |
| bridge.token | "" | Optional bearer token enforced on every request. |
| bridge.historyWindow | 3 | User/assistant turns retained; system prompt is tracked separately. |
| bridge.maxConcurrent | 1 | Max simultaneous `/v1/chat/completions`; additional requests get 429. |
| bridge.verbose | false | Verbose logs in the “Copilot Bridge” Output channel. |

Status bar: `Copilot Bridge: OK @ 127.0.0.1:12345` (or similar) shows when the server is ready.

### 🧾 Logs & diagnostics

1. (Optional) Enable `bridge.verbose`.
2. Open **View → Output → “Copilot Bridge”**.
3. Trigger requests to inspect HTTP traces, model selection, SSE lifecycle, and health updates.

If Copilot or the Language Model API isn’t available, the output channel explains the reason along with the health status code.

### 🔒 Security posture

> [!WARNING]
> Never expose the bridge to remote interfaces. It is intended for single-user, local workflows only.

- Binds to `127.0.0.1` by default; do not expose it to remote interfaces.
- Set `bridge.token` to require `Authorization: Bearer <token>` on each request.
- Designed for single-user, local workflows and experiments.

### 🚑 Troubleshooting

`/health` may report `copilot: "unavailable"` with reason codes such as:

- `missing_language_model_api` — VS Code API not available.
- `copilot_model_unavailable` — No Copilot models selectable.
- `not_found` — Requested model/family missing.
- `consent_required`, `rate_limited`, `copilot_unavailable` — Provider-specific or transient issues.

`POST /v1/chat/completions` returns `503` with similar reasons when Copilot cannot handle the request.

### 🛠️ Development workflow

- Build once: `npm run compile`
- Watch mode: `npm run watch`
- Entry point: `src/extension.ts`

## 🗂️ Changelog

- **v1.1.0** — Simplified architecture with emphasis on faster inference (20–30% improvement).
- **v1.0.0** — Modular architecture refactor, OpenAI typings, and tool-calling support.
- **v0.2.2** — Polka HTTP integration and improved model family selection.
- **v0.1.5** — Server lifecycle fixes and enhanced error handling.
- **v0.1.4** — Dynamic Copilot model listing via the Language Model API.
- **v0.1.3** — Migration to the Language Model API with robust guards and reason codes.
- **v0.1.0** — Initial OpenAI-compatible bridge with SSE streaming.

## 📄 License

Apache-2.0
