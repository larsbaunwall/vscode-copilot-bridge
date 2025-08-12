import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function getLogger() {
  if (!channel) channel = vscode.window.createOutputChannel('Copilot Bridge');
  return channel;
}

export function logInfo(msg: string) {
  getLogger().appendLine(`[info] ${msg}`);
}

export function logError(msg: string) {
  getLogger().appendLine(`[error] ${msg}`);
}
