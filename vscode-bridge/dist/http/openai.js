"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHttpFacade = createHttpFacade;
const http = __importStar(require("http"));
const vscode = __importStar(require("vscode"));
const messages_1 = require("../utils/messages");
const log_1 = require("../utils/log");
function writeSse(res, data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}
function unauthorized(res) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'unauthorized', type: 'auth_error', code: 'unauthorized' } }));
}
function sendJson(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
}
function createHttpFacade(getAccess, bindAddress, port, token) {
    const server = http.createServer(async (req, res) => {
        try {
            if (token && token.length > 0) {
                const h = req.headers['authorization'] || '';
                const got = Array.isArray(h) ? h[0] : h;
                if (!got || !got.startsWith('Bearer ') || got.slice(7) !== token)
                    return unauthorized(res);
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
                if (!access)
                    return sendJson(res, 503, { error: { message: 'Copilot unavailable', type: 'server_error', code: 'copilot_unavailable' } });
                const body = await new Promise((resolve, reject) => {
                    const chunks = [];
                    req.on('data', (c) => chunks.push(c));
                    req.on('end', () => {
                        try {
                            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                        }
                        catch (e) {
                            reject(e);
                        }
                    });
                    req.on('error', reject);
                });
                const messages = Array.isArray(body?.messages) ? body.messages : [];
                const maxTurns = vscode.workspace.getConfiguration().get('bridge.history.maxTurns', 3);
                const prompt = (0, messages_1.normalizeMessages)(messages, maxTurns);
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive'
                });
                const session = await access.startSession();
                const stream = await session.sendRequest({ prompt, attachments: [] });
                const id = `cmp_${Math.random().toString(36).slice(2)}`;
                const d1 = stream.onDidProduceContent((c) => {
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
        }
        catch (e) {
            (0, log_1.logError)(String(e?.message || e));
            sendJson(res, 500, { error: { message: 'internal error', type: 'server_error', code: 'internal' } });
        }
    });
    server.listen(port, bindAddress, () => {
        (0, log_1.logInfo)(`HTTP OpenAI facade listening on http://${bindAddress}:${server.address().port}`);
    });
    const close = async () => new Promise(r => server.close(() => r()));
    return { server, close };
}
