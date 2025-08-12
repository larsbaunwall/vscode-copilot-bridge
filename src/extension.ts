import * as vscode from 'vscode';
import { getBridgeConfig } from './config';
import { state } from './state';
import { ensureOutput, verbose } from './log';
import { ensureStatusBar } from './status';
import { startServer, stopServer } from './http/server';
import { getModel } from './models';

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  ensureOutput();
  ensureStatusBar();
  state.statusItem!.text = 'Copilot Bridge: Disabled';
  state.statusItem!.show();
  ctx.subscriptions.push(state.statusItem!, state.output!);

  ctx.subscriptions.push(vscode.commands.registerCommand('bridge.enable', async () => {
    await startBridge();
    await getModel(true);
  }));
  
  ctx.subscriptions.push(vscode.commands.registerCommand('bridge.disable', async () => {
    await stopBridge();
  }));
  
  ctx.subscriptions.push(vscode.commands.registerCommand('bridge.status', async () => {
    const info = state.server?.address();
    const bound = info && typeof info === 'object' ? `${(info as any).address}:${(info as any).port}` : 'n/a';
    const config = getBridgeConfig();
    const hasToken = config.token.length > 0;
    vscode.window.showInformationMessage(
      `Copilot Bridge: ${state.running ? 'Enabled' : 'Disabled'} | Bound: ${bound} | Token: ${hasToken ? 'Set' : 'None'}`
    );
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
  } catch (error: any) {
    state.running = false;
    state.statusItem!.text = 'Copilot Bridge: Error';
    verbose(error?.stack || String(error));
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
    if (state.statusItem) {
      state.statusItem.text = 'Copilot Bridge: Disabled';
    }
    verbose('Stopped');
  }
}
