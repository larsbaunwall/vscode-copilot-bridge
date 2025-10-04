import * as vscode from 'vscode';

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content?: string | MessageContent[] | null;
  readonly name?: string;
  readonly tool_calls?: ToolCall[];
  readonly tool_call_id?: string;
  readonly function_call?: FunctionCall;
}

export interface MessageContent {
  readonly type: string;
  readonly text?: string;
  readonly [key: string]: unknown;
}

export interface ToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: FunctionCall;
}

export interface FunctionCall {
  readonly name: string;
  readonly arguments: string;
}

export interface Tool {
  readonly type: 'function';
  readonly function: ToolFunction;
}

export interface ToolFunction {
  readonly name: string;
  readonly description?: string;
  readonly parameters?: object;
}

export interface ChatCompletionRequest {
  readonly model?: string;
  readonly messages: ChatMessage[];
  readonly stream?: boolean;
  readonly tools?: Tool[];
  readonly tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
  readonly parallel_tool_calls?: boolean;
  readonly functions?: ToolFunction[]; // Deprecated, use tools instead
  readonly function_call?: 'none' | 'auto' | { name: string }; // Deprecated, use tool_choice instead
  readonly temperature?: number;
  readonly top_p?: number;
  readonly n?: number;
  readonly stop?: string | string[];
  readonly max_tokens?: number;
  readonly max_completion_tokens?: number;
  readonly presence_penalty?: number;
  readonly frequency_penalty?: number;
  readonly logit_bias?: Record<string, number>;
  readonly logprobs?: boolean;
  readonly top_logprobs?: number;
  readonly user?: string;
  readonly seed?: number;
  readonly response_format?: {
    readonly type: 'text' | 'json_object' | 'json_schema';
    readonly json_schema?: {
      readonly name: string;
      readonly schema: object;
      readonly strict?: boolean;
    };
  };
  readonly [key: string]: unknown;
}

const VALID_ROLES = ['system', 'user', 'assistant', 'tool'] as const;
type Role = typeof VALID_ROLES[number];
const isValidRole = (role: unknown): role is Role => typeof role === 'string' && VALID_ROLES.includes(role as Role);

export const isChatMessage = (msg: unknown): msg is ChatMessage => {
  if (typeof msg !== 'object' || msg === null) return false;
  const candidate = msg as Record<string, unknown>;
  if (!('role' in candidate)) return false;
  if (!isValidRole(candidate.role)) return false;
  
  // Tool messages require tool_call_id and content
  if (candidate.role === 'tool') {
    return typeof candidate.tool_call_id === 'string' && 
           (typeof candidate.content === 'string' || candidate.content === null);
  }
  
  // Assistant messages can have content and/or tool_calls/function_call
  if (candidate.role === 'assistant') {
    const hasContent = candidate.content !== undefined;
    const hasToolCalls = Array.isArray(candidate.tool_calls);
    const hasFunctionCall = typeof candidate.function_call === 'object' && candidate.function_call !== null;
    return hasContent || hasToolCalls || hasFunctionCall;
  }
  
  // System and user messages must have content
  return candidate.content !== undefined && candidate.content !== null;
};

export const isChatCompletionRequest = (body: unknown): body is ChatCompletionRequest => {
  if (typeof body !== 'object' || body === null) return false;
  const candidate = body as Record<string, unknown>;
  if (!('messages' in candidate)) return false;
  const messages = candidate.messages;
  return Array.isArray(messages) && messages.length > 0 && messages.every(isChatMessage);
};

// Convert OpenAI tools to VS Code Language Model tools
export const convertOpenAIToolsToLM = (tools?: Tool[]): vscode.LanguageModelChatTool[] => {
  if (!tools) return [];
  return tools.map(tool => ({
    name: tool.function.name,
    description: tool.function.description || '',
    inputSchema: tool.function.parameters
  }));
};

// Convert deprecated functions to tools format
export const convertFunctionsToTools = (functions?: ToolFunction[]): Tool[] => {
  if (!functions) return [];
  return functions.map(func => ({
    type: 'function' as const,
    function: func
  }));
};

const toText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(toText).join('\n');
  if (content && typeof content === 'object' && 'text' in content) {
    const textVal = (content as { text?: unknown }).text;
    if (typeof textVal === 'string') return textVal;
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
};

export const normalizeMessagesLM = (
  messages: readonly ChatMessage[],
  histWindow: number
): (vscode.LanguageModelChatMessage | { role: 'user' | 'assistant'; content: string })[] => {
  const systemMessages = messages.filter((m) => m.role === 'system');
  const systemMessage = systemMessages[systemMessages.length - 1];
  
  // Include user, assistant, and tool messages in conversation
  const conversationMessages = messages.filter((m) => 
    m.role === 'user' || m.role === 'assistant' || m.role === 'tool'
  ).slice(-histWindow * 3); // Increased window to account for tool messages

  const lmMsg = (vscode as unknown as { LanguageModelChatMessage?: typeof vscode.LanguageModelChatMessage }).LanguageModelChatMessage;
  const userFactory = lmMsg?.User;
  const assistantFactory = lmMsg?.Assistant;
  const hasFactories = Boolean(userFactory && assistantFactory);

  const result: (vscode.LanguageModelChatMessage | { role: 'user' | 'assistant'; content: string })[] = [];
  let firstUserSeen = false;

  for (const m of conversationMessages) {
    if (m.role === 'user') {
      let text = toText(m.content);
      if (!firstUserSeen && systemMessage) {
        text = `[SYSTEM]\n${toText(systemMessage.content)}\n\n[DIALOG]\nuser: ${text}`;
        firstUserSeen = true;
      }
      result.push(userFactory ? userFactory(text) : { role: 'user', content: text });
    } else if (m.role === 'assistant') {
      // For assistant messages, we need to handle both content and tool calls
      let text = '';
      
      if (m.content) {
        text = toText(m.content);
      }
      
      // If the assistant message has tool calls, format them appropriately
      if (m.tool_calls && m.tool_calls.length > 0) {
        const toolCallsText = m.tool_calls.map(tc => 
          `[TOOL_CALL:${tc.id}] ${tc.function.name}(${tc.function.arguments})`
        ).join('\n');
        
        if (text) {
          text += '\n' + toolCallsText;
        } else {
          text = toolCallsText;
        }
      }
      
      // Handle deprecated function_call format
      if (!text && m.function_call) {
        text = `[FUNCTION_CALL] ${m.function_call.name}(${m.function_call.arguments})`;
      }
      
      result.push(assistantFactory ? assistantFactory(text) : { role: 'assistant', content: text });
    } else if (m.role === 'tool') {
      // Tool messages should be converted to user messages with tool result context
      const toolResult = `[TOOL_RESULT:${m.tool_call_id}] ${toText(m.content)}`;
      result.push(userFactory ? userFactory(toolResult) : { role: 'user', content: toolResult });
    }
  }

  if (!firstUserSeen && systemMessage) {
    const text = `[SYSTEM]\n${toText(systemMessage.content)}`;
    result.unshift(userFactory ? userFactory(text) : { role: 'user', content: text });
  }

  if (result.length === 0) result.push(userFactory ? userFactory('') : { role: 'user', content: '' });

  return result;
};
