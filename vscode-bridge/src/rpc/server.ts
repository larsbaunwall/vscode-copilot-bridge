import WebSocket, { WebSocketServer } from 'ws';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { applyUnifiedDiff } from '../utils/diff';
import { isWriteAllowed } from '../utils/policy';
import { logError, logInfo } from '../utils/log';

type JsonRpcReq = { jsonrpc: string; id: string | number | null; method: string; params?: any };

function sha256(input: Buffer | string) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

async function fsRead(params: any) {
  const p = String(params?.path || '');
  const buf = await fs.promises.readFile(p);
  return { content: buf.toString('utf8'), sha256: sha256(buf) };
}

async function fsList(params: any) {
  const glob = String(params?.glob || '**/*');
  const limit = Number.isFinite(params?.limit) ? params.limit : 1000;
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return { files: [] };
  const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, glob), undefined, limit);
  return { files: uris.map(u => u.fsPath) };
}

async function searchCode(params: any) {
  const query = String(params?.query || '');
  const glob = String(params?.glob || '**/*');
  const maxResults = Number.isFinite(params?.maxResults) ? params.maxResults : 200;
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return { hits: [] };
  const hits: any[] = [];
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
    } catch {
      continue;
    }
  }
  return { hits };
}

async function symbolsList(params: any) {
  const p = String(params?.path || '');
  const uri = vscode.Uri.file(p);
  const symbols: any = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri);
  const flat: any[] = [];
  const walk = (arr: any[]) => {
    for (const s of arr || []) {
      flat.push({ name: s.name, kind: s.kind, range: s.range });
      if (Array.isArray(s.children)) walk(s.children);
    }
  };
  walk(symbols || []);
  return { symbols: flat };
}

async function editApplyPatch(params: any, readOnly: boolean) {
  const diff = String(params?.unifiedDiff || '');
  if (!diff) return { ok: false, conflicts: ['emptyDiff'] };
  const lines = diff.split('\n');
  const fileHeaders = lines.find(l => l.startsWith('+++ ')) || '';
  const pathPart = fileHeaders.replace('+++ ', '').replace(/^b\//, '');
  const targetPath = pathPart;
  const allow = isWriteAllowed(targetPath, readOnly);
  if (!allow.allowed) return { ok: false, conflicts: [allow.reason || 'policyDenied'] };
  const res = await applyUnifiedDiff(diff);
  return res;
}

async function formatApply(params: any) {
  const p = String(params?.path || '');
  const uri = vscode.Uri.file(p);
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.commands.executeCommand('editor.action.formatDocument', uri);
    await doc.save();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'formatFailed' };
  }
}

async function importsOrganize(params: any) {
  const p = String(params?.path || '');
  const uri = vscode.Uri.file(p);
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.commands.executeCommand('editor.action.organizeImports', uri);
    await doc.save();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'organizeFailed' };
  }
}

export function createRpcServer(bindAddress: string, port: number, token?: string, readOnly?: boolean) {
  const wss = new WebSocketServer({ host: bindAddress, port });
  function send(ws: WebSocket, id: any, result?: any, error?: { code: number; message: string }) {
    if (error) ws.send(JSON.stringify({ jsonrpc: '2.0', id, error }));
    else ws.send(JSON.stringify({ jsonrpc: '2.0', id, result }));
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
      let reqMsg: JsonRpcReq | undefined;
      try {
        reqMsg = JSON.parse(raw.toString());
        if (!reqMsg || reqMsg.jsonrpc !== '2.0' || !reqMsg.method) throw new Error('Invalid request');
      } catch (e: any) {
        send(ws, null, undefined, { code: -32600, message: 'Invalid Request' });
        return;
      }
      try {
        const m = reqMsg.method;
        const p = reqMsg.params;
        if (m === 'mcp.fs.read') return send(ws, reqMsg.id, await fsRead(p));
        if (m === 'mcp.fs.list') return send(ws, reqMsg.id, await fsList(p));
        if (m === 'mcp.search.code') return send(ws, reqMsg.id, await searchCode(p));
        if (m === 'mcp.symbols.list') return send(ws, reqMsg.id, await symbolsList(p));
        if (m === 'mcp.edit.applyPatch') return send(ws, reqMsg.id, await editApplyPatch(p, !!readOnly));
        if (m === 'mcp.format.apply') return send(ws, reqMsg.id, await formatApply(p));
        if (m === 'mcp.imports.organize') return send(ws, reqMsg.id, await importsOrganize(p));
        return send(ws, reqMsg.id, undefined, { code: -32601, message: 'Method not found' });
      } catch (e: any) {
        logError(String(e?.message || e));
        return send(ws, reqMsg.id, undefined, { code: -32603, message: 'Internal error' });
      }
    });
  });
  wss.on('listening', () => {
    const addr = wss.address() as any;
    logInfo(`JSON-RPC listening on ws://${bindAddress}:${addr.port}`);
  });
  const close = async () => new Promise<void>(r => wss.close(() => r()));
  return { wss, close };
}
