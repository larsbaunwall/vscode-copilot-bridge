import * as vscode from 'vscode';
import { state } from './state';
import { getBridgeConfig } from './config';

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
  const cfg = getBridgeConfig();
  if (!cfg.verbose) return;
  ensureOutput();
  state.output?.appendLine(msg);
};

export const error = (msg: string): void => {
  ensureOutput();
  state.output?.appendLine(msg);
};
