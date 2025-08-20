import * as vscode from 'vscode';
import { AddressInfo } from 'net';
import { state } from './state';
import { getBridgeConfig } from './config';
import { info } from './log';

export const ensureStatusBar = (): void => {
  if (!state.statusBarItem) {
    state.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    state.statusBarItem.text = 'Copilot Bridge: Disabled';
    state.statusBarItem.show();
  }
};

export type BridgeStatusKind = 'start' | 'error' | 'success';

export const updateStatus = (kind: BridgeStatusKind): void => {
  const cfg = getBridgeConfig();
  const addr = state.server?.address() as AddressInfo | null;
  const shown = addr ? `${addr.address}:${addr.port}` : `${cfg.host}:${cfg.port}`;

  if (!state.statusBarItem) return;

  switch (kind) {
    case 'start': {
  const availability = state.modelCache ? 'OK' : (state.modelAttempted ? 'Unavailable' : 'Pending');
  state.statusBarItem.text = `Copilot Bridge: ${availability} @ ${shown}`;
  info(`Started at http://${shown} | Copilot: ${state.modelCache ? 'ok' : (state.modelAttempted ? 'unavailable' : 'pending')}`);
      break;
    }
    case 'error':
      state.statusBarItem.text = `Copilot Bridge: Unavailable @ ${shown}`;
      break;
    case 'success':
      state.statusBarItem.text = `Copilot Bridge: OK @ ${shown}`;
      break;
    default:
      // Exhaustive check in case of future extension
      const _never: never = kind;
      return _never;
  }
};
