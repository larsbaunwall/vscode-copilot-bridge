import type * as vscode from 'vscode';
import type { ChatCompletionRequest } from '../messages';
import type { 
  ModelValidationResult, 
  RequestProcessingContext,
  ChatCompletionContext
} from '../types/openai-types';
import { 
  extractAndMergeTools, 
  createLanguageModelRequestOptions 
} from './request-processor';
import { getModel, hasLMApi } from '../models';
import { normalizeMessagesLM, convertOpenAIToolsToLM } from '../messages';
import { getBridgeConfig } from '../config';

/**
 * Service for validating models and creating request processing context
 */
export class ModelService {
  
  /**
   * Validates the requested model and returns appropriate error details if invalid
   * @param requestedModel - The model identifier from the request
   * @returns Validation result with error details if model is unavailable
   */
  public async validateModel(requestedModel?: string): Promise<ModelValidationResult> {
    const model = await getModel(false, requestedModel);
    
    if (!model) {
      const hasLM = hasLMApi();
      
      if (requestedModel && hasLM) {
        return {
          isValid: false,
          statusCode: 404,
          errorType: 'invalid_request_error',
          errorCode: 'model_not_found',
          reason: 'not_found'
        };
      }
      
      const reason = !hasLM ? 'missing_language_model_api' : 'copilot_model_unavailable';
      return {
        isValid: false,
        statusCode: 503,
        errorType: 'server_error',
        errorCode: 'copilot_unavailable',
        reason
      };
    }
    
    return { isValid: true };
  }

  /**
   * Creates a complete request processing context from validated inputs
   * @param body - The validated chat completion request
   * @returns Processing context with all required elements for the Language Model API
   */
  public async createProcessingContext(body: ChatCompletionRequest): Promise<RequestProcessingContext> {
    const model = await getModel(false, body.model);
    if (!model) {
      throw new Error('Model validation should be performed before creating processing context');
    }

    const config = getBridgeConfig();
    const mergedTools = extractAndMergeTools(body);
    const lmMessages = normalizeMessagesLM(body.messages, config.historyWindow);
    const lmTools = convertOpenAIToolsToLM(mergedTools);
    const requestOptions = createLanguageModelRequestOptions(lmTools);

    return {
      model,
      lmMessages: lmMessages as vscode.LanguageModelChatMessage[],
      lmTools,
      requestOptions,
      mergedTools
    };
  }

  /**
   * Creates chat completion context for response formatting
   * @param body - The chat completion request
   * @param hasTools - Whether tools are present in the request
   * @returns Context object for response handling
   */
  public createChatCompletionContext(
    body: ChatCompletionRequest, 
    hasTools: boolean
  ): ChatCompletionContext {
    return {
      requestId: `chatcmpl-${Math.random().toString(36).slice(2)}`,
      modelName: body.model || 'copilot',
      created: Math.floor(Date.now() / 1000),
      hasTools,
      isStreaming: body.stream !== false
    };
  }
}