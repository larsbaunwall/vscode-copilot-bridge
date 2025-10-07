/**
 * Anthropic Messages API compatible types
 * https://docs.anthropic.com/en/api/messages
 */

// ===== Content Blocks =====

export interface TextBlock {
  readonly type: 'text';
  readonly text: string;
}

export interface ThinkingBlock {
  readonly type: 'thinking';
  readonly thinking: string;
}

export interface RedactedThinkingBlock {
  readonly type: 'redacted_thinking';
}

export interface ToolUseBlock {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export interface ToolResultBlock {
  readonly type: 'tool_result';
  readonly tool_use_id: string;
  readonly content: string | ContentBlock[];
  readonly is_error?: boolean;
}

export type ContentBlock = 
  | TextBlock 
  | ThinkingBlock 
  | RedactedThinkingBlock
  | ToolUseBlock 
  | ToolResultBlock;

// ===== Messages =====

export interface AnthropicMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string | ContentBlock[];
}

// ===== Tools =====

export interface AnthropicTool {
  readonly name: string;
  readonly description?: string;
  readonly input_schema: Record<string, unknown>; // JSON Schema
}

export type ToolChoiceAuto = { readonly type: 'auto' };
export type ToolChoiceAny = { readonly type: 'any' };
export type ToolChoiceTool = { readonly type: 'tool'; readonly name: string };
export type ToolChoiceNone = { readonly type: 'none' };

export type ToolChoice = ToolChoiceAuto | ToolChoiceAny | ToolChoiceTool | ToolChoiceNone;

// ===== Request =====

export interface AnthropicRequest {
  readonly model: string;
  readonly messages: AnthropicMessage[];
  readonly max_tokens: number; // Required
  readonly system?: string | ContentBlock[];
  readonly metadata?: {
    readonly user_id?: string;
    readonly [key: string]: unknown;
  };
  readonly stop_sequences?: string[];
  readonly stream?: boolean;
  readonly temperature?: number;
  readonly top_p?: number;
  readonly top_k?: number;
  readonly tools?: AnthropicTool[];
  readonly tool_choice?: ToolChoice;
}

// ===== Response =====

export interface AnthropicUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
}

export type StopReason = 
  | 'end_turn' 
  | 'max_tokens' 
  | 'stop_sequence' 
  | 'tool_use'
  | 'pause_turn'
  | 'refusal'
  | 'model_context_window_exceeded';

export interface AnthropicResponse {
  readonly id: string;
  readonly type: 'message';
  readonly role: 'assistant';
  readonly content: ContentBlock[];
  readonly model: string;
  readonly stop_reason: StopReason | null;
  readonly stop_sequence: string | null;
  readonly usage: AnthropicUsage;
}

// ===== Streaming Events =====

export interface MessageStartEvent {
  readonly type: 'message_start';
  readonly message: {
    readonly id: string;
    readonly type: 'message';
    readonly role: 'assistant';
    readonly content: [];
    readonly model: string;
    readonly stop_reason: null;
    readonly stop_sequence: null;
    readonly usage: AnthropicUsage;
  };
}

export interface ContentBlockStartEvent {
  readonly type: 'content_block_start';
  readonly index: number;
  readonly content_block: ContentBlock;
}

export interface ContentBlockDeltaEvent {
  readonly type: 'content_block_delta';
  readonly index: number;
  readonly delta: TextDelta | ThinkingDelta | ToolUseDelta;
}

export interface TextDelta {
  readonly type: 'text_delta';
  readonly text: string;
}

export interface ThinkingDelta {
  readonly type: 'thinking_delta';
  readonly thinking: string;
}

export interface ToolUseDelta {
  readonly type: 'input_json_delta';
  readonly partial_json: string;
}

export interface ContentBlockStopEvent {
  readonly type: 'content_block_stop';
  readonly index: number;
}

export interface MessageDeltaEvent {
  readonly type: 'message_delta';
  readonly delta: {
    readonly stop_reason?: StopReason;
    readonly stop_sequence?: string | null;
  };
  readonly usage?: {
    readonly output_tokens: number;
  };
}

export interface MessageStopEvent {
  readonly type: 'message_stop';
}

export interface PingEvent {
  readonly type: 'ping';
}

export interface ErrorEvent {
  readonly type: 'error';
  readonly error: AnthropicError;
}

export type AnthropicStreamEvent = 
  | MessageStartEvent 
  | ContentBlockStartEvent 
  | ContentBlockDeltaEvent 
  | ContentBlockStopEvent 
  | MessageDeltaEvent 
  | MessageStopEvent
  | PingEvent
  | ErrorEvent;

// ===== Errors =====

export interface AnthropicError {
  readonly type: 
    | 'invalid_request_error'
    | 'authentication_error'
    | 'permission_error'
    | 'not_found_error'
    | 'rate_limit_error'
    | 'api_error'
    | 'overloaded_error';
  readonly message: string;
}

export interface AnthropicErrorResponse {
  readonly type: 'error';
  readonly error: AnthropicError;
}
