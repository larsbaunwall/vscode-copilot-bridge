import * as vscode from 'vscode';

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string | MessageContent[];
}

export interface MessageContent {
  readonly type: string;
  readonly text?: string;
  readonly [key: string]: unknown;
}

export interface ChatCompletionRequest {
  readonly model?: string;
  readonly messages: ChatMessage[];
  readonly stream?: boolean;
  readonly [key: string]: unknown;
}

const isValidRole = (role: unknown): role is 'system' | 'user' | 'assistant' =>
  typeof role === 'string' && ['system', 'user', 'assistant'].includes(role);

export const isChatMessage = (msg: unknown): msg is ChatMessage =>
  typeof msg === 'object' &&
  msg !== null &&
  'role' in msg &&
  'content' in msg &&
  isValidRole((msg as any).role) &&
  ((msg as any).content !== undefined && (msg as any).content !== null);

export const isChatCompletionRequest = (body: unknown): body is ChatCompletionRequest =>
  typeof body === 'object' &&
  body !== null &&
  'messages' in body &&
  Array.isArray((body as any).messages) &&
  (body as any).messages.length > 0 &&
  (body as any).messages.every(isChatMessage);

const toText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(toText).join('\n');
  if (content && typeof content === 'object' && 'text' in content && typeof (content as any).text === 'string') {
    return (content as any).text;
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
};

export const normalizeMessagesLM = (messages: ChatMessage[], histWindow: number): unknown[] => {
  const systemMessages = messages.filter((m) => m.role === 'system');
  const systemMessage = systemMessages[systemMessages.length - 1];
  const conversationMessages = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-histWindow * 2);

  const User = (vscode as any).LanguageModelChatMessage?.User;
  const Assistant = (vscode as any).LanguageModelChatMessage?.Assistant;

  const result: unknown[] = [];
  let firstUserSeen = false;

  for (const message of conversationMessages) {
    if (message.role === 'user') {
      let text = toText(message.content);
      if (!firstUserSeen && systemMessage) {
        text = `[SYSTEM]\n${toText(systemMessage.content)}\n\n[DIALOG]\nuser: ${text}`;
        firstUserSeen = true;
      }
      result.push(User ? User(text) : { role: 'user', content: text });
    } else if (message.role === 'assistant') {
      const text = toText(message.content);
      result.push(Assistant ? Assistant(text) : { role: 'assistant', content: text });
    }
  }

  if (!firstUserSeen && systemMessage) {
    const text = `[SYSTEM]\n${toText(systemMessage.content)}`;
    result.unshift(User ? User(text) : { role: 'user', content: text });
  }

  if (result.length === 0) {
    result.push(User ? User('') : { role: 'user', content: '' });
  }

  return result;
};

export const extractModelFamily = (requestedModel?: string): string | undefined => {
  if (!requestedModel) return undefined;
  if (/-copilot$/i.test(requestedModel)) {
    return requestedModel.replace(/-copilot$/i, '');
  }
  if (requestedModel.toLowerCase() === 'copilot') {
    return undefined;
  }
  return undefined;
};
