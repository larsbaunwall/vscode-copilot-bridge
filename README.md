<img src="images/icon.png" width="100" />

# Copilot Bridge (VS Code Extension)

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/thinkability.copilot-bridge)](https://marketplace.visualstudio.com/items?itemName=thinkability.copilot-bridge)
[![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/d/thinkability.copilot-bridge?label=installs)](https://marketplace.visualstudio.com/items?itemName=thinkability.copilot-bridge)

Expose GitHub Copilot as a local, OpenAI-compatible HTTP endpoint running inside VS Code. The bridge forwards chat requests to Copilot using the VS Code Language Model API and streams results back to you.

What you get:

- Local HTTP server (loopback-only by default)
- OpenAI-style endpoints and payloads
- Server-Sent Events (SSE) streaming for chat completions
- Dynamic listing of available Copilot chat models

Endpoints exposed:

- POST /v1/chat/completions — OpenAI-style chat API (streaming by default)
- GET  /v1/models — lists available Copilot models
- GET  /health — health + VS Code version

The extension will autostart and requires VS Code to be running.

## Changelog

- **v1.1.0** — Simplified architecture with focus on performance improvements. Copilot Bridge is now 20-30% faster doing raw inference.
- **v1.0.0** — Modular architecture refactor with service layer, OpenAI type definitions, and tool calling support
- **v0.2.2** — Polka HTTP server integration and model family selection improvements  
- **v0.1.5** — Server lifecycle fixes and improved error handling
- **v0.1.4** — Dynamic Copilot model listing via Language Model API
- **v0.1.3** — Migration to VS Code Language Model API with robust guards and reason codes
- **v0.1.0** — Initial OpenAI-compatible HTTP bridge to GitHub Copilot with SSE streaming

## Why this?

I was looking for a Github Copilot CLI experience along the likes of OpenAI Codex and Claude Code, but found a bit underwhelming support for that in the current offering. I thought this could be a stepping stone to a proper CLI (or agentic orchestration) built on-top of Github Copilot. While we await the real thing.

### Don't break your Copilot license

This extension enable you to use your Copilot outside of VS Code **for your own personal use only** obeying the same terms as set forth in the VS Code and Github Copilot terms of service.

Use at your own risk: You are solely responsible for adhering to the license terms of your Copilot subscription.

## Quick start

Requirements:

- VS Code Desktop with GitHub Copilot signed in
- If building locally: Node.js 18+ and npm

Steps (dev run):

1. Install and compile

```bash
npm install
npm run compile
```

1. Press F5 in VS Code to launch an Extension Development Host

1. In the Dev Host, enable the bridge

- Command Palette → “Copilot Bridge: Enable”
- Or set setting bridge.enabled = true

1. Check status

- Command Palette → “Copilot Bridge: Status” (shows bound address/port and whether a token is required)

Optional: package a VSIX

```bash
npm run package
```
Then install the generated .vsix via “Extensions: Install from VSIX…”.

## Use it

Replace PORT with what “Copilot Bridge: Status” shows.

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

- Non-streaming

```bash
curl -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-copilot","stream":false,"messages":[{"role":"user","content":"hello"}]}' \
  http://127.0.0.1:$PORT/v1/chat/completions
```

Tip: You can also pass a family like "gpt-4o" as model. If unavailable you’ll get 404 with code model_not_found.

### Using OpenAI SDK (Node.js)

Point your client to the bridge and use your token (if set) as apiKey.

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

## How it works

The extension uses VS Code’s Language Model API to select a GitHub Copilot chat model and forward your conversation. Messages are normalized to preserve the last system prompt and the most recent user/assistant turns (configurable window). Responses are streamed back via SSE or returned as a single JSON payload.

## Configuration (bridge.*)

Settings live under “Copilot Bridge” in VS Code settings:

| Setting | Default | Description |
|---|---|---|
| bridge.enabled | false | Start the bridge automatically when VS Code launches. |
| bridge.host | 127.0.0.1 | Bind address. Keep on loopback for safety. |
| bridge.port | 0 | Port for the HTTP server. 0 picks an ephemeral port. |
| bridge.token | "" | Optional bearer token. If set, requests must include `Authorization: Bearer <token>`. |
| bridge.historyWindow | 3 | Number of user/assistant turns kept (system message is tracked separately). |
| bridge.maxConcurrent | 1 | Maximum concurrent /v1/chat/completions; excess return 429. |
| bridge.verbose | false | Verbose logs in the “Copilot Bridge” Output channel. |

Status bar: Shows availability and bound address (e.g., “Copilot Bridge: OK @ 127.0.0.1:12345”).

## Endpoints

### GET /health

Returns `{ ok: true, copilot: "ok" | "unavailable", reason?: string, version: <vscode.version> }`.

### GET /v1/models

Returns `{ data: [{ id, object: "model", owned_by: "vscode-bridge" }] }`.

### POST /v1/chat/completions

OpenAI-style body with `messages` and optional `model` and `stream`. Streaming uses SSE with `data: { ... }` events and a final `data: [DONE]`.

Accepted model values:

- IDs from /v1/models (e.g., `gpt-4o-copilot`)
- Copilot family names (e.g., `gpt-4o`)
- `copilot` to allow default selection

Common errors:

- 401 unauthorized when token is set but header is missing/incorrect
- 404 model_not_found when the requested family/ID isn’t available
- 429 rate_limit_exceeded when above bridge.maxConcurrent
- 503 copilot_unavailable when the Language Model API or Copilot model isn’t available

## Logs and diagnostics

To view logs:

1. Enable “bridge.verbose” (optional)
1. View → Output → “Copilot Bridge”
1. Trigger requests to see HTTP lines, model selection, SSE lifecycle, and health messages

If the Language Model API is missing or your VS Code build doesn’t support it, you’ll see a message in the Output channel. Use a recent VS Code build and make sure GitHub Copilot is signed in.

## Security notes

- Binds to 127.0.0.1 by default. Do not expose to remote interfaces.
- Set `bridge.token` to require `Authorization: Bearer <token>` on every request.
- Single-user, local process; intended for local tooling and experiments.

## Troubleshooting

The `/health` endpoint may report `copilot: "unavailable"` for reasons like:

- missing_language_model_api — VS Code API not available
- copilot_model_unavailable — No Copilot models selectable
- not_found — Requested model/family not found
- consent_required, rate_limited, copilot_unavailable — provider-specific or transient issues

POST /v1/chat/completions returns 503 with similar reason codes when Copilot isn’t usable.

## Development

- Build: `npm run compile`
- Watch: `npm run watch`
- Entry point: `src/extension.ts`

## License

Apache-2.0
