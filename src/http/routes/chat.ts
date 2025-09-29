import * as vscode from 'vscode';
import type { IncomingMessage, ServerResponse } from 'http';
import { state } from '../../state';
import { isChatCompletionRequest, type ChatCompletionRequest } from '../../messages';
import { readJson, writeErrorResponse } from '../utils';
import { verbose } from '../../log';
import { ModelService } from '../../services/model-service';
import { StreamingResponseHandler } from '../../services/streaming-handler';
import { processLanguageModelResponse, sendCompletionResponse } from '../../services/response-formatter';
import type { ChatCompletionContext } from '../../types/openai-types';

/**
 * Handles OpenAI-compatible chat completion requests with support for streaming and tool calling
 * @param req - HTTP request object
 * @param res - HTTP response object
 */
export async function handleChatCompletion(req: IncomingMessage, res: ServerResponse): Promise<void> {
  state.activeRequests++;
  verbose(`Request started (active=${state.activeRequests})`);

  try {
    const body = await readJson(req);
    if (!isChatCompletionRequest(body)) {
      return writeErrorResponse(res, 400, 'invalid request', 'invalid_request_error', 'invalid_payload');
    }

    const modelService = new ModelService();
    
    // Validate model availability
    const modelValidation = await modelService.validateModel(body.model);
    if (!modelValidation.isValid) {
      const errorMessage = body.model ? 'model not found' : 'Copilot unavailable';
      return writeErrorResponse(
        res, 
        modelValidation.statusCode!, 
        errorMessage, 
        modelValidation.errorType!, 
        modelValidation.errorCode!, 
        modelValidation.reason || 'unknown_error'
      );
    }

    // Create processing context
    const context = await modelService.createProcessingContext(body);
    const chatContext = modelService.createChatCompletionContext(body, context.lmTools.length > 0);
    
    verbose(`LM request via API model=${context.model.family || context.model.id || context.model.name || 'unknown'} tools=${context.lmTools.length}`);

    // Execute the Language Model request
    const cancellationToken = new vscode.CancellationTokenSource();
    const response = await context.model.sendRequest(
      context.lmMessages, 
      context.requestOptions, 
      cancellationToken.token
    );

    // Handle response based on streaming preference
    if (chatContext.isStreaming) {
      await handleStreamingResponse(res, response, chatContext, body);
    } else {
      await handleNonStreamingResponse(res, response, chatContext, body);
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    writeErrorResponse(res, 500, errorMessage || 'internal_error', 'server_error', 'internal_error');
  } finally {
    state.activeRequests--;
    verbose(`Request complete (active=${state.activeRequests})`);
  }
}

/**
 * Handles streaming response using Server-Sent Events
 */
async function handleStreamingResponse(
  res: ServerResponse,
  response: vscode.LanguageModelChatResponse,
  chatContext: ChatCompletionContext,
  requestBody: ChatCompletionRequest
): Promise<void> {
  const streamHandler = new StreamingResponseHandler(res, chatContext, requestBody);
  streamHandler.initializeStream();
  await streamHandler.processAndStreamResponse(response);
}

/**
 * Handles non-streaming response with complete data
 */
async function handleNonStreamingResponse(
  res: ServerResponse,
  response: vscode.LanguageModelChatResponse,
  chatContext: ChatCompletionContext,
  requestBody: ChatCompletionRequest
): Promise<void> {
  const processedData = await processLanguageModelResponse(response);
  sendCompletionResponse(res, chatContext, processedData, requestBody);
}
