import * as vscode from 'vscode';
import type { AddressInfo } from 'net';
import { getBridgeConfig } from './config';
import { state } from './state';
import { ensureOutput, verbose } from './log';
import { ensureStatusBar, updateStatus } from './status';
import { startServer, stopServer } from './http/server';
import { getModel } from './models';

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  ensureOutput();
  ensureStatusBar();
  state.statusBarItem!.text = 'Copilot Bridge: Disabled';
  state.statusBarItem!.show();
  ctx.subscriptions.push(state.statusBarItem!, state.output!);

  ctx.subscriptions.push(vscode.commands.registerCommand('bridge.enable', async () => {
    await startBridge();
    await getModel(true);
  }));
  
  ctx.subscriptions.push(vscode.commands.registerCommand('bridge.disable', async () => {
    await stopBridge();
  }));
  
  ctx.subscriptions.push(vscode.commands.registerCommand('bridge.status', async () => {
    const info = state.server?.address();
    const bound = (info && typeof info === 'object' && 'address' in info && 'port' in info)
      ? `${(info as AddressInfo).address}:${(info as AddressInfo).port}`
      : 'n/a';
    const config = getBridgeConfig();
    const hasToken = config.token.length > 0;
    vscode.window.showInformationMessage(
      `Copilot Bridge: ${state.running ? 'Enabled' : 'Disabled'} | Bound: ${bound} | Token: ${hasToken ? 'Set (required)' : 'Missing (requests will 401)'}`
    );
  }));

  ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration('bridge.token')) {
      return;
    }
    if (!state.statusBarItem) {
      return;
    }
    const kind: 'start' | 'error' | 'success' | 'disabled' = !state.running
      ? 'disabled'
      : state.modelCache
        ? 'success'
        : state.modelAttempted
          ? 'error'
          : 'start';
    updateStatus(kind, { suppressLog: true });
  }));

  const config = getBridgeConfig();
  if (config.enabled) {
    await startBridge();
  }
}

export async function deactivate(): Promise<void> {
  await stopBridge();
}

async function startBridge(): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    await startServer();
  } catch (error) {
    state.running = false;
    state.lastReason = 'startup_failed';
    updateStatus('error', { suppressLog: true });
    if (error instanceof Error) {
      verbose(error.stack || error.message);
    } else {
      verbose(String(error));
    }
    throw error;
  }
}

async function stopBridge(): Promise<void> {
  if (!state.running) return;
  state.running = false;
  try {
    await stopServer();
  } finally {
    state.server = undefined;
    state.modelCache = undefined;
    updateStatus('disabled');
    verbose('Stopped');
  }
}
