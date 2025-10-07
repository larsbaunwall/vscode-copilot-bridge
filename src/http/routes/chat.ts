import type { IncomingMessage, ServerResponse } from 'http';
import { readJson } from '../utils';
import { handleOpenAIRequest } from '../../providers/openai';

/**
 * Handles OpenAI-compatible chat completion requests with support for streaming and tool calling.
 * Delegates to OpenAI provider for actual request processing.
 * @param req - HTTP request object
 * @param res - HTTP response object
 */
export async function handleChatCompletion(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  await handleOpenAIRequest(body, res);
}
