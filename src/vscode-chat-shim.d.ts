declare module 'vscode' {
  namespace chat {
    function requestChatAccess(providerId: string): Promise<ChatAccess>;
  }

  interface ChatAccess {
    startSession(): Promise<ChatSession>;
  }

  interface ChatSession {
    sendRequest(options: { prompt: string; attachments: any[] }): Promise<ChatResponseStream>;
  }

  interface ChatResponseStream {
    onDidProduceContent(handler: (chunk: string) => void): { dispose(): void };
    onDidEnd(handler: () => void): { dispose(): void };
  }
}
