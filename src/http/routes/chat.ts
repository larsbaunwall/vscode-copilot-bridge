import * as vscode from 'vscode';
import type { IncomingMessage, ServerResponse } from 'http';
import { state } from '../../state';
import {
  isChatCompletionRequest,
  type ChatCompletionRequest,
  normalizeMessagesLM,
  convertOpenAIToolsToLM,
  convertFunctionsToTools,
  type Tool,
} from '../../messages';
import { readJson, writeErrorResponse, writeJson } from '../utils';
import { verbose } from '../../log';
import { getModel, hasLMApi } from '../../models';
import { getBridgeConfig } from '../../config';
import type {
  ChatCompletionContext,
  ProcessedResponseData,
  OpenAIResponse,
  OpenAIMessage,
  OpenAIToolCall,
  OpenAIChoice,
} from '../../types/openai-types';

/**
 * Handles OpenAI-compatible chat completion requests with support for streaming and tool calling.
 * @param req - HTTP request object
 * @param res - HTTP response object
 */
export async function handleChatCompletion(req: IncomingMessage, res: ServerResponse): Promise<void> {
  state.activeRequests++;
  verbose(`Request started (active=${state.activeRequests})`);

  try {
    const body = await readJson(req);
    if (!isChatCompletionRequest(body)) {
      writeErrorResponse(res, 400, 'invalid request', 'invalid_request_error', 'invalid_payload');
      return;
    }

    const model = await resolveModel(body.model, res);
    if (!model) {
      return;
    }

    const config = getBridgeConfig();
    const mergedTools = mergeTools(body);
    const lmMessages = normalizeMessagesLM(body.messages, config.historyWindow);
    const lmTools = convertOpenAIToolsToLM(mergedTools);
    const requestOptions: vscode.LanguageModelChatRequestOptions = lmTools.length > 0 
      ? { tools: lmTools } 
      : {};

    const modelName = selectResponseModelName(model, body.model);
    const chatContext = createChatCompletionContext(body, mergedTools.length > 0, modelName);
    verbose(`LM request via API model=${model.family || model.id || model.name || 'unknown'} tools=${lmTools.length}`);

    const cancellationToken = new vscode.CancellationTokenSource();

    try {
      const response = await model.sendRequest(
        lmMessages as vscode.LanguageModelChatMessage[],
        requestOptions,
        cancellationToken.token
      );

      try {
        if (chatContext.isStreaming) {
          await streamResponse(res, response, chatContext);
        } else {
          const processed = await collectResponseData(response);
          sendCompletionResponse(res, chatContext, processed, body);
        }
      } finally {
        disposeResponse(response);
      }
    } finally {
      cancellationToken.dispose();
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    writeErrorResponse(res, 500, errorMessage || 'internal_error', 'server_error', 'internal_error');
  } finally {
    state.activeRequests--;
    verbose(`Request complete (active=${state.activeRequests})`);
  }
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
} as const;

/**
 * Merges tools and deprecated functions, respecting tool_choice configuration.
 * @param body - Chat completion request
 * @returns Filtered array of tools to use
 */
function mergeTools(body: ChatCompletionRequest): Tool[] {
  // Early exit for disabled tools
  if (body.tool_choice === 'none' || body.function_call === 'none') {
    return [];
  }

  const baseTools = body.tools ?? [];
  const functionTools = convertFunctionsToTools(body.functions);
  const combined = functionTools.length > 0 ? [...baseTools, ...functionTools] : baseTools;

  // Handle specific tool selection
  if (
    body.tool_choice &&
    typeof body.tool_choice === 'object' &&
    'type' in body.tool_choice &&
    body.tool_choice.type === 'function' &&
    'function' in body.tool_choice &&
    body.tool_choice.function &&
    typeof body.tool_choice.function === 'object' &&
    'name' in body.tool_choice.function
  ) {
    const fnName = body.tool_choice.function.name;
    if (typeof fnName === 'string') {
      return combined.filter((tool) => tool.function.name === fnName);
    }
  }

  return combined;
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
    writeErrorResponse(res, 404, 'model not found', 'invalid_request_error', 'model_not_found', 'not_found');
  } else {
    const reason = hasLanguageModels ? 'copilot_model_unavailable' : 'missing_language_model_api';
    writeErrorResponse(res, 503, 'Copilot unavailable', 'server_error', 'copilot_unavailable', reason);
  }
  return undefined;
}

function createChatCompletionContext(
  body: ChatCompletionRequest,
  hasTools: boolean,
  modelName: string
): ChatCompletionContext {
  return {
    requestId: `chatcmpl-${Math.random().toString(36).slice(2)}`,
    modelName,
    created: Math.floor(Date.now() / 1000),
    hasTools,
    isStreaming: body.stream === true,
  };
}

