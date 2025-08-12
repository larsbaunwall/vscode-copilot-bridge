import * as vscode from 'vscode';
import * as http from 'http';
import { AddressInfo } from 'net';

let server: http.Server | undefined;
let access: vscode.ChatAccess | undefined;
let statusItem: vscode.StatusBarItem | undefined;
let output: vscode.OutputChannel | undefined;
let running = false;

export async function activate(ctx: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel('Copilot Bridge');
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.text = 'Copilot Bridge: Disabled';
  statusItem.show();
  ctx.subscriptions.push(statusItem, output);

  ctx.subscriptions.push(vscode.commands.registerCommand('bridge.enable', async () => {
    await startBridge();
  }));
  ctx.subscriptions.push(vscode.commands.registerCommand('bridge.disable', async () => {
    await stopBridge();
  }));
  ctx.subscriptions.push(vscode.commands.registerCommand('bridge.status', async () => {
    const info = server ? server.address() : undefined;
    const bound = info && typeof info === 'object' ? `${info.address}:${info.port}` : 'n/a';
    const needsToken = !!(vscode.workspace.getConfiguration('bridge').get<string>('token') || '').trim();
    vscode.window.showInformationMessage(`Copilot Bridge: ${running ? 'Enabled' : 'Disabled'} | Bound: ${bound} | Token: ${needsToken ? 'Required' : 'None'}`);
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

  try {
    try {
      access = await vscode.chat.requestChatAccess('copilot');
    } catch {
      access = undefined;
    }

    server = http.createServer(async (req, res) => {
      try {
        if (token && req.headers.authorization !== `Bearer ${token}`) {
          writeJson(res, 401, { error: { message: 'unauthorized', type: 'invalid_request_error', code: 'unauthorized' } });
          return;
        }

        if (req.method === 'GET' && req.url === '/healthz') {
          writeJson(res, 200, { ok: true, copilot: access ? 'ok' : 'unavailable', version: vscode.version });
          return;
        }

        if (req.method === 'GET' && req.url === '/v1/models') {
          writeJson(res, 200, { data: [{ id: 'gpt-4o-copilot', object: 'model', owned_by: 'vscode-bridge' }] });
          return;
        }

        if (req.method === 'POST' && req.url?.startsWith('/v1/chat/completions')) {
          if (!access) {
            writeJson(res, 503, { error: { message: 'Copilot unavailable', type: 'server_error', code: 'copilot_unavailable' } });
            return;
          }

          const body = await readJson(req);
          const messages = Array.isArray(body?.messages) ? body.messages : [];
          const prompt = normalizeMessages(messages, hist);
          const streamMode = body?.stream !== false;

          const session = await access.startSession();
          const chatStream = await session.sendRequest({ prompt, attachments: [] });

          if (streamMode) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive'
            });
            const id = `cmp_${Math.random().toString(36).slice(2)}`;
            const h1 = chatStream.onDidProduceContent((chunk) => {
              const payload = {
                id,
                object: 'chat.completion.chunk',
                choices: [{ index: 0, delta: { content: chunk } }]
              };
              res.write(`data: ${JSON.stringify(payload)}\n\n`);
            });
            const endAll = () => {
              res.write('data: [DONE]\n\n');
              res.end();
              h1.dispose();
              h2.dispose();
            };
            const h2 = chatStream.onDidEnd(endAll);
            req.on('close', endAll);
            return;
          } else {
            let buf = '';
            const h1 = chatStream.onDidProduceContent((chunk) => { buf += chunk; });
            await new Promise<void>((resolve) => {
              const h2 = chatStream.onDidEnd(() => {
                h1.dispose();
                h2.dispose();
                resolve();
              });
            });
            writeJson(res, 200, {
              id: `cmpl_${Math.random().toString(36).slice(2)}`,
              object: 'chat.completion',
              choices: [{ index: 0, message: { role: 'assistant', content: buf }, finish_reason: 'stop' }]
            });
            return;
          }
        }

        res.writeHead(404).end();
      } catch (e: any) {
        output?.appendLine(`Error: ${e?.stack || e?.message || String(e)}`);
        writeJson(res, 500, { error: { message: e?.message ?? 'internal_error', type: 'server_error', code: 'internal_error' } });
      }
    });

    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(portCfg, host, () => resolve());
    });

    const addr = server.address() as AddressInfo | null;
    const shown = addr ? `${addr.address}:${addr.port}` : `${host}:${portCfg}`;
    statusItem!.text = `Copilot Bridge: ${access ? 'OK' : 'Unavailable'} @ ${shown}`;
    output?.appendLine(`Started at http://${shown} | Copilot: ${access ? 'ok' : 'unavailable'}`);
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
    access = undefined;
    statusItem && (statusItem.text = 'Copilot Bridge: Disabled');
    output?.appendLine('Stopped');
  }
}

function normalizeMessages(messages: any[], histWindow: number): string {
  const toText = (content: any): string => {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map(toText).join('\n');
    if (content && typeof content === 'object' && typeof content.text === 'string') return content.text;
    try { return JSON.stringify(content); } catch { return String(content); }
  };
  const sys = messages.filter((m) => m && m.role === 'system').pop();
  const turns = messages.filter((m) => m && (m.role === 'user' || m.role === 'assistant')).slice(-histWindow * 2);
  const dialog = turns.map((m) => `${m.role}: ${toText(m.content)}`).join('\n');
  const sysPart = sys ? `[SYSTEM]\n${toText(sys.content)}\n\n` : '';
  return `${sysPart}[DIALOG]\n${dialog}`;
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; });
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
