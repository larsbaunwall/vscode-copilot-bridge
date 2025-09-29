import type * as vscode from 'vscode';
import type { Tool } from '../messages';

/**
 * OpenAI API compatible types for request and response handling
 */

export interface OpenAIToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

export interface OpenAIMessage {
  readonly role: 'assistant';
  readonly content: string | null;
  readonly tool_calls?: OpenAIToolCall[];
  readonly function_call?: {
    readonly name: string;
    readonly arguments: string;
  };
}

export interface OpenAIChoice {
  readonly index: number;
  readonly message?: OpenAIMessage;
  readonly delta?: Partial<OpenAIMessage>;
  readonly finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;
}

export interface OpenAIResponse {
  readonly id: string;
  readonly object: 'chat.completion' | 'chat.completion.chunk';
  readonly created: number;
  readonly model: string;
  readonly choices: OpenAIChoice[];
  readonly usage?: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
    readonly total_tokens: number;
  };
}

export interface ChatCompletionContext {
  readonly requestId: string;
  readonly modelName: string;
  readonly created: number;
  readonly hasTools: boolean;
  readonly isStreaming: boolean;
}

export interface ProcessedResponseData {
  readonly content: string;
  readonly toolCalls: OpenAIToolCall[];
  readonly finishReason: OpenAIChoice['finish_reason'];
}

/**
 * Validates that the request model is available and properly configured
 */
export interface ModelValidationResult {
  readonly isValid: boolean;
  readonly statusCode?: number;
  readonly errorType?: string;
  readonly errorCode?: string;
  readonly reason?: string;
}

/**
 * Consolidated request processing context for chat completions
 */
export interface RequestProcessingContext {
  readonly model: vscode.LanguageModelChat;
  readonly lmMessages: vscode.LanguageModelChatMessage[];
  readonly lmTools: vscode.LanguageModelChatTool[];
  readonly requestOptions: vscode.LanguageModelChatRequestOptions;
  readonly mergedTools: Tool[];
}