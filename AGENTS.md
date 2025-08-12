Goals
	1.	Bridge Copilot Chat to an OpenAI‑style API so other local tools can “speak OpenAI” and get Copilot responses.
	2.	Provide optional tools (search/read/patch/format) over a JSON‑RPC IPC to enable plan→act loops from external orchestrators.
	3.	Run only inside a user’s running VS Code Desktop session—no server/daemon install, no VS Code Server dependency.
	4.	Respect safety & UX: local‑only networking by default, explicit enable/disable, minimal footprint.

Non‑goals
	•	No direct calls to private Copilot backends.
	•	No multi‑tenant proxying or remote exposure.
	•	No attempt to fully emulate OpenAI “tools/function calling” (unsupported by Copilot provider).

⸻

High‑level architecture

VS Code Desktop (running)
┌────────────────────────────────────────────────────────────────┐
│  Bridge Extension (Node in Extension Host)                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ OpenAI Facade (HTTP, 127.0.0.1:PORT)                     │  │
│  │  - /v1/chat/completions  (SSE)                           │  │
│  │  - /v1/models                                            │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ JSON-RPC IPC (WebSocket, 127.0.0.1:PORT2)                │  │
│  │  - mcp.fs.read / list                                    │  │
│  │  - mcp.search.code                                       │  │
│  │  - mcp.edit.applyPatch / format / organizeImports        │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Copilot Chat Pipe                                       │  │
│  │  vscode.chat.requestChatAccess('copilot')               │  │
│  │  access.startSession().sendRequest({ prompt, ... })     │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Workspace APIs                                           │  │
│  │  findTextInFiles / findFiles / WorkspaceEdit / tasks     │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘


⸻

Data flows

Chat (OpenAI facade)
	1.	Client → POST /v1/chat/completions (OpenAI‑shape, SSE requested).
	2.	Extension concatenates recent messages → prompt.
	3.	requestChatAccess('copilot') → startSession() → sendRequest({ prompt }).
	4.	Stream Copilot chunks → map to OpenAI SSE (data: {object:"chat.completion.chunk", ...}).
	5.	On end → send data: [DONE].

Tools (optional, JSON‑RPC)
	1.	Client → mcp.search.code / mcp.fs.read / mcp.edit.applyPatch.
	2.	Extension executes via VS Code APIs (read/find/apply/format).
	3.	Returns structured results/errors.

⸻

API contracts

OpenAI‑style /v1/chat/completions (subset)

Request

{
  "model": "gpt-4o-copilot",
  "stream": true,
  "messages": [
    {"role":"system","content":"You are a cautious coding assistant."},
    {"role":"user","content":"Refactor retry logic in PaymentClient."}
  ]
}

SSE Response

HTTP 200
Content-Type: text/event-stream

data: {"id":"cmp_...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Plan: "}}]}

data: {"id":"cmp_...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Update backoff…"}}]}
...
data: [DONE]

Notes
	•	Ignore unsupported fields (tools/function_call/logprobs/seed).
	•	model is passthrough (synthetic id), Copilot selects internals.
	•	Enforce small history window to keep prompts bounded.

JSON‑RPC (WebSocket), examples

Request

{"jsonrpc":"2.0","id":"1","method":"mcp.search.code","params":{"query":"class PaymentClient","glob":"src/**/*.ts","maxResults":200}}

Result

{"jsonrpc":"2.0","id":"1","result":{"hits":[{"file":"src/payment/Client.ts","line":12,"snippet":"class PaymentClient { ... }"}]}}

Edit apply

{"jsonrpc":"2.0","id":"2","method":"mcp.edit.applyPatch","params":{"unifiedDiff":"--- a/src/.."}}


⸻

Extension design

package.json (key points)
	•	"activationEvents": ["onStartupFinished"] or a command palette toggle.
	•	"contributes.commands":
	•	bridge.enable, bridge.disable (start/stop servers)
	•	bridge.status (port info, copilot availability)
	•	"contributes.configuration": bridge.openai.port, bridge.rpc.port, bridge.bindAddress (default 127.0.0.1), bridge.readOnly (default true).