/**
 * Streams chat completion response using Server-Sent Events.
 * @param res - HTTP response object
 * @param response - VS Code Language Model response
 * @param context - Chat completion context
 */
async function streamResponse(
  res: ServerResponse,
  response: vscode.LanguageModelChatResponse,
  context: ChatCompletionContext
): Promise<void> {
  // Disable Nagle's algorithm for lower latency streaming
  if (res.socket) {
    res.socket.setNoDelay(true);
  }
  
  res.writeHead(200, SSE_HEADERS);
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
  verbose(`SSE start id=${context.requestId}`);

  let sawToolCall = false;
  let sentRoleChunk = false;

  for await (const part of response.stream) {
    // Send initial role chunk once
    if (!sentRoleChunk) {
      writeSseData(res, createChunkResponse(context, { role: 'assistant' }, null));
      sentRoleChunk = true;
    }

    if (isToolCallPart(part)) {
      sawToolCall = true;
      writeSseData(res, createChunkResponse(context, {
        tool_calls: [createToolCall(part)],
      }, null));
    } else {
      const content = extractTextContent(part);
      if (content) {
        writeSseData(res, createChunkResponse(context, { content }, null));
      }
    }
  }

  // Ensure role chunk is sent even for empty responses
  if (!sentRoleChunk) {
    writeSseData(res, createChunkResponse(context, { role: 'assistant' }, null));
  }

  const finalChunk = createChunkResponse(context, {}, sawToolCall ? 'tool_calls' : 'stop');
  writeSseData(res, finalChunk);
  res.write('data: [DONE]\n\n');
  res.end();
  verbose(`SSE end id=${context.requestId}`);
}

/**
 * Collects complete response data from VS Code Language Model stream.
 * @param response - VS Code Language Model response
 * @returns Processed response data with content and tool calls
 */
async function collectResponseData(
  response: vscode.LanguageModelChatResponse
): Promise<ProcessedResponseData> {
  let content = '';
  const toolCalls: OpenAIToolCall[] = [];

  for await (const part of response.stream) {
    if (isToolCallPart(part)) {
      toolCalls.push(createToolCall(part));
    } else {
      content += extractTextContent(part);
    }
  }

  const finishReason: OpenAIChoice['finish_reason'] = toolCalls.length > 0 ? 'tool_calls' : 'stop';
  return { content, toolCalls, finishReason };
}

function sendCompletionResponse(
  res: ServerResponse,
  context: ChatCompletionContext,
  data: ProcessedResponseData,
  requestBody?: ChatCompletionRequest
): void {
  const message = createOpenAIMessage(data, requestBody);
  const response: OpenAIResponse = {
    id: context.requestId,
    object: 'chat.completion',
    created: context.created,
    model: context.modelName,
    choices: [
      {
        index: 0,
        message,
        finish_reason: data.finishReason,
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };

  verbose(`Non-stream complete len=${data.content.length} tool_calls=${data.toolCalls.length}`);
  writeJson(res, 200, response);
}

function createOpenAIMessage(
  data: ProcessedResponseData,
  requestBody?: ChatCompletionRequest
): OpenAIMessage {
  const base: OpenAIMessage = {
    role: 'assistant',
    content: data.toolCalls.length > 0 ? null : data.content,
  };

  if (data.toolCalls.length === 0) {
    return base;
  }

  const withTools: OpenAIMessage = {
    ...base,
    tool_calls: data.toolCalls,
  };

  if (data.toolCalls.length === 1 && requestBody?.function_call !== undefined) {
    return {
      ...withTools,
      function_call: {
        name: data.toolCalls[0].function.name,
        arguments: data.toolCalls[0].function.arguments,
      },
    };
  }

  return withTools;
}

function createChunkResponse(
  context: ChatCompletionContext,
  delta: Partial<OpenAIMessage>,
  finishReason: OpenAIChoice['finish_reason'] | null
): OpenAIResponse {
  return {
    id: context.requestId,
    object: 'chat.completion.chunk',
    created: context.created,
    model: context.modelName,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
}

function writeSseData(res: ServerResponse, data: OpenAIResponse): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function createToolCall(part: vscode.LanguageModelToolCallPart): OpenAIToolCall {
  return {
    id: part.callId,
    type: 'function',
    function: {
      name: part.name,
      arguments: JSON.stringify(part.input),
    },
  };
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

/**
 * Selects the most appropriate model name for the response.
 * Prioritizes requested model, then model ID, family, name, and finally defaults to 'copilot'.
 * @param model - VS Code Language Model instance
 * @param requestedModel - Model name from the request
 * @returns Model name to use in response
 */
function selectResponseModelName(
  model: vscode.LanguageModelChat,
  requestedModel: string | undefined
): string {
  return requestedModel ?? model.id ?? model.family ?? model.name ?? 'copilot';
}
