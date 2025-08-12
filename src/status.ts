import * as vscode from 'vscode';
import { AddressInfo } from 'net';
import { state } from './state';
import { getBridgeConfig } from './config';
import { info } from './log';

export const ensureStatusBar = (): void => {
  if (!state.statusItem) {
    state.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    state.statusItem.text = 'Copilot Bridge: Disabled';
    state.statusItem.show();
  }
};

export const updateStatusAfterStart = (): void => {
  const cfg = getBridgeConfig();
  const addr = state.server?.address() as AddressInfo | null;
  const shown = addr ? `${addr.address}:${addr.port}` : `${cfg.host}:${cfg.port}`;
  if (state.statusItem) {
    state.statusItem.text = `Copilot Bridge: ${state.modelCache ? 'OK' : 'Unavailable'} @ ${shown}`;
  }
  info(`Started at http://${shown} | Copilot: ${state.modelCache ? 'ok' : 'unavailable'}`);
};

export const updateStatusWithError = (): void => {
  const cfg = getBridgeConfig();
  const addr = state.server?.address() as AddressInfo | null;
  const shown = addr ? `${addr.address}:${addr.port}` : `${cfg.host}:${cfg.port}`;
  if (state.statusItem) {
    state.statusItem.text = `Copilot Bridge: Unavailable @ ${shown}`;
  }
};

export const updateStatusWithSuccess = (): void => {
  const cfg = getBridgeConfig();
  const addr = state.server?.address() as AddressInfo | null;
  const shown = addr ? `${addr.address}:${addr.port}` : `${cfg.host}:${cfg.port}`;
  if (state.statusItem) {
    state.statusItem.text = `Copilot Bridge: OK @ ${shown}`;
  }
};
