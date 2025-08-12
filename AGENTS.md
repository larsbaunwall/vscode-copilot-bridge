# Inference‑Only Copilot Bridge (VS Code Desktop)

## Scope & Goals

Expose a **local, OpenAI‑compatible chat endpoint** inside a **running VS Code Desktop** session that forwards requests to **GitHub Copilot Chat** via the **VS Code Chat provider**. No workspace tools (no search/edit), no VS Code Server.

- Endpoints:
  - `POST /v1/chat/completions` (supports streaming via SSE)
  - `GET /v1/models` (synthetic listing)
  - `GET /healthz` (status)
- Local only (`127.0.0.1`), single user, opt‑in via VS Code settings/command.
- Minimal state: one Copilot session per request; no history persisted by the bridge.

**Non‑goals:** multi‑tenant proxying, private endpoint scraping, file I/O tools, function/tool calling emulation.

---

## Architecture (Desktop‑only, in‑process)

```
VS Code Desktop (running)
┌──────────────────────────────────────────────────────────────┐
│ Bridge Extension (TypeScript, Extension Host)                │
│  - HTTP server on 127.0.0.1:<port>                           │
│  - POST /v1/chat/completions  → Copilot Chat provider        │
│  - GET  /v1/models (synthetic)                               │
│  - GET  /healthz                                             │
│ Copilot pipe:                                                │
│  vscode.chat.requestChatAccess('copilot')                    │
│    → access.startSession().sendRequest({ prompt, ... })      │
└──────────────────────────────────────────────────────────────┘
```

### Data flow
Client (OpenAI API shape) → Bridge HTTP → normalize messages → `requestChatAccess('copilot')` → `startSession().sendRequest` → stream chunks → SSE to client.

---

## API Contract (subset, OpenAI‑compatible)

### POST `/v1/chat/completions`
**Accepted fields**
- `model`: string (ignored internally, echoed back as synthetic id).
- `messages`: array of `{role, content}`; roles: `system`, `user`, `assistant`.
- `stream`: boolean (default `true`). If `false`, return a single JSON completion.

**Ignored fields**  
`tools`, `function_call/tool_choice`, `temperature`, `top_p`, `logprobs`, `seed`, penalties, `response_format`, `stop`, `n`.

**Prompt normalization**
- Keep the last **system** message and the last **N** user/assistant turns (configurable, default 3) to bound prompt size.
- Render into a single text prompt:

```
[SYSTEM]
<system text>

[DIALOG]
user: ...
assistant: ...
user: ...
```

**Streaming response (SSE)**
- For each Copilot content chunk:

```
data: {"id":"cmp_<uuid>","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"<chunk>"}}]}
```

- Terminate with:

```
data: [DONE]
```

**Non‑streaming response**

```json
{
  "id": "cmpl_<uuid>",
  "object": "chat.completion",
  "choices": [
    { "index": 0, "message": { "role": "assistant", "content": "<full text>" }, "finish_reason": "stop" }
  ]
}
```

### GET `/v1/models`

```json
{
  "data": [
    { "id": "gpt-4o-copilot", "object": "model", "owned_by": "vscode-bridge" }
  ]
}
```

### GET `/healthz`

```json
{ "ok": true, "copilot": "ok", "version": "<vscode.version>" }
```

### Error envelope (OpenAI‑style)

```json
{ "error": { "message": "Copilot unavailable", "type": "server_error", "code": "copilot_unavailable" } }
```

---

## Extension Design

### `package.json` (relevant)
- `activationEvents`: `onStartupFinished` (and commands).
- `contributes.commands`: `bridge.enable`, `bridge.disable`, `bridge.status`.
- `contributes.configuration` (under `bridge.*`):
  - `enabled` (bool; default `false`)
  - `host` (string; default `"127.0.0.1"`)
  - `port` (int; default `0` = random ephemeral)
  - `token` (string; optional bearer; empty means no auth, still loopback only)
  - `historyWindow` (int; default `3`)

