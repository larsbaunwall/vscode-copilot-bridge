import * as vscode from 'vscode';
import * as http from 'http';
import { AddressInfo } from 'net';

let server: http.Server | undefined;
let modelCache: any | undefined;
let statusItem: vscode.StatusBarItem | undefined;
let output: vscode.OutputChannel | undefined;
let running = false;
let activeRequests = 0;
let lastReason: string | undefined;

export async function activate(ctx: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel('Copilot Bridge');
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.text = 'Copilot Bridge: Disabled';
  statusItem.show();
  ctx.subscriptions.push(statusItem, output);

  ctx.subscriptions.push(vscode.commands.registerCommand('bridge.enable', async () => {
    await startBridge();
    await getModel(true);
  }));
  ctx.subscriptions.push(vscode.commands.registerCommand('bridge.disable', async () => {
    await stopBridge();
  }));
  ctx.subscriptions.push(vscode.commands.registerCommand('bridge.status', async () => {
    const info = server ? server.address() : undefined;
    const bound = info && typeof info === 'object' ? `${info.address}:${info.port}` : 'n/a';
    const needsToken = !!(vscode.workspace.getConfiguration('bridge').get<string>('token') || '').trim();
    vscode.window.showInformationMessage(`Copilot Bridge: ${running ? 'Enabled' : 'Disabled'} | Bound: ${bound} | Token: ${needsToken ? 'Set' : 'None'}`);
  }));

  const cfg = vscode.workspace.getConfiguration('bridge');
  if (cfg.get<boolean>('enabled')) {
    await startBridge();
  }
}

export async function deactivate() {
  await stopBridge();
}