Lifecycle
	•	On activate:
	•	Check user setting bridge.enabled.
	•	Verify Copilot availability (requestChatAccess('copilot')), store a lazy accessor.
	•	Start OpenAI facade server (HTTP) and RPC server (WS) with localhost binding.
	•	Surface a status bar item: “Bridge: ON (127.0.0.1:PORT)”.
	•	On deactivate or bridge.disable:
	•	Close servers, dispose listeners.

Copilot Chat Pipe
	•	Keep no long‑lived chat session—create per request:

const access = await vscode.chat.requestChatAccess('copilot');
const session = await access.startSession();
const stream = await session.sendRequest({ prompt, attachments: [] });


	•	Subscribe to streaming events and forward to SSE.

OpenAI Facade (HTTP, inside extension)
	•	Implement with http or express (simple router).
	•	Endpoints:
	•	POST /v1/chat/completions → SSE
	•	GET /v1/models → synthetic listing
	•	GET /healthz → { ok, copilot: "ok|unavailable" }
	•	Message normalization:
	•	Concatenate messages into a single prompt:
	•	Keep latest system and last N user/assistant turns (N configurable, default 3).
	•	Format as:

[SYSTEM]
...
[DIALOG]
user: ...
assistant: ...
user: ...


	•	SSE mapping: each Copilot chunk → one OpenAI delta with content text; close with [DONE].

JSON‑RPC Tool Bus (WebSocket)
	•	Methods (prefix mcp.):
	•	fs.read({path}) -> {content, sha256}
	•	fs.list({glob,limit}) -> {files[]}
	•	search.code({query,glob,maxResults}) -> {hits[]} using findTextInFiles
	•	symbols.list({path}) -> {symbols[]}
	•	edit.applyPatch({unifiedDiff,verify?true}) -> {ok, conflicts[]}
	•	format.apply({path}) -> {ok}
	•	imports.organize({path}) -> {ok}
	•	(optional) task.run({name}), shell.run({cmd}) (guarded)
	•	Edit safety:
	•	Default read‑only; require explicit setting bridge.readOnly=false or a consent prompt to enable writes.
	•	Maintain preimage verification: compute hashes for target ranges before applying WorkspaceEdit.
	•	Always save file after apply; optionally run format and organizeImports.

Policy controls
	•	.agent-policy.yaml in workspace root:

writes:
  allow: ["src/**/*.ts","test/**/*.ts"]
  deny:  ["**/node_modules/**","**/dist/**"]
shell:
  allow: ["npm test","dotnet test"]


	•	Reject edit.applyPatch and shell.run if policy denies.

Security defaults
	•	Bind servers to 127.0.0.1 only.
	•	Random ephemeral ports on first run; store in globalState.
	•	Optional bearer token for the OpenAI facade (bridge.token); otherwise restrict to loopback.
	•	No persistence of Copilot tokens; VS Code manages auth.

⸻

Implementation notes (guidance for the AI agent)

1) Create extension skeleton
	•	Use yo code (TypeScript).
	•	Add deps: ws (WebSocket), optionally express, yaml.
	•	Wire commands bridge.enable/disable/status.

2) Copilot availability check

let chatAccess: vscode.ChatAccess | undefined;
async function ensureCopilotAccess() {
  try { chatAccess = await vscode.chat.requestChatAccess('copilot'); }
  catch { chatAccess = undefined; }
  return !!chatAccess;
}

3) OpenAI facade server (SSE)
	•	Start HTTP server on 127.0.0.1:<port>.
	•	For /v1/chat/completions:
	•	Validate messages, stream === true; if not streaming, still return a single chunk then [DONE].
	•	Build prompt string.
	•	const session = await chatAccess!.startSession(); const stream = await session.sendRequest({ prompt }).
	•	Map stream.onDidProduceContent → res.write("data: <chunk>\n\n") with OpenAI envelope.
	•	On end/error → res.write("data: [DONE]\n\n"); res.end();.

