/**
 * Anthropic provider: handles /v1/messages endpoint logic
 */
import * as vscode from 'vscode';
import type { ServerResponse } from 'http';
import { state } from '../state';
import { verbose } from '../log';
import { getModel, hasLMApi } from '../models';
import { writeErrorResponse, writeJson } from '../http/utils';
import { getBridgeConfig } from '../config';
import type {
  AnthropicRequest,
  AnthropicMessage,
  AnthropicResponse,
  AnthropicStreamEvent,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  AnthropicTool,
  AnthropicError,
  StopReason,
} from '../types/anthropic-types';

const ANTHROPIC_SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
} as const;

interface AnthropicContext {
  readonly messageId: string;
  readonly modelName: string;
  readonly isStreaming: boolean;
}

/**
 * Handles Anthropic Messages API request body.
 * @param body - Request body (already parsed JSON)
 * @param res - HTTP response object
 */
export async function handleAnthropicRequest(body: unknown, res: ServerResponse): Promise<void> {
  state.activeRequests++;
  verbose(`Anthropic request started (active=${state.activeRequests})`);

  try {
    if (!isAnthropicRequest(body)) {
      writeAnthropicError(res, 400, 'invalid_request_error', 'Invalid request body');
      return;
    }

    // Validate required max_tokens
    if (!body.max_tokens || typeof body.max_tokens !== 'number' || body.max_tokens <= 0) {
      writeAnthropicError(res, 400, 'invalid_request_error', 'max_tokens is required and must be positive');
      return;
    }

    const model = await resolveModel(body.model, res);
    if (!model) {
      return;
    }

    const config = getBridgeConfig();
    const lmMessages = normalizeAnthropicMessages(body, config.historyWindow);
    const lmTools = convertAnthropicToolsToLM(body.tools);
    const requestOptions: vscode.LanguageModelChatRequestOptions = lmTools.length > 0 
      ? { tools: lmTools } 
      : {};

    const modelName = selectResponseModelName(model, body.model);
    const context = createAnthropicContext(body, modelName);
    verbose(`LM request via Anthropic model=${model.family || model.id || model.name || 'unknown'} tools=${lmTools.length}`);

    const cancellationToken = new vscode.CancellationTokenSource();

    try {
      const response = await model.sendRequest(
        lmMessages as vscode.LanguageModelChatMessage[],
        requestOptions,
        cancellationToken.token
      );

      try {
        if (context.isStreaming) {
          await streamAnthropicResponse(res, response, context);
        } else {
          const processed = await collectAnthropicData(response);
          sendAnthropicResponse(res, context, processed);
        }
      } finally {
        disposeResponse(response);
      }
    } finally {
      cancellationToken.dispose();
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    writeAnthropicError(res, 500, 'api_error', errorMessage || 'Internal server error');
  } finally {
    state.activeRequests--;
    verbose(`Anthropic request complete (active=${state.activeRequests})`);
  }
}

function isAnthropicRequest(body: unknown): body is AnthropicRequest {
  if (typeof body !== 'object' || body === null) return false;
  const candidate = body as Record<string, unknown>;
  return (
    'model' in candidate &&
    typeof candidate.model === 'string' &&
    'messages' in candidate &&
    Array.isArray(candidate.messages)
  );
}

async function resolveModel(
  requestedModel: string | undefined,
  res: ServerResponse
): Promise<vscode.LanguageModelChat | undefined> {
  const model = await getModel(false, requestedModel);
  if (model) {
    return model;
  }

  const hasLanguageModels = hasLMApi();
  if (requestedModel && hasLanguageModels) {
    writeAnthropicError(res, 404, 'not_found_error', 'The requested model does not exist');
  } else {
    writeAnthropicError(res, 503, 'api_error', 'Language model API unavailable');
  }
  return undefined;
}

function createAnthropicContext(body: AnthropicRequest, modelName: string): AnthropicContext {
  return {
    messageId: `msg_${Math.random().toString(36).slice(2)}`,
    modelName,
    isStreaming: body.stream === true,
  };
}

/**
 * Normalizes Anthropic messages to VS Code Language Model format.
 * Handles system prompts, content blocks, and tool messages.
 * Applies history window to limit conversation length.
 */
function normalizeAnthropicMessages(request: AnthropicRequest, historyWindow: number): vscode.LanguageModelChatMessage[] {
  const messages: vscode.LanguageModelChatMessage[] = [];
  
  // Handle system prompt
  let systemPrompt = '';
  if (request.system) {
    if (typeof request.system === 'string') {
      systemPrompt = request.system;
    } else if (Array.isArray(request.system)) {
      // Combine filter+map into single loop (PERFORMANCE FIX)
      const parts: string[] = [];
      for (const block of request.system) {
        if (block.type === 'text') {
          parts.push(block.text);
        }
      }
      systemPrompt = parts.join('\n');
    }
  }

  // Apply history window: limit conversation messages (CONSISTENCY FIX)
  // Use same logic as OpenAI provider: historyWindow * 3 to account for tool messages
  const conversationMessages = request.messages.slice(-historyWindow * 3);

  for (let i = 0; i < conversationMessages.length; i++) {
    const msg = conversationMessages[i];
    const role = msg.role === 'user' 
      ? vscode.LanguageModelChatMessageRole.User 
      : vscode.LanguageModelChatMessageRole.Assistant;
    
    let content = extractContent(msg);
    
    // Inject system prompt into first user message (VS Code LM convention)
    if (i === 0 && msg.role === 'user' && systemPrompt) {
      content = `[SYSTEM]\n${systemPrompt}\n\n${content}`;
    }

    messages.push(vscode.LanguageModelChatMessage.User(content));
  }

  return messages;
}

/**
 * Extracts text content from Anthropic message content blocks.
 */
function extractContent(msg: AnthropicMessage): string {
  if (typeof msg.content === 'string') {
    return msg.content;
  }

  if (!Array.isArray(msg.content)) {
    return '';
  }

  const parts: string[] = [];
  
  for (const block of msg.content) {
    if (block.type === 'text') {
      parts.push((block as TextBlock).text);
    } else if (block.type === 'tool_use') {
      const toolUse = block as ToolUseBlock;
      parts.push(`[TOOL_CALL:${toolUse.id}] ${toolUse.name}(${JSON.stringify(toolUse.input)})`);
    } else if (block.type === 'tool_result') {
      const toolResult = block as ToolResultBlock;
      let resultContent: string;
      if (typeof toolResult.content === 'string') {
        resultContent = toolResult.content;
      } else {
        // Combine filter+map into single loop (PERFORMANCE FIX)
        const textParts: string[] = [];
        for (const b of toolResult.content) {
          if (b.type === 'text') {
            textParts.push((b as TextBlock).text);
          }
        }
        resultContent = textParts.join('\n');
      }
      parts.push(`[TOOL_RESULT:${toolResult.tool_use_id}]\n${resultContent}`);
    }
  }

  return parts.join('\n');
}

/**
 * Converts Anthropic tools to VS Code Language Model tool format.
 */
function convertAnthropicToolsToLM(tools?: AnthropicTool[]): vscode.LanguageModelChatTool[] {
  if (!tools || tools.length === 0) {
    return [];
  }

  return tools.map(tool => ({
    name: tool.name,
    description: tool.description || '',
    inputSchema: tool.input_schema,
  }));
}

/**
 * Streams Anthropic Messages API response using Server-Sent Events.
 */
async function streamAnthropicResponse(
  res: ServerResponse,
  response: vscode.LanguageModelChatResponse,
  context: AnthropicContext
): Promise<void> {
  // Disable Nagle's algorithm for lower latency streaming
  if (res.socket) {
    res.socket.setNoDelay(true);
  }
  
  res.writeHead(200, ANTHROPIC_SSE_HEADERS);
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
  verbose(`Anthropic SSE start id=${context.messageId}`);

  // Send message_start event
  writeAnthropicEvent(res, 'message_start', {
    type: 'message_start',
    message: {
      id: context.messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model: context.modelName,
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    },
  });

  let contentBlockIndex = 0;
  let currentBlockType: 'text' | 'tool_use' | null = null;
  let sawToolCall = false;

  for await (const part of response.stream) {
    if (isToolCallPart(part)) {
      sawToolCall = true;
      
      // Serialize tool input ONCE outside the events (PERFORMANCE FIX)
      const serializedInput = JSON.stringify(part.input);
      
      // Close any open text block before starting tool block
      if (currentBlockType === 'text') {
        writeAnthropicEvent(res, 'content_block_stop', {
          type: 'content_block_stop',
          index: contentBlockIndex,
        });
        contentBlockIndex++;
        currentBlockType = null;
      }
      
      // Start tool_use block
      if (currentBlockType !== 'tool_use') {
        writeAnthropicEvent(res, 'content_block_start', {
          type: 'content_block_start',
          index: contentBlockIndex,
          content_block: {
            type: 'tool_use',
            id: part.callId,
            name: part.name,
            input: {},
          },
        });
        currentBlockType = 'tool_use';
      }

      // Send input_json_delta (use pre-serialized value)
      writeAnthropicEvent(res, 'content_block_delta', {
        type: 'content_block_delta',
        index: contentBlockIndex,
        delta: {
          type: 'input_json_delta',
          partial_json: serializedInput,
        },
      });

      // Stop current block
      writeAnthropicEvent(res, 'content_block_stop', {
        type: 'content_block_stop',
        index: contentBlockIndex,
      });
      
      contentBlockIndex++;
      currentBlockType = null;
    } else {
      const text = extractTextContent(part);
      if (text) {
        // Start text block if not already started
        if (currentBlockType !== 'text') {
          writeAnthropicEvent(res, 'content_block_start', {
            type: 'content_block_start',
            index: contentBlockIndex,
            content_block: {
              type: 'text',
              text: '',
            },
          });
          currentBlockType = 'text';
        }

        // Send text delta
        writeAnthropicEvent(res, 'content_block_delta', {
          type: 'content_block_delta',
          index: contentBlockIndex,
          delta: {
            type: 'text_delta',
            text,
          },
        });
      }
    }
  }

  // Stop final content block if one is open
  if (currentBlockType !== null) {
    writeAnthropicEvent(res, 'content_block_stop', {
      type: 'content_block_stop',
      index: contentBlockIndex,
    });
  }

  // Send message_delta with stop_reason
  const stopReason: StopReason = sawToolCall ? 'tool_use' : 'end_turn';
  writeAnthropicEvent(res, 'message_delta', {
    type: 'message_delta',
    delta: {
      stop_reason: stopReason,
      stop_sequence: null,
    },
    usage: {
      output_tokens: 0,
    },
  });

  // Send message_stop event
  writeAnthropicEvent(res, 'message_stop', {
    type: 'message_stop',
  });

  res.end();
  verbose(`Anthropic SSE end id=${context.messageId}`);
}

/**
 * Collects complete response data from VS Code Language Model stream.
 */
async function collectAnthropicData(
  response: vscode.LanguageModelChatResponse
): Promise<{ content: ContentBlock[]; stopReason: StopReason }> {
  const contentBlocks: ContentBlock[] = [];
  let textBuffer = '';
  let sawToolCall = false;

  for await (const part of response.stream) {
    if (isToolCallPart(part)) {
      // Flush any pending text
      if (textBuffer) {
        contentBlocks.push({
          type: 'text',
          text: textBuffer,
        });
        textBuffer = '';
      }

      sawToolCall = true;
      contentBlocks.push({
        type: 'tool_use',
        id: part.callId,
        name: part.name,
        input: part.input as Record<string, unknown>,
      });
    } else {
      textBuffer += extractTextContent(part);
    }
  }

  // Flush final text buffer
  if (textBuffer) {
    contentBlocks.push({
      type: 'text',
      text: textBuffer,
    });
  }

  const stopReason: StopReason = sawToolCall ? 'tool_use' : 'end_turn';
  return { content: contentBlocks, stopReason };
}

function sendAnthropicResponse(
  res: ServerResponse,
  context: AnthropicContext,
  data: { content: ContentBlock[]; stopReason: StopReason }
): void {
  const response: AnthropicResponse = {
    id: context.messageId,
    type: 'message',
    role: 'assistant',
    content: data.content,
    model: context.modelName,
    stop_reason: data.stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
    },
  };

  verbose(`Anthropic non-stream complete blocks=${data.content.length}`);
  writeJson(res, 200, response);
}

function writeAnthropicEvent(res: ServerResponse, eventType: string, data: AnthropicStreamEvent): void {
  res.write(`event: ${eventType}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function writeAnthropicError(res: ServerResponse, status: number, errorType: AnthropicError['type'], message: string): void {
  const error: AnthropicError = {
    type: errorType,
    message,
  };
  writeJson(res, status, {
    type: 'error',
    error,
  });
}

function isToolCallPart(part: unknown): part is vscode.LanguageModelToolCallPart {
  return (
    part !== null &&
    typeof part === 'object' &&
    'callId' in part &&
    'name' in part &&
    'input' in part
  );
}

function extractTextContent(part: unknown): string {
  if (typeof part === 'string') {
    return part;
  }

  if (part !== null && typeof part === 'object' && 'value' in part) {
    return String((part as { value: unknown }).value) || '';
  }

  return '';
}

function disposeResponse(response: vscode.LanguageModelChatResponse): void {
  const disposable = response as { dispose?: () => void };
  if (typeof disposable.dispose === 'function') {
    disposable.dispose();
  }
}

function selectResponseModelName(
  model: vscode.LanguageModelChat,
  requestedModel: string | undefined
): string {
  return requestedModel ?? model.id ?? model.family ?? model.name ?? 'claude';
}