async function startBridge() {
  if (running) return;
  running = true;

  const cfg = vscode.workspace.getConfiguration('bridge');
  const host = cfg.get<string>('host') ?? '127.0.0.1';
  const portCfg = cfg.get<number>('port') ?? 0;
  const token = (cfg.get<string>('token') ?? '').trim();
  const hist = cfg.get<number>('historyWindow') ?? 3;
  const verbose = cfg.get<boolean>('verbose') ?? false;
  const maxConc = cfg.get<number>('maxConcurrent') ?? 1;

  try {
    server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
      try {
        if (verbose) output?.appendLine(`HTTP ${req.method} ${req.url}`);
        if (token && req.headers.authorization !== `Bearer ${token}`) {
          writeJson(res, 401, { error: { message: 'unauthorized', type: 'invalid_request_error', code: 'unauthorized' } });
          return;
        }
        if (req.method === 'POST' && req.url?.startsWith('/v1/chat/completions')) {
          if (activeRequests >= maxConc) {
            res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '1' });
            res.end(JSON.stringify({ error: { message: 'too many requests', type: 'rate_limit_error', code: 'rate_limit_exceeded' } }));
            if (verbose) output?.appendLine(`429 throttled (active=${activeRequests}, max=${maxConc})`);
            return;
          }
        }

        if (req.method === 'GET' && req.url === '/healthz') {
          const cfgNow = vscode.workspace.getConfiguration('bridge');
          const verboseNow = cfgNow.get<boolean>('verbose') ?? false;
          const hasLM = !!((vscode as any).lm && typeof (vscode as any).lm.selectChatModels === 'function');
          if (!modelCache && verboseNow) {
            output?.appendLine(`Healthz: model=${modelCache ? 'present' : 'missing'} lmApi=${hasLM ? 'ok' : 'missing'}`);
            await getModel();
          }
          const unavailableReason = modelCache ? undefined : (!hasLM ? 'missing_language_model_api' : (lastReason || 'copilot_model_unavailable'));
          writeJson(res, 200, { ok: true, copilot: modelCache ? 'ok' : 'unavailable', reason: unavailableReason, version: vscode.version });
          return;
        }

        if (req.method === 'GET' && req.url === '/v1/models') {
          writeJson(res, 200, { data: [{ id: 'gpt-4o-copilot', object: 'model', owned_by: 'vscode-bridge' }] });
          return;
        }

        if (req.method === 'POST' && req.url?.startsWith('/v1/chat/completions')) {
          let model = await getModel();
          if (!model) {
            const hasLM = !!((vscode as any).lm && typeof (vscode as any).lm.selectChatModels === 'function');
            const reason = !hasLM ? 'missing_language_model_api' : (lastReason || 'copilot_model_unavailable');
            writeJson(res, 503, { error: { message: 'Copilot unavailable', type: 'server_error', code: 'copilot_unavailable', reason } });
            return;
          }

          activeRequests++;
          if (verbose) output?.appendLine(`Request started (active=${activeRequests})`);
          try {
            const body = await readJson(req);
            const messages = Array.isArray(body?.messages) ? body.messages : null;
            if (!messages || messages.length === 0 || !messages.every((m: any) =>
              m && typeof m.role === 'string' &&
              /^(system|user|assistant)$/.test(m.role) &&
              m.content !== undefined && m.content !== null
            )) {
              writeJson(res, 400, { error: { message: 'invalid request', type: 'invalid_request_error', code: 'invalid_payload' } });
              return;
            }
            const lmMessages = normalizeMessagesLM(messages, hist);
            const streamMode = body?.stream !== false;

            if (verbose) output?.appendLine('Sending request to Copilot via Language Model API...');
            const cts = new vscode.CancellationTokenSource();
            const response = await (model as any).sendRequest(lmMessages, {}, cts.token);

            if (streamMode) {
              res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
              });
              const id = `cmp_${Math.random().toString(36).slice(2)}`;
              if (verbose) output?.appendLine(`SSE start id=${id}`);
              try {
                for await (const fragment of response.text as AsyncIterable<string>) {
                  const payload = {
                    id,
                    object: 'chat.completion.chunk',
                    choices: [{ index: 0, delta: { content: fragment } }]
                  };
                  res.write(`data: ${JSON.stringify(payload)}\n\n`);
                }
                if (verbose) output?.appendLine(`SSE end id=${id}`);
                res.write('data: [DONE]\n\n');
                res.end();
              } catch (e: any) {
                throw e;
              }
              return;
            } else {
              let buf = '';
              for await (const fragment of response.text as AsyncIterable<string>) {
                buf += fragment;
              }
              if (verbose) output?.appendLine(`Non-stream complete len=${buf.length}`);
              writeJson(res, 200, {
                id: `cmpl_${Math.random().toString(36).slice(2)}`,
                object: 'chat.completion',
                choices: [{ index: 0, message: { role: 'assistant', content: buf }, finish_reason: 'stop' }]
              });
              return;
            }
          } finally {
            activeRequests--;
            if (verbose) output?.appendLine(`Request complete (active=${activeRequests})`);
          }
        }

        res.writeHead(404).end();
      } catch (e: any) {
        output?.appendLine(`Error: ${e?.stack || e?.message || String(e)}`);
        modelCache = undefined;
        writeJson(res, 500, { error: { message: e?.message ?? 'internal_error', type: 'server_error', code: 'internal_error' } });
      }
    });

    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(portCfg, host, () => resolve());
    });

    const addr = server.address() as AddressInfo | null;
    const shown = addr ? `${addr.address}:${addr.port}` : `${host}:${portCfg}`;
    statusItem!.text = `Copilot Bridge: ${modelCache ? 'OK' : 'Unavailable'} @ ${shown}`;
    output?.appendLine(`Started at http://${shown} | Copilot: ${modelCache ? 'ok' : 'unavailable'}`);
    if (verbose) {
      const tokenSet = token ? 'set' : 'unset';
      output?.appendLine(`Config: host=${host} port=${addr?.port ?? portCfg} hist=${hist} maxConcurrent=${maxConc} token=${tokenSet}`);
    }
  } catch (e: any) {
    running = false;
    output?.appendLine(`Failed to start: ${e?.stack || e?.message || String(e)}`);
    statusItem!.text = 'Copilot Bridge: Error';
    throw e;
  }
}

async function stopBridge() {
  if (!running) return;
  running = false;
  try {
    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
    });
  } finally {
    server = undefined;
    modelCache = undefined;
    statusItem && (statusItem.text = 'Copilot Bridge: Disabled');
    output?.appendLine('Stopped');
  }
}

function toText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(toText).join('\n');
  if (content && typeof content === 'object' && typeof content.text === 'string') return content.text;
  try { return JSON.stringify(content); } catch { return String(content); }
}

