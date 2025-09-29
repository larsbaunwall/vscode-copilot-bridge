import type * as vscode from 'vscode';
import type { ServerResponse } from 'http';
import type { 
  OpenAIResponse, 
  OpenAIChoice, 
  OpenAIMessage, 
  OpenAIToolCall, 
  ChatCompletionContext,
  ProcessedResponseData 
} from '../types/openai-types';
import type { ChatCompletionRequest } from '../messages';
import { writeJson } from '../http/utils';
import { verbose } from '../log';

/**
 * Processes VS Code Language Model stream parts into structured data
 * @param response - The VS Code Language Model chat response
 * @returns Promise resolving to processed content and tool calls
 */
export async function processLanguageModelResponse(
  response: vscode.LanguageModelChatResponse
): Promise<ProcessedResponseData> {
  let content = '';
  const toolCalls: OpenAIToolCall[] = [];
  
  for await (const part of response.stream) {
    if (isToolCallPart(part)) {
      const toolCall: OpenAIToolCall = {
        id: part.callId,
        type: 'function',
        function: {
          name: part.name,
          arguments: JSON.stringify(part.input)
        }
      };
      toolCalls.push(toolCall);
    } else if (isTextPart(part)) {
      content += extractTextContent(part);
    }
  }
  
  const finishReason: OpenAIChoice['finish_reason'] = toolCalls.length > 0 ? 'tool_calls' : 'stop';
  
  return {
    content,
    toolCalls,
    finishReason
  };
}

/**
 * Creates an OpenAI-compatible response message
 * @param data - The processed response data
 * @param requestBody - Original request body for backward compatibility
 * @returns OpenAI message object
 */
export function createOpenAIMessage(
  data: ProcessedResponseData,
  requestBody?: ChatCompletionRequest
): OpenAIMessage {
  const baseMessage = {
    role: 'assistant' as const,
    content: data.toolCalls.length > 0 ? null : data.content,
  };
  
  // Add tool_calls if present
  if (data.toolCalls.length > 0) {
    const messageWithTools = {
      ...baseMessage,
      tool_calls: data.toolCalls,
    };
    
    // For backward compatibility, also add function_call if there's exactly one tool call
    if (data.toolCalls.length === 1 && requestBody?.function_call !== undefined) {
      return {
        ...messageWithTools,
        function_call: {
          name: data.toolCalls[0].function.name,
          arguments: data.toolCalls[0].function.arguments
        }
      };
    }
    
    return messageWithTools;
  }
  
  return baseMessage;
}

/**
 * Sends a complete (non-streaming) OpenAI-compatible response
 * @param res - HTTP response object
 * @param context - Chat completion context
 * @param data - Processed response data
 * @param requestBody - Original request body
 */
export function sendCompletionResponse(
  res: ServerResponse,
  context: ChatCompletionContext,
  data: ProcessedResponseData,
  requestBody?: ChatCompletionRequest
): void {
  const message = createOpenAIMessage(data, requestBody);
  
  const responseObj: OpenAIResponse = {
    id: context.requestId,
    object: 'chat.completion',
    created: context.created,
    model: context.modelName,
    choices: [{
      index: 0,
      message,
      finish_reason: data.finishReason,
    }],
    usage: {
      prompt_tokens: 0, // VS Code API doesn't provide token counts
      completion_tokens: 0,
      total_tokens: 0
    }
  };
  
  verbose(`Non-stream complete len=${data.content.length} tool_calls=${data.toolCalls.length}`);
  writeJson(res, 200, responseObj);
}

/**
 * Type guard for VS Code LanguageModelToolCallPart
 */
function isToolCallPart(part: unknown): part is vscode.LanguageModelToolCallPart {
  return part !== null && 
         typeof part === 'object' && 
         'callId' in part && 
         'name' in part && 
         'input' in part;
}

/**
 * Type guard for text content parts
 */
function isTextPart(part: unknown): boolean {
  return typeof part === 'string' || 
         (part !== null && typeof part === 'object' && 'value' in part);
}

/**
 * Extracts text content from various part types
 */
function extractTextContent(part: unknown): string {
  if (typeof part === 'string') {
    return part;
  }
  
  if (part !== null && typeof part === 'object' && 'value' in part) {
    return String((part as { value: unknown }).value) || '';
  }
  
  return '';
}