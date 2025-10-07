import type { IncomingMessage, ServerResponse } from 'http';
import { readJson } from '../utils';
import { handleAnthropicRequest } from '../../providers/anthropic';

/**
 * Handles Anthropic Messages API requests with support for streaming and tool calling.
 * Delegates to Anthropic provider for actual request processing.
 * @param req - HTTP request object
 * @param res - HTTP response object
 */
export async function handleMessages(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  await handleAnthropicRequest(body, res);
}
