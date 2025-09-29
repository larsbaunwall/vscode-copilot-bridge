import * as vscode from 'vscode';
import type { IncomingMessage, ServerResponse } from 'http';
import { state } from '../../state';
import { getBridgeConfig } from '../../config';
import { isChatCompletionRequest, normalizeMessagesLM, convertOpenAIToolsToLM, convertFunctionsToTools } from '../../messages';
import { getModel, hasLMApi } from '../../models';
import { readJson, writeErrorResponse, writeJson } from '../utils';
import { verbose } from '../../log';

// OpenAI response interfaces for better typing
interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  function_call?: {
    name: string;
    arguments: string;
  };
}

interface OpenAIChoice {
  index: number;
  message?: OpenAIMessage;
  delta?: Partial<OpenAIMessage>;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;
}

interface OpenAIResponse {
  id: string;
  object: 'chat.completion' | 'chat.completion.chunk';
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export const handleChatCompletion = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const config = getBridgeConfig();
  state.activeRequests++;
  verbose(`Request started (active=${state.activeRequests})`);

  try {
    const body = await readJson(req);
    if (!isChatCompletionRequest(body)) {
      return writeErrorResponse(res, 400, 'invalid request', 'invalid_request_error', 'invalid_payload');
    }

    const requestedModel = body.model;
    const stream = body.stream !== false; // default true
    
    // Handle tools and deprecated functions
    let tools = body.tools || [];
    if (body.functions) {
      // Convert deprecated functions to tools format
      tools = [...tools, ...convertFunctionsToTools(body.functions)];
    }
    
    const model = await getModel(false, requestedModel);

    if (!model) {
      const hasLM = hasLMApi();
      if (requestedModel && hasLM) {
        state.lastReason = 'not_found';
        return writeErrorResponse(res, 404, 'model not found', 'invalid_request_error', 'model_not_found', 'not_found');
      }
      const reason = !hasLM ? 'missing_language_model_api' : (state.lastReason || 'copilot_model_unavailable');
      return writeErrorResponse(res, 503, 'Copilot unavailable', 'server_error', 'copilot_unavailable', reason);
    }

    const lmMessages = normalizeMessagesLM(body.messages, config.historyWindow) as vscode.LanguageModelChatMessage[];
    const lmTools = convertOpenAIToolsToLM(tools);
    
    // Prepare request options for Language Model API
    const requestOptions: any = {};
    if (lmTools.length > 0) {
      requestOptions.tools = lmTools;
    }
    
    verbose(`LM request via API model=${model.family || model.id || model.name || 'unknown'} tools=${lmTools.length}`);

    const cts = new vscode.CancellationTokenSource();
    const response = await model.sendRequest(lmMessages, requestOptions, cts.token);
    await sendResponse(res, response, stream, body, tools);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeErrorResponse(res, 500, msg || 'internal_error', 'server_error', 'internal_error');
  } finally {
    state.activeRequests--;
    verbose(`Request complete (active=${state.activeRequests})`);
  }
};

const sendResponse = async (
  res: ServerResponse, 
  response: vscode.LanguageModelChatResponse, 
  stream: boolean,
  requestBody?: any,
  tools?: any[]
): Promise<void> => {
  const modelName = requestBody?.model || 'copilot';
  const responseId = `chatcmpl-${Math.random().toString(36).slice(2)}`;
  const created = Math.floor(Date.now() / 1000);

  if (stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    
    verbose(`SSE start id=${responseId}`);
    
    let toolCalls: OpenAIToolCall[] = [];
    
    for await (const part of response.stream) {
      // Check if this part is a LanguageModelToolCallPart
      if (part && typeof part === 'object' && 'callId' in part && 'name' in part && 'input' in part) {
        const toolCallPart = part as vscode.LanguageModelToolCallPart;
        const toolCall: OpenAIToolCall = {
          id: toolCallPart.callId,
          type: 'function',
          function: {
            name: toolCallPart.name,
            arguments: JSON.stringify(toolCallPart.input)
          }
        };
        toolCalls.push(toolCall);
        
        // Send tool call in streaming format
        const chunkResponse: OpenAIResponse = {
          id: responseId,
          object: 'chat.completion.chunk',
          created,
          model: modelName,
          choices: [{
            index: 0,
            delta: {
              tool_calls: [toolCall]
            },
            finish_reason: null
          }]
        };
        res.write(`data: ${JSON.stringify(chunkResponse)}\n\n`);
      } else if (typeof part === 'string' || (part && typeof part === 'object' && 'value' in part)) {
        // Handle text content
        const content = typeof part === 'string' ? part : (part as any).value || '';
        if (content) {
          const chunkResponse: OpenAIResponse = {
            id: responseId,
            object: 'chat.completion.chunk',
            created,
            model: modelName,
            choices: [{
              index: 0,
              delta: { content },
              finish_reason: null
            }]
          };
          res.write(`data: ${JSON.stringify(chunkResponse)}\n\n`);
        }
      }
    }
    
    // Send final chunk
    const finishReason: OpenAIChoice['finish_reason'] = toolCalls.length > 0 ? 'tool_calls' : 'stop';
    const finalChunkResponse: OpenAIResponse = {
      id: responseId,
      object: 'chat.completion.chunk',
      created,
      model: modelName,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: finishReason
      }]
    };
    res.write(`data: ${JSON.stringify(finalChunkResponse)}\n\n`);
    
    verbose(`SSE end id=${responseId}`);
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  // Non-streaming response
  let content = '';
  let toolCalls: OpenAIToolCall[] = [];
  
  for await (const part of response.stream) {
    if (part && typeof part === 'object' && 'callId' in part && 'name' in part && 'input' in part) {
      // Handle VS Code LanguageModelToolCallPart
      const toolCallPart = part as vscode.LanguageModelToolCallPart;
      const toolCall: OpenAIToolCall = {
        id: toolCallPart.callId,
        type: 'function',
        function: {
          name: toolCallPart.name,
          arguments: JSON.stringify(toolCallPart.input)
        }
      };
      toolCalls.push(toolCall);
    } else if (typeof part === 'string' || (part && typeof part === 'object' && 'value' in part)) {
      // Handle text content
      content += typeof part === 'string' ? part : (part as any).value || '';
    }
  }
  
  verbose(`Non-stream complete len=${content.length} tool_calls=${toolCalls.length}`);
  
  const message: OpenAIMessage = {
    role: 'assistant',
    content: toolCalls.length > 0 ? null : content,
  };
  
  // Add tool_calls if present
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
    
    // For backward compatibility, also add function_call if there's exactly one tool call
    if (toolCalls.length === 1 && requestBody?.function_call !== undefined) {
      message.function_call = {
        name: toolCalls[0].function.name,
        arguments: toolCalls[0].function.arguments
      };
    }
  }
  
  const responseObj: OpenAIResponse = {
    id: responseId,
    object: 'chat.completion',
    created,
    model: modelName,
    choices: [{
      index: 0,
      message,
      finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    }],
    usage: {
      prompt_tokens: 0, // VS Code API doesn't provide token counts
      completion_tokens: 0,
      total_tokens: 0
    }
  };
  
  writeJson(res, 200, responseObj);
};
