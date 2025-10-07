import type { IncomingMessage } from 'http';

// Cache both authorization header formats to avoid repeated concatenation
let cachedToken = '';
let cachedBearerHeader = '';
let cachedApiKey = '';

/**
 * Checks if the request is authorized against the configured token.
 * Supports both OpenAI (Authorization: Bearer <token>) and 
 * Anthropic (x-api-key: <token>) authentication header formats.
 * Both headers validate against the same configured token.
 * Caches both header formats to optimize hot path.
 */
export const isAuthorized = (req: IncomingMessage, token: string): boolean => {
  if (!token) {
    cachedToken = '';
    cachedBearerHeader = '';
    cachedApiKey = '';
    return false;
  }

  // Update cache if token changed
  if (token !== cachedToken) {
    cachedToken = token;
    cachedBearerHeader = `Bearer ${token}`;
    cachedApiKey = token;
  }
  
  // Check OpenAI-style Authorization: Bearer <token>
  if (req.headers.authorization === cachedBearerHeader) {
    return true;
  }

  // Check Anthropic-style x-api-key: <token>
  if (req.headers['x-api-key'] === cachedApiKey) {
    return true;
  }

  return false;
};
