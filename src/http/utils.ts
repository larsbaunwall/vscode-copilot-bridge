import type { ServerResponse, IncomingMessage } from 'http';

export interface ErrorResponse {
  readonly error: {
    readonly message: string;
    readonly type: string;
    readonly code: string;
    readonly reason?: string;
  };
}

export const writeJson = (res: ServerResponse, status: number, body: any): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

export const writeErrorResponse = (
  res: ServerResponse,
  status: number,
  message: string,
  type: string,
  code: string,
  reason?: string
): void => {
  writeJson(res, status, {
    error: { message, type, code, ...(reason && { reason }) },
  });
};

export const readJson = (req: IncomingMessage): Promise<any> =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