### Lifecycle
- On activate:
  1. Check `bridge.enabled`; if false, return.
  2. Attempt `vscode.chat.requestChatAccess('copilot')`; cache access if granted.
  3. Start HTTP server bound to loopback.
  4. Status bar item: `Copilot Bridge: OK/Unavailable @ <host>:<port>`.
- On deactivate/disable: close server, dispose listeners.

### Copilot Hook

```ts
const access = await vscode.chat.requestChatAccess('copilot');   // per enable or per request
const session = await access.startSession();
const stream  = await session.sendRequest({ prompt, attachments: [] });
// stream.onDidProduceContent(text => ...)
// stream.onDidEnd(() => ...)
```

---

## Implementation Notes
- **HTTP server:** Node `http` or a tiny `express` router. Keep it minimal to reduce dependencies.
- **Auth:** optional `Authorization: Bearer <token>`; recommended for local automation. Reject mismatches with 401.
- **Backpressure:** serialize requests or cap concurrency (configurable). If Copilot throttles, return 429 with `Retry-After`.
- **Message normalization:**
  - Coerce content variants (`string`, arrays, objects with `text`) into plain strings.
  - Join multi‑part content with `\n`.
- **Streaming:**
  - Set headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
  - Flush after each chunk; handle client disconnect by disposing stream subscriptions.
- **Non‑stream:** buffer chunks; return a single completion object.
- **Errors:** `503` when Copilot access unavailable; `400` for invalid payloads; `500` for unexpected failures.
- **Logging:** VS Code Output channel: start/stop, port, errors (no prompt bodies unless user enables verbose logging).
- **UX:** `bridge.status` shows availability, bound address/port, and whether a token is required; status bar indicator toggles on availability.

---

## Security & Compliance
- Local only: default bind to `127.0.0.1`; no remote exposure.
- Single user: relies on the user’s authenticated VS Code Copilot session; bridge does not handle tokens.
- No scraping/private endpoints: all calls go through the VS Code Chat provider.
- No multi‑tenant/proxying: do not expose to others; treat as a personal developer convenience.

---

## Testing Plan
1. **Health**
   ```bash
   curl http://127.0.0.1:<port>/healthz
   ```
   Expect `{ ok: true, copilot: "ok" }` when signed in.

2. **Streaming completion**
   ```bash
   curl -N -H "Content-Type: application/json" \
     -d '{"model":"gpt-4o-copilot","stream":true,"messages":[{"role":"user","content":"hello"}]}' \
     http://127.0.0.1:<port>/v1/chat/completions
   ```
   Expect multiple `data:` chunks and `[DONE]`.

3. **Non‑stream** (`"stream": false`) → single JSON completion.

4. **Bearer** (when configured): missing/incorrect token → `401`.

5. **Unavailable**: sign out of Copilot → `/healthz` shows `unavailable`; POST returns `503`.

6. **Concurrency/throttle**: fire two requests; verify cap or serialized handling.

---

## Minimal Code Skeleton

### `src/extension.ts`

