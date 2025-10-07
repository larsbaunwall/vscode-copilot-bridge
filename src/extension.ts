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
  verbose('Extension deactivating...');
  await stopBridge();
  // Give time for cleanup before VS Code fully shuts down
  await new Promise(resolve => setTimeout(resolve, 200));
  verbose('Extension deactivated');
}

async function startBridge(): Promise<void> {
  if (state.running) {
    verbose('Bridge already running, skipping start');
    return;
  }
  state.running = true;
  try {
    await startServer();
  } catch (error) {
    state.running = false;
    state.lastReason = 'startup_failed';
    updateStatus('error', { suppressLog: true });
    
    const errorMsg = error instanceof Error ? error.message : String(error);
    verbose(`Failed to start bridge: ${errorMsg}`);
    
    // Show user-friendly error for common cases
    if (errorMsg.includes('already in use')) {
      vscode.window.showErrorMessage(
        'Copilot Bridge: Port already in use. Try "Copilot Bridge: Disable" first, or check for other processes using the port.',
        'Show Output'
      ).then(action => {
        if (action === 'Show Output') {
          state.output?.show();
        }
      });
    }
    
    if (error instanceof Error) {
      verbose(error.stack || error.message);
    } else {
      verbose(String(error));
    }
    throw error;
  }
}

async function stopBridge(): Promise<void> {
  // Always try to stop the server if it exists, regardless of running state
  const wasRunning = state.running;
  state.running = false;
  
  try {
    if (state.server) {
      verbose('Stopping bridge server...');
      await stopServer();
      verbose('Bridge stopped successfully');
    } else if (wasRunning) {
      verbose('Bridge marked as running but no server found');
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    verbose(`Error stopping bridge: ${errorMsg}`);
    vscode.window.showErrorMessage(`Failed to stop bridge: ${errorMsg}`);
  } finally {
    // Ensure state is fully cleared
    state.server = undefined;
    state.modelCache = undefined;
    updateStatus('disabled');
  }
}
