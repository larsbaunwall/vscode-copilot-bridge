import * as vscode from 'vscode';
import { createHttpFacade } from './http/openai';
import { createRpcServer } from './rpc/server';
import { getOrPickPort } from './utils/ports';
import { getLogger, logError, logInfo } from './utils/log';

let httpClose: (() => Promise<void>) | undefined;
let rpcClose: (() => Promise<void>) | undefined;
let chatAccess: any | undefined;
let statusItem: vscode.StatusBarItem | undefined;

async function ensureCopilotAccess() {
  try {
    chatAccess = await (vscode as any).chat.requestChatAccess('copilot');
    return true;
  } catch {
    chatAccess = undefined;
    return false;
  }
}

function getAccess() {
  return chatAccess;
}

async function startServers(ctx: vscode.ExtensionContext) {
  const cfg = vscode.workspace.getConfiguration();
  const bindAddress = cfg.get<string>('bridge.bindAddress', '127.0.0.1');
  const openaiPref = cfg.get<number>('bridge.openai.port', 0);
  const rpcPref = cfg.get<number>('bridge.rpc.port', 0);
  const token = cfg.get<string>('bridge.token', '');
  const readOnly = cfg.get<boolean>('bridge.readOnly', true);
  const httpPort = await getOrPickPort(ctx, 'bridge.openai.port', openaiPref);
  const rpcPort = await getOrPickPort(ctx, 'bridge.rpc.port', rpcPref);

  const ok = await ensureCopilotAccess();

  const http = createHttpFacade(getAccess, bindAddress, httpPort, token || undefined);
  httpClose = http.close;

  const rpc = createRpcServer(bindAddress, rpcPort, token || undefined, readOnly);
  rpcClose = rpc.close;

  if (!statusItem) statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.text = `Bridge: ON · Chat: ${ok ? 'OK' : 'Unavailable'}`;
  statusItem.show();

  logInfo(`Started. HTTP ${bindAddress}:${httpPort}, RPC ${bindAddress}:${rpcPort}`);
}

async function stopServers() {
  const tasks: Promise<void>[] = [];
  if (httpClose) tasks.push(httpClose());
  if (rpcClose) tasks.push(rpcClose());
  await Promise.all(tasks);
  httpClose = undefined;
  rpcClose = undefined;
  if (statusItem) {
    statusItem.text = 'Bridge: OFF';
    statusItem.show();
  }
}

export async function activate(ctx: vscode.ExtensionContext) {
  getLogger();
  const enable = vscode.workspace.getConfiguration().get<boolean>('bridge.enabled', false);
  if (enable) await startServers(ctx);

  ctx.subscriptions.push(
    vscode.commands.registerCommand('bridge.enable', async () => {
      await startServers(ctx);
      vscode.window.showInformationMessage('Copilot Bridge enabled');
    }),
    vscode.commands.registerCommand('bridge.disable', async () => {
      await stopServers();
      vscode.window.showInformationMessage('Copilot Bridge disabled');
    }),
    vscode.commands.registerCommand('bridge.status', async () => {
      const cfg = vscode.workspace.getConfiguration();
      const bindAddress = cfg.get<string>('bridge.bindAddress', '127.0.0.1');
      const httpPort = ctx.globalState.get<number>('bridge.openai.port');
      const rpcPort = ctx.globalState.get<number>('bridge.rpc.port');
      const ok = !!chatAccess;
      const ro = cfg.get<boolean>('bridge.readOnly', true);
      const msg = `Chat: ${ok ? 'OK' : 'Unavailable'} · HTTP: ${bindAddress}:${httpPort} · RPC: ${bindAddress}:${rpcPort} · readOnly: ${ro}`;
      vscode.window.showInformationMessage(msg);
    }),
    { dispose: async () => { await stopServers(); } }
  );
}

export async function deactivate() {
  await stopServers();
}
