import type { IncomingMessage } from 'http';

export const isAuthorized = (req: IncomingMessage, token: string): boolean =>
  !token || req.headers.authorization === `Bearer ${token}`;
