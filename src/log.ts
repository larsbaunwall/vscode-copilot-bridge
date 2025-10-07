import * as vscode from 'vscode';
import { state } from './state';
import { getBridgeConfig } from './config';

// Cache verbose flag to avoid repeated config queries (PERFORMANCE FIX)
let cachedVerbose: boolean | undefined;
let configListener: vscode.Disposable | undefined;

const getVerboseFlag = (): boolean => {
  if (cachedVerbose === undefined) {
    // Initialize cache and set up listener for config changes
    const cfg = getBridgeConfig();
    cachedVerbose = cfg.verbose;
    
    if (!configListener) {
      configListener = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('bridge.verbose')) {
          cachedVerbose = undefined; // Invalidate cache
        }
      });
    }
  }
  return cachedVerbose;
};

export const ensureOutput = (): void => {
  if (!state.output) {
    state.output = vscode.window.createOutputChannel('Copilot Bridge');
  }
};

export const info = (msg: string): void => {
  ensureOutput();
  state.output?.appendLine(msg);
};

export const verbose = (msg: string): void => {
  if (!getVerboseFlag()) return;
  ensureOutput();
  state.output?.appendLine(msg);
};

export const error = (msg: string): void => {
  ensureOutput();
  state.output?.appendLine(msg);
};
