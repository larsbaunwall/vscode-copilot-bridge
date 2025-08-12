import * as vscode from 'vscode';

export interface BridgeConfig {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly token: string;
  readonly historyWindow: number;
  readonly verbose: boolean;
  readonly maxConcurrent: number;
}

export const getBridgeConfig = (): BridgeConfig => {
  const cfg = vscode.workspace.getConfiguration('bridge');
  return {
    enabled: cfg.get<boolean>('enabled') ?? false,
    host: cfg.get<string>('host') ?? '127.0.0.1',
    port: cfg.get<number>('port') ?? 0,
    token: (cfg.get<string>('token') ?? '').trim(),
    historyWindow: cfg.get<number>('historyWindow') ?? 3,
    verbose: cfg.get<boolean>('verbose') ?? false,
    maxConcurrent: cfg.get<number>('maxConcurrent') ?? 1,
  };
};