function normalizeMessagesLM(messages: any[], histWindow: number): any[] {
  const sys = messages.filter((m) => m && m.role === 'system').pop();
  const turns = messages.filter((m) => m && (m.role === 'user' || m.role === 'assistant')).slice(-histWindow * 2);

  const User = (vscode as any).LanguageModelChatMessage?.User;
  const Assistant = (vscode as any).LanguageModelChatMessage?.Assistant;

  const result: any[] = [];
  let firstUserSeen = false;

  for (const m of turns) {
    if (m.role === 'user') {
      let text = toText(m.content);
      if (!firstUserSeen && sys) {
        text = `[SYSTEM]\n${toText(sys.content)}\n\n[DIALOG]\nuser: ${text}`;
        firstUserSeen = true;
      }
      result.push(User ? User(text) : { role: 'user', content: text });
    } else if (m.role === 'assistant') {
      const text = toText(m.content);
      result.push(Assistant ? Assistant(text) : { role: 'assistant', content: text });
    }
  }

  if (!firstUserSeen && sys) {
    const text = `[SYSTEM]\n${toText(sys.content)}`;
    result.unshift(User ? User(text) : { role: 'user', content: text });
  }

  if (result.length === 0) {
    result.push(User ? User('') : { role: 'user', content: '' });
  }

  return result;
}

async function getModel(force = false): Promise<any | undefined> {
  if (!force && modelCache) return modelCache;
  const cfg = vscode.workspace.getConfiguration('bridge');
  const verbose = cfg.get<boolean>('verbose') ?? false;

  const hasLM = !!((vscode as any).lm && typeof (vscode as any).lm.selectChatModels === 'function');
  if (!hasLM) {
    modelCache = undefined;
    lastReason = 'missing_language_model_api';
    const info = server ? server.address() : undefined;
    const bound = info && typeof info === 'object' ? `${info.address}:${info.port}` : '';
    statusItem && (statusItem.text = `Copilot Bridge: Unavailable ${bound ? `@ ${bound}` : ''}`);
    if (verbose) output?.appendLine('VS Code Language Model API not available; update VS Code or enable proposed API (Insiders/F5/--enable-proposed-api).');
    return undefined;
  }

  try {
    let models = await (vscode as any).lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
    if (!models || models.length === 0) {
      models = await (vscode as any).lm.selectChatModels({ vendor: 'copilot' });
    }
    if (!models || models.length === 0) {
      modelCache = undefined;
      lastReason = 'copilot_model_unavailable';
      const info = server ? server.address() : undefined;
      const bound = info && typeof info === 'object' ? `${info.address}:${info.port}` : '';
      statusItem && (statusItem.text = `Copilot Bridge: Unavailable ${bound ? `@ ${bound}` : ''}`);
      if (verbose) output?.appendLine('No Copilot language models available.');
      return undefined;
    }
    modelCache = models[0];
    lastReason = undefined;
    const info = server ? server.address() : undefined;
    const bound = info && typeof info === 'object' ? `${info.address}:${info.port}` : '';
    statusItem && (statusItem.text = `Copilot Bridge: OK ${bound ? `@ ${bound}` : ''}`);
    if (verbose) output?.appendLine(`Copilot model selected.`);
    return modelCache;
  } catch (e: any) {
    modelCache = undefined;
    const info = server ? server.address() : undefined;
    const bound = info && typeof info === 'object' ? `${info.address}:${info.port}` : '';
    statusItem && (statusItem.text = `Copilot Bridge: Unavailable ${bound ? `@ ${bound}` : ''}`);
    if ((vscode as any).LanguageModelError && e instanceof (vscode as any).LanguageModelError) {
      const code = (e as any).code || '';
      if (/consent/i.test(e.message) || code === 'UserNotSignedIn') lastReason = 'consent_required';
      else if (code === 'RateLimited') lastReason = 'rate_limited';
      else if (code === 'NotFound') lastReason = 'not_found';
      else lastReason = 'copilot_unavailable';
      if (verbose) output?.appendLine(`LM select error: ${e.message} code=${code}`);
    } else {
      lastReason = 'copilot_unavailable';
      if (verbose) output?.appendLine(`LM select error: ${e?.message || String(e)}`);
    }
    return undefined;
  }
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c: Buffer) => { data += c.toString(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function writeJson(res: http.ServerResponse, status: number, obj: any) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
