import type { ChatCompletionRequest, Tool } from '../messages';
import type * as vscode from 'vscode';

/**
 * Validates and extracts tool configurations from request body
 * @param body - The parsed request body
 * @returns Combined tools array including converted deprecated functions
 */
export function extractAndMergeTools(body: ChatCompletionRequest): Tool[] {
  const tools = body.tools || [];
  
  if (body.functions) {
    // Convert deprecated functions to tools format
    const convertedTools: Tool[] = body.functions.map(func => ({
      type: 'function' as const,
      function: func
    }));
    return [...tools, ...convertedTools];
  }
  
  return tools;
}

/**
 * Creates VS Code Language Model request options from processed context
 * @param lmTools - Array of Language Model compatible tools
 * @returns Request options object for the Language Model API
 */
export function createLanguageModelRequestOptions(
  lmTools: vscode.LanguageModelChatTool[]
): vscode.LanguageModelChatRequestOptions {
  const options: vscode.LanguageModelChatRequestOptions = {};
  
  if (lmTools.length > 0) {
    options.tools = lmTools;
  }
  
  return options;
}