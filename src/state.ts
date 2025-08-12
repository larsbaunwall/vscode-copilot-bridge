import * as vscode from 'vscode';
import type { Server } from 'http';

export interface LanguageModel {
  readonly family?: string;
  readonly modelFamily?: string;
  readonly name?: string;
  readonly sendRequest: (messages: unknown[], options: unknown, token: vscode.CancellationToken) => Promise<LanguageModelResponse>;
}

export interface LanguageModelResponse {
  readonly text: AsyncIterable<string>;
}

export interface BridgeState {
  server?: Server;
  modelCache?: LanguageModel;
  statusItem?: vscode.StatusBarItem;
  output?: vscode.OutputChannel;
  running: boolean;
  activeRequests: number;
  lastReason?: string;
}

export const state: BridgeState = {
  running: false,
  activeRequests: 0,
};
