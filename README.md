# VS Code Copilot Bridge (Desktop, Inference-only)

Local OpenAI-compatible HTTP facade to GitHub Copilot Chat via the VS Code Chat provider.

- Endpoints (local-only, default bind 127.0.0.1):
  - POST /v1/chat/completions (SSE streaming; use "stream": false for non-streaming)
  - GET /v1/models (synthetic listing: gpt-4o-copilot)
  - GET /healthz (ok/unavailable + vscode.version)

- Copilot pipe: vscode.chat.requestChatAccess('copilot') → startSession().sendRequest({ prompt })

- Prompt normalization: last system message + last N user/assistant turns (default 3) rendered as:
  [SYSTEM]
  …
  [DIALOG]
  user: …
  assistant: …

- Security: loopback-only binding by default; optional Authorization: Bearer <token>.

## Install, Build, and Run

Prerequisites:
- VS Code Desktop (stable), GitHub Copilot signed in
- Node.js 18+ (recommended)
- npm

- Auto-recovery: the bridge re-requests Copilot access on each chat request if missing; no restart required after signing in. `/healthz` will best-effort recheck only when `bridge.verbose` is true.




Steps:
1) Install deps and compile:
   npm install
   npm run compile

2) Launch in VS Code (recommended for debugging):
   - Open this folder in VS Code
   - Press F5 to run the extension in a new Extension Development Host

3) Enable the bridge:
   - Command Palette → “Copilot Bridge: Enable”
   - Or set in settings: bridge.enabled = true
   - “Copilot Bridge: Status” shows the bound address/port and token requirement

Optional: Packaging a VSIX
- You can package with vsce (not included):
  npm i -g @vscode/vsce
  vsce package
- Then install the generated .vsix via “Extensions: Install from VSIX…”

## Configuration (bridge.*)

- bridge.enabled (boolean; default false): auto-start on VS Code startup
- bridge.host (string; default "127.0.0.1"): bind address (keep on loopback)
- bridge.port (number; default 0): 0 = ephemeral port
- bridge.token (string; default ""): optional bearer token; empty disables auth
- bridge.historyWindow (number; default 3): number of user/assistant turns to keep
- bridge.maxConcurrent (number; default 1): max concurrent chat requests; excess → 429
## Viewing logs

To see verbose logs:
1) Enable: Settings → search “Copilot Bridge” → enable “bridge.verbose”
2) Open: View → Output → select “Copilot Bridge” in the dropdown
3) Trigger a request (e.g., curl /v1/chat/completions). You’ll see:
   - HTTP request lines (method/path)
   - Access acquisition attempts (“Copilot access missing; attempting to acquire…”, “Copilot access acquired.”)
   - SSE lifecycle (“SSE start …”, “SSE end …”)
   - Health checks (best-effort access check when verbose is on)
- bridge.verbose (boolean; default false): verbose logs to “Copilot Bridge” output channel

## Manual Testing (curl)

Replace <port> with the port shown in “Copilot Bridge: Status”.

Health:
curl http://127.0.0.1:<port>/healthz

Models:
curl http://127.0.0.1:<port>/v1/models

Streaming completion:
curl -N -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-copilot","stream":true,"messages":[{"role":"user","content":"hello"}]}' \
  http://127.0.0.1:<port>/v1/chat/completions

Non-stream:
curl -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-copilot","stream":false,"messages":[{"role":"user","content":"hello"}]}' \
  http://127.0.0.1:<port>/v1/chat/completions

Auth (when bridge.token is set):
- Missing/incorrect Authorization: Bearer <token> → 401

Copilot unavailable:
- Sign out of GitHub Copilot; /healthz shows unavailable; POST returns 503 envelope

Concurrency:
- Fire 2+ concurrent requests; above bridge.maxConcurrent → 429 rate_limit_error

## Notes

- Desktop-only, in-process. No VS Code Server dependency.
- Single-user, local loopback. Do not expose to remote interfaces.
- Non-goals: tools/function calling emulation, workspace file I/O, multi-tenant proxying.

## Development

- Build: npm run compile
- Watch: npm run watch
- Main: src/extension.ts
- Local type shim for Chat API: src/vscode-chat-shim.d.ts (for TypeScript on stable @types/vscode)
