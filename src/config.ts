import * as vscode from 'vscode';

export const LOOPBACK_HOST = '127.0.0.1' as const;

export interface BridgeConfig {
  readonly enabled: boolean;
  readonly host: typeof LOOPBACK_HOST;
  readonly port: number;
  readonly token: string;
  readonly historyWindow: number;
  readonly verbose: boolean;
  readonly maxConcurrent: number;
}

export const getBridgeConfig = (): BridgeConfig => {
  const cfg = vscode.workspace.getConfiguration('bridge');
  const resolved = {
    enabled: cfg.get('enabled', false),
    host: LOOPBACK_HOST,
    port: cfg.get('port', 0),
    token: cfg.get('token', '').trim(),
    historyWindow: cfg.get('historyWindow', 3),
    verbose: cfg.get('verbose', false),
    maxConcurrent: cfg.get('maxConcurrent', 1),
  } satisfies BridgeConfig;
  return resolved;
};
