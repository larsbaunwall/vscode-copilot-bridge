import type { ServerResponse, IncomingMessage } from 'http';

export interface ErrorResponse {
  readonly error: {
    readonly message: string;
    readonly type: string;
    readonly code: string;
    readonly reason?: string;
  };
}

export const writeJson = <T>(res: ServerResponse, status: number, body: T): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
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
