import * as vscode from 'vscode';
import { AddressInfo } from 'net';
import { state } from './state';
import { LOOPBACK_HOST, getBridgeConfig } from './config';
import { info } from './log';

const formatEndpoint = (addr: AddressInfo | null, port: number): string => {
  if (addr) {
    const address = addr.address === '::' ? LOOPBACK_HOST : addr.address;
    return `${address}:${addr.port}`;
  }
  const normalizedPort = port === 0 ? 'auto' : port;
  return `${LOOPBACK_HOST}:${normalizedPort}`;
};

const buildTooltip = (status: string, endpoint: string, tokenConfigured: boolean, reason?: string): vscode.MarkdownString => {
  const tooltip = new vscode.MarkdownString();
  tooltip.supportThemeIcons = true;
  tooltip.isTrusted = true;
  tooltip.appendMarkdown(`**Copilot Bridge**\n\n`);
  tooltip.appendMarkdown(`Status: ${status}\n\n`);
  tooltip.appendMarkdown(`Endpoint: \`http://${endpoint}\`\n\n`);

  if (tokenConfigured) {
    tooltip.appendMarkdown('Auth token: ✅ configured. Requests must include `Authorization: Bearer <token>` (OpenAI) or `x-api-key: <token>` (Anthropic).');
  } else {
    tooltip.appendMarkdown('Auth token: ⚠️ not configured — all API requests return **401 Unauthorized** until you set `bridge.token`.');
    tooltip.appendMarkdown('\n\n[Configure token](command:workbench.action.openSettings?%22bridge.token%22)');
  }

  if (reason) {
    tooltip.appendMarkdown(`\n\nLast reason: \`${reason}\``);
  }

  return tooltip;
};

export const ensureStatusBar = (): void => {
  if (!state.statusBarItem) {
    state.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    state.statusBarItem.text = 'Copilot Bridge: Disabled';
    state.statusBarItem.command = 'bridge.status';
    state.statusBarItem.show();
    updateStatus('disabled');
  }
};

export type BridgeStatusKind = 'start' | 'error' | 'success' | 'disabled';

interface UpdateStatusOptions {
  readonly suppressLog?: boolean;
}

export const updateStatus = (kind: BridgeStatusKind, options: UpdateStatusOptions = {}): void => {
  const cfg = getBridgeConfig();
  const addr = state.server?.address() as AddressInfo | null;
  const shown = formatEndpoint(addr, cfg.port);
  const tokenConfigured = cfg.token.length > 0;

  if (!state.statusBarItem) return;

  let statusLabel: string;
  switch (kind) {
    case 'start': {
      const availability = state.modelCache ? 'OK' : (state.modelAttempted ? 'Unavailable' : 'Pending');
      state.statusBarItem.text = `Copilot Bridge: ${availability} @ ${shown}`;
      if (!options.suppressLog) {
        info(`Started at http://${shown} | Copilot: ${state.modelCache ? 'ok' : (state.modelAttempted ? 'unavailable' : 'pending')}`);
      }
      statusLabel = availability;
      break;
    }
    case 'error':
      state.statusBarItem.text = `Copilot Bridge: Unavailable @ ${shown}`;
      statusLabel = 'Unavailable';
      break;
    case 'success':
      state.statusBarItem.text = `Copilot Bridge: OK @ ${shown}`;
      statusLabel = 'OK';
      break;
    case 'disabled':
      state.statusBarItem.text = 'Copilot Bridge: Disabled';
      statusLabel = 'Disabled';
      break;
    default:
      // Exhaustive check in case of future extension
      const _never: never = kind;
      return _never;
  }

  state.statusBarItem.tooltip = buildTooltip(statusLabel, shown, tokenConfigured, state.lastReason);
};