```ts
import * as vscode from 'vscode';
import * as http from 'http';

let server: http.Server | undefined;
let access: vscode.ChatAccess | undefined;

export async function activate(ctx: vscode.ExtensionContext) {
  const cfg = vscode.workspace.getConfiguration('bridge');
  if (!cfg.get<boolean>('enabled')) return;

  try { access = await vscode.chat.requestChatAccess('copilot'); }
  catch { access = undefined; }

  const host = cfg.get<string>('host') ?? '127.0.0.1';
  const portCfg = cfg.get<number>('port') ?? 0;
  const token = (cfg.get<string>('token') ?? '').trim();
  const hist = cfg.get<number>('historyWindow') ?? 3;

  server = http.createServer(async (req, res) => {
    try {
      if (token && req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error:{ message:'unauthorized' } }));
        return;
      }
      if (req.method === 'GET' && req.url === '/healthz') {
        res.writeHead(200, { 'Content-Type':'application/json' });
        res.end(JSON.stringify({ ok: !!access, copilot: access ? 'ok':'unavailable', version: vscode.version }));
        return;
      }
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type':'application/json' });
        res.end(JSON.stringify({ data:[{ id:'gpt-4o-copilot', object:'model', owned_by:'vscode-bridge' }] }));
        return;
      }
      if (req.method === 'POST' && req.url?.startsWith('/v1/chat/completions')) {
        if (!access) {
          res.writeHead(503, { 'Content-Type':'application/json' });
          res.end(JSON.stringify({ error:{ message:'Copilot unavailable', type:'server_error', code:'copilot_unavailable' } }));
          return;
        }
        const body = await readJson(req);
        const prompt = normalizeMessages(body?.messages ?? [], hist);
        const streamMode = body?.stream !== false; // default=true
        const session = await access.startSession();
        const chatStream = await session.sendRequest({ prompt, attachments: [] });

        if (streamMode) {
          res.writeHead(200, {
            'Content-Type':'text/event-stream',
            'Cache-Control':'no-cache',
            'Connection':'keep-alive'
          });
          const id = `cmp_${Math.random().toString(36).slice(2)}`;
          const h1 = chatStream.onDidProduceContent((chunk) => {
            res.write(`data: ${JSON.stringify({
              id, object:'chat.completion.chunk',
              choices:[{ index:0, delta:{ content: chunk } }]
            })}\n\n`);
          });
          const endAll = () => {
            res.write('data: [DONE]\n\n'); res.end();
            h1.dispose(); h2.dispose();
          };
          const h2 = chatStream.onDidEnd(endAll);
          req.on('close', endAll);
          return;
        } else {
          let buf = '';
          const h1 = chatStream.onDidProduceContent((chunk) => { buf += chunk; });
          await new Promise<void>(resolve => {
            const h2 = chatStream.onDidEnd(() => { h1.dispose(); h2.dispose(); resolve(); });
          });
          res.writeHead(200, { 'Content-Type':'application/json' });
          res.end(JSON.stringify({
            id:`cmpl_${Math.random().toString(36).slice(2)}`,
            object:'chat.completion',
            choices:[{ index:0, message:{ role:'assistant', content: buf }, finish_reason:'stop' }]
          }));
          return;
        }
      }
      res.writeHead(404).end();
    } catch (e:any) {
      res.writeHead(500, { 'Content-Type':'application/json' });
      res.end(JSON.stringify({ error:{ message: e?.message ?? 'internal_error', type:'server_error', code:'internal_error' } }));
    }
  });

  server.listen(portCfg, host, () => {
    const addr = server!.address();
    const shown = typeof addr === 'object' && addr ? `${addr.address}:${addr.port}` : `${host}:${portCfg}`;
    vscode.window.setStatusBarMessage(`Copilot Bridge: ${access ? 'OK' : 'Unavailable'} @ ${shown}`);
  });

  ctx.subscriptions.push({ dispose: () => server?.close() });
}

export function deactivate() {
  server?.close();
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = ''; req.on('data', c => data += c);
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function normalizeMessages(messages: any[], histWindow: number): string {
  const system = messages.filter((m:any) => m.role === 'system').pop()?.content;
  const turns = messages.filter((m:any) => m.role === 'user' || m.role === 'assistant').slice(-histWindow*2);
  const dialog = turns.map((m:any) => `${m.role}: ${asText(m.content)}`).join('\n');
  return `${system ? `[SYSTEM]\n${asText(system)}\n\n` : ''}[DIALOG]\n${dialog}`;
}

function asText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(asText).join('\n');
  if ((content as any)?.text) return (content as any).text;
  try { return JSON.stringify(content); } catch { return String(content); }
}
```

---

## Delivery Checklist
- Extension skeleton with settings + commands.
- HTTP server (loopback), `/healthz`, `/v1/models`, `/v1/chat/completions`.
- Copilot access + session streaming.
- Prompt normalization (system + last N turns).
- SSE mapping and non‑stream fallback.
- Optional bearer token check.
- Status bar + Output channel diagnostics.
- Tests: health, streaming, non‑stream, auth, unavailability.
- 