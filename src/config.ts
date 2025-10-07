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

// Cache config to avoid repeated VS Code configuration queries (PERFORMANCE FIX)
let cachedConfig: BridgeConfig | undefined;
let configListener: vscode.Disposable | undefined;

export const getBridgeConfig = (): BridgeConfig => {
  if (cachedConfig === undefined) {
    cachedConfig = readConfig();
    
    // Set up listener for config changes
    if (!configListener) {
      configListener = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('bridge')) {
          cachedConfig = undefined; // Invalidate cache
        }
      });
    }
  }
  return cachedConfig;
};

function readConfig(): BridgeConfig {
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
}

/**
 * Invalidates the config cache, forcing a reload on next access.
 * Useful for testing or when config is known to have changed.
 */
export const invalidateConfigCache = (): void => {
  cachedConfig = undefined;
};
