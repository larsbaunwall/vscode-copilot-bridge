import type { IncomingMessage } from 'http';

// Cache the authorization header to avoid repeated concatenation
let cachedToken = '';
let cachedAuthHeader = '';

/**
 * Checks if the request is authorized against the configured token.
 * Caches the full "Bearer <token>" header to optimize hot path.
 */
export const isAuthorized = (req: IncomingMessage, token: string): boolean => {
  if (!token) {
    cachedToken = '';
    cachedAuthHeader = '';
    return false;
  }

  // Update cache if token changed
  if (token !== cachedToken) {
    cachedToken = token;
    cachedAuthHeader = `Bearer ${token}`;
  }
  
  return req.headers.authorization === cachedAuthHeader;
};