4) JSON‑RPC WS server
	•	Start ws.Server({ host:"127.0.0.1", port }).
	•	Envelope:
	•	Validate jsonrpc, id, method.
	•	Dispatch to handlers with params.
	•	Handlers:
	•	search.code: call vscode.workspace.findTextInFiles with include pattern; for each match, collect file path, line, short snippet (e.g., ±3 lines).
	•	edit.applyPatch: parse unified diff → WorkspaceEdit:
	•	Open doc, compute line ranges, verify preimage (optional hash in diff metadata), apply replacements, save.
	•	After apply: vscode.commands.executeCommand('editor.action.formatDocument') and organize imports (language‑specific commands).
	•	Normalize paths with vscode.Uri.file.

5) Diff parsing & preimage checks
	•	Import a small unified diff parser or implement:
	•	Parse files as --- a/… / +++ b/…, hunks @@ -l,s +l,s @@.
	•	For each hunk, compute target ranges and replacement text.
	•	Preimage:
	•	Option A: lightweight—compare expected lines in hunk with current doc slice.
	•	Option B: embed span hashes in a custom header in the diff; verify before apply.

6) UX glue
	•	Status bar item shows: “Bridge: ON · Chat: OK/Unavailable”.
	•	Output channel “Copilot Bridge” for logs and port info.
	•	Command bridge.status dumps:
	•	Copilot avail
	•	OpenAI endpoint URL
	•	RPC endpoint URL
	•	Policy: read‑only/writable

7) Error handling
	•	Map Copilot errors to 5xx in OpenAI facade with JSON payload:

{"error":{"message":"Copilot unavailable","type":"server_error","code":"copilot_unavailable"}}


	•	For JSON‑RPC: return {"error":{"code":<int>,"message":"…"}}.

8) Testing strategy
	•	Unit: diff parser, search aggregations.
	•	Integration:
	•	Start VS Code, enable bridge, curl -N http://127.0.0.1:<port>/v1/chat/completions with a trivial prompt → streamed chunks.
	•	JSON‑RPC: create a sample workspace, run search.code, assert hits; run edit.applyPatch with a known diff, assert file content and formatting.

⸻

Example stubs

extension.ts (skeleton)

import * as vscode from 'vscode';
import { createHttpFacade } from './http/openai';
import { createRpcServer } from './rpc/server';

let httpClose: (() => Promise<void>) | undefined;
let rpcClose: (() => Promise<void>) | undefined;
let chatAccess: vscode.ChatAccess | undefined;

export async function activate(ctx: vscode.ExtensionContext) {
  const ok = await ensureCopilot();
  const { httpServer, close: closeHttp } = await createHttpFacade(() => chatAccess);
  const { server: rpcServer, close: closeRpc } = await createRpcServer(ctx);

  httpClose = closeHttp; rpcClose = closeRpc;

  vscode.window.setStatusBarMessage(`Bridge: ON · Chat: ${ok ? 'OK' : 'Unavailable'}`);

  ctx.subscriptions.push(
    vscode.commands.registerCommand('bridge.status', async () => {
      const msg = `Chat: ${ok}\nHTTP: ${httpServer.address()}\nRPC: ${rpcServer.address()}`;
      vscode.window.showInformationMessage(msg);
    }),
    { dispose: async () => { await Promise.all([httpClose?.(), rpcClose?.()]); } }
  );

  async function ensureCopilot() {
    try { chatAccess = await vscode.chat.requestChatAccess('copilot'); return true; }
    catch { chatAccess = undefined; return false; }
  }
}

http/openai.ts (key pieces)

import * as http from 'http';
import * as vscode from 'vscode';

