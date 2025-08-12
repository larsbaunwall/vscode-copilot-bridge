Copilot Bridge (OpenAI Facade + JSON-RPC)

Overview
- Runs inside VS Code Desktop.
- Exposes an OpenAI-style HTTP API and a JSON-RPC WebSocket tool bus.
- Uses Copilot Chat via the VS Code Chat API per request.

Endpoints
- HTTP (OpenAI-like), bind to 127.0.0.1 by default:
  - POST /v1/chat/completions (SSE)
  - GET /v1/models
  - GET /healthz

JSON-RPC (WebSocket)
- Methods:
  - mcp.fs.read { path }
  - mcp.fs.list { glob, limit }
  - mcp.search.code { query, glob, maxResults }
  - mcp.symbols.list { path }
  - mcp.edit.applyPatch { unifiedDiff, verify? }
  - mcp.format.apply { path }
  - mcp.imports.organize { path }

Commands
- Copilot Bridge: Enable
- Copilot Bridge: Disable
- Copilot Bridge: Status

Settings
- bridge.enabled (false)
- bridge.bindAddress ("127.0.0.1")
- bridge.openai.port (0 random)
- bridge.rpc.port (0 random)
- bridge.token ("")
- bridge.readOnly (true)
- bridge.history.maxTurns (3)

Example curl
curl -N -H "Content-Type: application/json" -d '{"model":"gpt-4o-copilot","stream":true,"messages":[{"role":"user","content":"hello"}]}' http://127.0.0.1:PORT/v1/chat/completions

Policy
- Optional .agent-policy.yaml at workspace root to allow/deny writes and shell.
- Writes are denied by default unless bridge.readOnly=false and policy allows.
