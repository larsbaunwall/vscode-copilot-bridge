import * as http from 'http';
import * as vscode from 'vscode';
import { normalizeMessages } from '../utils/messages';
import { logError, logInfo } from '../utils/log';

type GetAccess = () => any | undefined;

function writeSse(res: http.ServerResponse, data: any) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function unauthorized(res: http.ServerResponse) {
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'unauthorized', type: 'auth_error', code: 'unauthorized' } }));
}

function sendJson(res: http.ServerResponse, status: number, obj: any) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

export function createHttpFacade(getAccess: GetAccess, bindAddress: string, port: number, token?: string) {
  const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
      if (token && token.length > 0) {
        const h = req.headers['authorization'] || '';
        const got = Array.isArray(h) ? h[0] : h;
        if (!got || !got.startsWith('Bearer ') || got.slice(7) !== token) return unauthorized(res);
      }
      if (req.method === 'GET' && req.url === '/v1/models') {
        return sendJson(res, 200, { data: [{ id: 'gpt-4o-copilot', object: 'model', owned_by: 'vscode-bridge' }] });
      }
      if (req.method === 'GET' && req.url === '/healthz') {
        const ok = !!getAccess();
        return sendJson(res, 200, { ok: true, copilot: ok ? 'ok' : 'unavailable' });
      }
      if (req.method === 'POST' && req.url?.startsWith('/v1/chat/completions')) {
        const access = getAccess();
        if (!access) return sendJson(res, 503, { error: { message: 'Copilot unavailable', type: 'server_error', code: 'copilot_unavailable' } });
        const body = await new Promise<any>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on('data', (c: any) => chunks.push(c as Buffer));
          req.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
          });
          req.on('error', reject);
        });
        const messages = Array.isArray(body?.messages) ? body.messages : [];
        const maxTurns = vscode.workspace.getConfiguration().get<number>('bridge.history.maxTurns', 3);
        const prompt = normalizeMessages(messages, maxTurns);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        const session = await access.startSession();
        const stream = await session.sendRequest({ prompt, attachments: [] });
        const id = `cmp_${Math.random().toString(36).slice(2)}`;
        const d1 = stream.onDidProduceContent((c: string) => {
          const data = { id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: c } }] };
          writeSse(res, data);
        });
        const endAll = () => {
          res.write('data: [DONE]\n\n');
          res.end();
          d1.dispose();
          d2.dispose();
        };
        const d2 = stream.onDidEnd(() => endAll());
        req.on('close', () => endAll());
        return;
      }
      res.writeHead(404).end();
    } catch (e: any) {
      logError(String(e?.message || e));
      sendJson(res, 500, { error: { message: 'internal error', type: 'server_error', code: 'internal' } });
    }
  });
  server.listen(port, bindAddress, () => {
    logInfo(`HTTP OpenAI facade listening on http://${bindAddress}:${(server.address() as any).port}`);
  });
  const close = async () => new Promise<void>(r => server.close(() => r()));
  return { server, close };
}