export function createHttpFacade(getAccess: () => vscode.ChatAccess | undefined) {
  const port = pickPort();
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url?.startsWith('/v1/chat/completions')) {
      const access = getAccess();
      if (!access) return sendError(res, 503, 'Copilot unavailable');
      const body = await readJson(req);
      const prompt = normalizeMessages(body.messages);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      const session = await access.startSession();
      const stream = await session.sendRequest({ prompt, attachments: [] });
      const id = `cmp_${Math.random().toString(36).slice(2)}`;
      const send = (text: string) => {
        res.write(`data: ${JSON.stringify({
          id, object:'chat.completion.chunk',
          choices:[{ index:0, delta:{ content:text } }]
        })}\n\n`);
      };
      const d1 = stream.onDidProduceContent(c => send(c));
      const d2 = stream.onDidEnd(() => { res.write(`data: [DONE]\n\n`); res.end(); d1.dispose(); d2.dispose(); });
      req.on('close', () => { d1.dispose(); d2.dispose(); });
      return;
    }
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ data:[{ id:'gpt-4o-copilot', object:'model', owned_by:'vscode-bridge' }] }));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port, '127.0.0.1');
  return { httpServer: server, close: async () => new Promise<void>(r => server.close(() => r())) };
}

rpc/server.ts (skeleton)

import WebSocket, { WebSocketServer } from 'ws';
import * as vscode from 'vscode';
import { applyUnifiedDiff } from '../utils/diff';

export function createRpcServer(ctx: vscode.ExtensionContext) {
  const port = pickPort();
  const wss = new WebSocketServer({ host:'127.0.0.1', port });
  wss.on('connection', ws => {
    ws.on('message', async (raw) => {
      try {
        const { id, method, params } = JSON.parse(raw.toString());
        if (method === 'mcp.search.code') {
          const hits: any[] = [];
          await vscode.workspace.findTextInFiles({ pattern: params.query },
            { include: new vscode.RelativePattern(vscode.workspace.workspaceFolders![0], params.glob ?? '**/*'),
              maxResults: params.maxResults ?? 200 },
            r => hits.push({ file:r.uri.fsPath, line:r.ranges[0].start.line }));
          ws.send(JSON.stringify({ jsonrpc:'2.0', id, result:{ hits } }));
          return;
        }
        if (method === 'mcp.edit.applyPatch') {
          const ok = await applyUnifiedDiff(params.unifiedDiff);
          ws.send(JSON.stringify({ jsonrpc:'2.0', id, result:{ ok } }));
          return;
        }
        ws.send(JSON.stringify({ jsonrpc:'2.0', id, error:{ code:-32601, message:'Method not found' }}));
      } catch (e:any) {
        ws.send(JSON.stringify({ jsonrpc:'2.0', id:null, error:{ code:-32603, message:e?.message ?? 'Internal error' }}));
      }
    });
  });
  ctx.subscriptions.push({ dispose: () => wss.close() });
  return { server: wss, close: async () => new Promise<void>(r => { wss.close(() => r()); }) };
}


⸻

Configuration & UX
	•	Settings (bridge.*):
	•	enabled (bool), bindAddress (default 127.0.0.1), openai.port (int), rpc.port (int), token (string), readOnly (bool).
	•	Commands:
	•	Enable/Disable: starts/stops servers and updates status bar.
	•	Status: shows ports, health, policy state.
	•	Output channel logs significant events (start/stop, errors).

⸻

Testing checklist
	1.	OpenAI facade
	•	curl -N -H "Content-Type: application/json" -d '{"model":"gpt-4o-copilot","stream":true,"messages":[{"role":"user","content":"hello"}]}' http://127.0.0.1:<port>/v1/chat/completions
	•	Expect streamed chunks and [DONE].
	2.	Search/edit
	•	Connect WS client; call mcp.search.code for a known string; verify hits.
	•	Apply a controlled unified diff; verify file saved and formatted.
	3.	Safety
	•	With readOnly=true, mcp.edit.applyPatch should return policy error.
	•	With .agent-policy.yaml denying path, write should be rejected.
	4.	Resilience
	•	Kill and restart Copilot auth (sign out/in) → /healthz and facade should report unavailability then recover.

⸻

Operational guidance
	•	Local only: keep default binding to 127.0.0.1; require a token to bind beyond loopback (not recommended).
	•	Per‑user: one desktop session, one bridge. Do not expose externally or share across users.
	•	No caching to bypass usage controls; treat the bridge as a convenience, not a relay service.

⸻