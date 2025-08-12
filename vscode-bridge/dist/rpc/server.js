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
exports.createRpcServer = createRpcServer;
const ws_1 = require("ws");
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const crypto = __importStar(require("crypto"));
const diff_1 = require("../utils/diff");
const policy_1 = require("../utils/policy");
const log_1 = require("../utils/log");
function sha256(input) {
    return crypto.createHash('sha256').update(input).digest('hex');
}
async function fsRead(params) {
    const p = String(params?.path || '');
    const buf = await fs.promises.readFile(p);
    return { content: buf.toString('utf8'), sha256: sha256(buf) };
}
async function fsList(params) {
    const glob = String(params?.glob || '**/*');
    const limit = Number.isFinite(params?.limit) ? params.limit : 1000;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder)
        return { files: [] };
    const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, glob), undefined, limit);
    return { files: uris.map(u => u.fsPath) };
}
async function searchCode(params) {
    const query = String(params?.query || '');
    const glob = String(params?.glob || '**/*');
    const maxResults = Number.isFinite(params?.maxResults) ? params.maxResults : 200;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder)
        return { hits: [] };
    const hits = [];
    const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, glob), undefined, maxResults);
    for (const uri of uris) {
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const text = doc.getText();
            const lines = text.split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(query)) {
                    hits.push({ file: uri.fsPath, line: i });
                }
            }
        }
        catch {
            continue;
        }
    }
    return { hits };
}
async function symbolsList(params) {
    const p = String(params?.path || '');
    const uri = vscode.Uri.file(p);
    const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri);
    const flat = [];
    const walk = (arr) => {
        for (const s of arr || []) {
            flat.push({ name: s.name, kind: s.kind, range: s.range });
            if (Array.isArray(s.children))
                walk(s.children);
        }
    };
    walk(symbols || []);
    return { symbols: flat };
}
async function editApplyPatch(params, readOnly) {
    const diff = String(params?.unifiedDiff || '');
    if (!diff)
        return { ok: false, conflicts: ['emptyDiff'] };
    const lines = diff.split('\n');
    const fileHeaders = lines.find(l => l.startsWith('+++ ')) || '';
    const pathPart = fileHeaders.replace('+++ ', '').replace(/^b\//, '');
    const targetPath = pathPart;
    const allow = (0, policy_1.isWriteAllowed)(targetPath, readOnly);
    if (!allow.allowed)
        return { ok: false, conflicts: [allow.reason || 'policyDenied'] };
    const res = await (0, diff_1.applyUnifiedDiff)(diff);
    return res;
}
async function formatApply(params) {
    const p = String(params?.path || '');
    const uri = vscode.Uri.file(p);
    try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.commands.executeCommand('editor.action.formatDocument', uri);
        await doc.save();
        return { ok: true };
    }
    catch (e) {
        return { ok: false, error: e?.message || 'formatFailed' };
    }
}
async function importsOrganize(params) {
    const p = String(params?.path || '');
    const uri = vscode.Uri.file(p);
    try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.commands.executeCommand('editor.action.organizeImports', uri);
        await doc.save();
        return { ok: true };
    }
    catch (e) {
        return { ok: false, error: e?.message || 'organizeFailed' };
    }
}
function createRpcServer(bindAddress, port, token, readOnly) {
    const wss = new ws_1.WebSocketServer({ host: bindAddress, port });
    function send(ws, id, result, error) {
        if (error)
            ws.send(JSON.stringify({ jsonrpc: '2.0', id, error }));
        else
            ws.send(JSON.stringify({ jsonrpc: '2.0', id, result }));
    }
    wss.on('connection', (ws, req) => {
        if (token && token.length > 0) {
            const auth = req.headers['authorization'];
            const got = Array.isArray(auth) ? auth[0] : auth;
            const url = new URL(req.url || '/', 'ws://localhost');
            const tParam = url.searchParams.get('token');
            const ok = (got && got.startsWith('Bearer ') && got.slice(7) === token) || (tParam && tParam === token);
            if (!ok) {
                ws.close(1008, 'unauthorized');
                return;
            }
        }
        ws.on('message', async (raw) => {
            let reqMsg;
            try {
                reqMsg = JSON.parse(raw.toString());
                if (!reqMsg || reqMsg.jsonrpc !== '2.0' || !reqMsg.method)
                    throw new Error('Invalid request');
            }
            catch (e) {
                send(ws, null, undefined, { code: -32600, message: 'Invalid Request' });
                return;
            }
            try {
                const m = reqMsg.method;
                const p = reqMsg.params;
                if (m === 'mcp.fs.read')
                    return send(ws, reqMsg.id, await fsRead(p));
                if (m === 'mcp.fs.list')
                    return send(ws, reqMsg.id, await fsList(p));
                if (m === 'mcp.search.code')
                    return send(ws, reqMsg.id, await searchCode(p));
                if (m === 'mcp.symbols.list')
                    return send(ws, reqMsg.id, await symbolsList(p));
                if (m === 'mcp.edit.applyPatch')
                    return send(ws, reqMsg.id, await editApplyPatch(p, !!readOnly));
                if (m === 'mcp.format.apply')
                    return send(ws, reqMsg.id, await formatApply(p));
                if (m === 'mcp.imports.organize')
                    return send(ws, reqMsg.id, await importsOrganize(p));
                return send(ws, reqMsg.id, undefined, { code: -32601, message: 'Method not found' });
            }
            catch (e) {
                (0, log_1.logError)(String(e?.message || e));
                return send(ws, reqMsg.id, undefined, { code: -32603, message: 'Internal error' });
            }
        });
    });
    wss.on('listening', () => {
        const addr = wss.address();
        (0, log_1.logInfo)(`JSON-RPC listening on ws://${bindAddress}:${addr.port}`);
    });
    const close = async () => new Promise(r => wss.close(() => r()));
    return { wss, close };
}
