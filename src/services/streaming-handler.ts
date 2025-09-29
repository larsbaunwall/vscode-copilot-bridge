import type * as vscode from 'vscode';
import type { ServerResponse } from 'http';
import type { 
  OpenAIResponse, 
  OpenAIToolCall, 
  ChatCompletionContext 
} from '../types/openai-types';
import type { ChatCompletionRequest } from '../messages';
import { verbose } from '../log';

/**
 * Handles Server-Sent Events streaming for OpenAI-compatible chat completions
 */
export class StreamingResponseHandler {
  private readonly response: ServerResponse;
  private readonly context: ChatCompletionContext;
  private readonly requestBody?: ChatCompletionRequest;
  
  constructor(
    response: ServerResponse, 
    context: ChatCompletionContext,
    requestBody?: ChatCompletionRequest
  ) {
    this.response = response;
    this.context = context;
    this.requestBody = requestBody;
  }

  /**
   * Initializes the SSE stream with proper headers
   */
  public initializeStream(): void {
    this.response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    
    verbose(`SSE start id=${this.context.requestId}`);
  }

  /**
   * Processes the Language Model response stream and sends SSE chunks
   * @param languageModelResponse - VS Code Language Model response
   */
  public async processAndStreamResponse(
    languageModelResponse: vscode.LanguageModelChatResponse
  ): Promise<void> {
    const toolCalls: OpenAIToolCall[] = [];
    
    for await (const part of languageModelResponse.stream) {
      if (this.isToolCallPart(part)) {
        const toolCall = this.createToolCallFromPart(part);
        toolCalls.push(toolCall);
        this.sendToolCallChunk(toolCall);
      } else if (this.isTextPart(part)) {
        const content = this.extractTextContent(part);
        if (content) {
          this.sendContentChunk(content);
        }
      }
    }
    
    this.sendFinalChunk(toolCalls.length > 0 ? 'tool_calls' : 'stop');
    this.endStream();
  }

  /**
   * Sends a content delta chunk
   */
  private sendContentChunk(content: string): void {
    const chunkResponse: OpenAIResponse = {
      id: this.context.requestId,
      object: 'chat.completion.chunk',
      created: this.context.created,
      model: this.context.modelName,
      choices: [{
        index: 0,
        delta: { content },
        finish_reason: null
      }]
    };
    
    this.writeSSEData(chunkResponse);
  }

  /**
   * Sends a tool call chunk
   */
  private sendToolCallChunk(toolCall: OpenAIToolCall): void {
    const chunkResponse: OpenAIResponse = {
      id: this.context.requestId,
      object: 'chat.completion.chunk',
      created: this.context.created,
      model: this.context.modelName,
      choices: [{
        index: 0,
        delta: {
          tool_calls: [toolCall]
        },
        finish_reason: null
      }]
    };
    
    this.writeSSEData(chunkResponse);
  }

  /**
   * Sends the final completion chunk with finish reason
   */
  private sendFinalChunk(finishReason: 'stop' | 'tool_calls'): void {
    const finalChunkResponse: OpenAIResponse = {
      id: this.context.requestId,
      object: 'chat.completion.chunk',
      created: this.context.created,
      model: this.context.modelName,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: finishReason
      }]
    };
    
    this.writeSSEData(finalChunkResponse);
  }

  /**
   * Ends the SSE stream
   */
  private endStream(): void {
    verbose(`SSE end id=${this.context.requestId}`);
    this.response.write('data: [DONE]\n\n');
    this.response.end();
  }

  /**
   * Writes data to the SSE stream
   */
  private writeSSEData(data: OpenAIResponse): void {
    this.response.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  /**
   * Creates an OpenAI tool call from VS Code Language Model part
   */
  private createToolCallFromPart(part: vscode.LanguageModelToolCallPart): OpenAIToolCall {
    return {
      id: part.callId,
      type: 'function',
      function: {
        name: part.name,
        arguments: JSON.stringify(part.input)
      }
    };
  }

  /**
   * Type guard for VS Code LanguageModelToolCallPart
   */
  private isToolCallPart(part: unknown): part is vscode.LanguageModelToolCallPart {
    return part !== null && 
           typeof part === 'object' && 
           'callId' in part && 
           'name' in part && 
           'input' in part;
  }

  /**
   * Type guard for text content parts
   */
  private isTextPart(part: unknown): boolean {
    return typeof part === 'string' || 
           (part !== null && typeof part === 'object' && 'value' in part);
  }

  /**
   * Extracts text content from various part types
   */
  private extractTextContent(part: unknown): string {
    if (typeof part === 'string') {
      return part;
    }
    
    if (part !== null && typeof part === 'object' && 'value' in part) {
      return String((part as { value: unknown }).value) || '';
    }
    
    return '';
  }
}