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

const VALID_ROLES = ['system', 'user', 'assistant'] as const;
type Role = typeof VALID_ROLES[number];
const isValidRole = (role: unknown): role is Role => typeof role === 'string' && VALID_ROLES.includes(role as Role);

export const isChatMessage = (msg: unknown): msg is ChatMessage => {
  if (typeof msg !== 'object' || msg === null) return false;
  const candidate = msg as Record<string, unknown>;
  if (!('role' in candidate) || !('content' in candidate)) return false;
  return isValidRole(candidate.role) && candidate.content !== undefined && candidate.content !== null;
};

export const isChatCompletionRequest = (body: unknown): body is ChatCompletionRequest => {
  if (typeof body !== 'object' || body === null) return false;
  const candidate = body as Record<string, unknown>;
  if (!('messages' in candidate)) return false;
  const messages = candidate.messages;
  return Array.isArray(messages) && messages.length > 0 && messages.every(isChatMessage);
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
  const conversationMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-histWindow * 2);

  const lmMsg = (vscode as unknown as { LanguageModelChatMessage?: typeof vscode.LanguageModelChatMessage }).LanguageModelChatMessage;
  const UserFactory = lmMsg?.User;
  const AssistantFactory = lmMsg?.Assistant;

  const result: (vscode.LanguageModelChatMessage | { role: 'user' | 'assistant'; content: string })[] = [];
  let firstUserSeen = false;

  for (const m of conversationMessages) {
    if (m.role === 'user') {
      let text = toText(m.content);
      if (!firstUserSeen && systemMessage) {
        text = `[SYSTEM]\n${toText(systemMessage.content)}\n\n[DIALOG]\nuser: ${text}`;
        firstUserSeen = true;
      }
      result.push(UserFactory ? UserFactory(text) : { role: 'user', content: text });
    } else {
      const text = toText(m.content);
      result.push(AssistantFactory ? AssistantFactory(text) : { role: 'assistant', content: text });
    }
  }

  if (!firstUserSeen && systemMessage) {
    const text = `[SYSTEM]\n${toText(systemMessage.content)}`;
    result.unshift(UserFactory ? UserFactory(text) : { role: 'user', content: text });
  }

  if (result.length === 0) result.push(UserFactory ? UserFactory('') : { role: 'user', content: '' });

  return result;
};
