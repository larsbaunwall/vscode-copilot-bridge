import * as vscode from 'vscode';
import type { Server } from 'http';

export interface BridgeState {
  server?: Server;
  modelCache?: vscode.LanguageModelChat; // official API type
  statusBarItem?: vscode.StatusBarItem;
  output?: vscode.OutputChannel;
  running: boolean;
  activeRequests: number;
  lastReason?: string;
  modelAttempted?: boolean; // whether we've attempted to resolve a model yet
}

export const state: BridgeState = {
  running: false,
  activeRequests: 0,
  modelAttempted: false,
};
