import type { ServerResponse, IncomingMessage } from 'http';

export interface ErrorResponse {
  readonly error: {
    readonly message: string;
    readonly type: string;
    readonly code: string;
    readonly reason?: string;
  };
}

// Pre-serialized common error responses for hot paths
const UNAUTHORIZED_ERROR = JSON.stringify({
  error: {
    message: 'unauthorized',
    type: 'invalid_request_error',
    code: 'unauthorized',
  },
});

const NOT_FOUND_ERROR = JSON.stringify({
  error: {
    message: 'not found',
    type: 'invalid_request_error',
    code: 'route_not_found',
  },
});

const RATE_LIMIT_ERROR = JSON.stringify({
  error: {
    message: 'too many requests',
    type: 'rate_limit_error',
    code: 'rate_limit_exceeded',
  },
});

// Reusable header objects
const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;
const RATE_LIMIT_HEADERS = {
  'Content-Type': 'application/json',
  'Retry-After': '1',
} as const;

/**
 * Fast-path unauthorized response (pre-serialized).
 */
export const writeUnauthorized = (res: ServerResponse): void => {
  res.writeHead(401, JSON_HEADERS);
  res.end(UNAUTHORIZED_ERROR);
};

/**
 * Fast-path not found response (pre-serialized).
 */
export const writeNotFound = (res: ServerResponse): void => {
  res.writeHead(404, JSON_HEADERS);
  res.end(NOT_FOUND_ERROR);
};

/**
 * Fast-path rate limit response (pre-serialized).
 */
export const writeRateLimit = (res: ServerResponse): void => {
  res.writeHead(429, RATE_LIMIT_HEADERS);
  res.end(RATE_LIMIT_ERROR);
};

export const writeJson = <T>(res: ServerResponse, status: number, body: T): void => {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
};

export function writeErrorResponse(
  res: ServerResponse,
  status: number,
  message: string,
  type: string,
  code: string
): void;
export function writeErrorResponse(
  res: ServerResponse,
  status: number,
  message: string,
  type: string,
  code: string,
  reason: string
): void;
export function writeErrorResponse(
  res: ServerResponse,
  status: number,
  message: string,
  type: string,
  code: string,
  reason?: string
): void {
  writeJson(res, status, { error: { message, type, code, ...(reason ? { reason } : {}) } });
}

export const readJson = <T = unknown>(req: IncomingMessage): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve((data ? JSON.parse(data) : {}) as T);
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
