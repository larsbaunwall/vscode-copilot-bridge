import polka from 'polka';
import type { Server, IncomingMessage, ServerResponse } from 'http';
import { getBridgeConfig } from '../config';
import { state } from '../state';
import { isAuthorized } from './auth';
import { handleHealthCheck } from './routes/health';
import { handleModelsRequest } from './routes/models';
import { handleChatCompletion } from './routes/chat';
import { writeErrorResponse } from './utils';
import { ensureOutput, verbose } from '../log';
import { updateStatus } from '../status';

export const startServer = async (): Promise<void> => {
  if (state.server) return;
  const config = getBridgeConfig();
  ensureOutput();

  const app = polka({
    onError: (err, req, res) => {
      const msg = err instanceof Error ? err.message : String(err);
      verbose(`HTTP error: ${msg}`);
      if (!res.headersSent) {
        writeErrorResponse(res, 500, msg || 'internal_error', 'server_error', 'internal_error');
      } else {
        try { res.end(); } catch {/* ignore */}
      }
    },
    onNoMatch: (_req, res) => {
      writeErrorResponse(res, 404, 'not found', 'invalid_request_error', 'route_not_found');
    },
  });

  // Logging + auth middleware
  app.use((req: IncomingMessage & { method?: string; url?: string }, res: ServerResponse, next: () => void) => {
    verbose(`HTTP ${req.method} ${req.url}`);
    if (!isAuthorized(req, config.token)) {
      writeErrorResponse(res, 401, 'unauthorized', 'invalid_request_error', 'unauthorized');
      return;
    }
    next();
  });

  app.get('/health', async (_req: IncomingMessage, res: ServerResponse) => {
    await handleHealthCheck(res, config.verbose);
  });

  app.get('/v1/models', async (_req: IncomingMessage, res: ServerResponse) => {
    await handleModelsRequest(res);
  });

  app.post('/v1/chat/completions', async (req: IncomingMessage, res: ServerResponse) => {
    if (state.activeRequests >= config.maxConcurrent) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '1' });
      res.end(JSON.stringify({
        error: {
          message: 'too many requests',
          type: 'rate_limit_error',
          code: 'rate_limit_exceeded',
        },
      }));
      verbose(`429 throttled (active=${state.activeRequests}, max=${config.maxConcurrent})`);
      return;
    }
    try {
      await handleChatCompletion(req, res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      writeErrorResponse(res, 500, msg || 'internal_error', 'server_error', 'internal_error');
    }
  });

  await new Promise<void>((resolve, reject) => {
    try {
      app.listen(config.port, config.host, () => {
        const srv = app.server as Server | undefined;
        if (!srv) return reject(new Error('Server failed to start'));
        state.server = srv;
        updateStatus('start');
        resolve();
      });
      const srv = app.server as Server | undefined;
      srv?.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
};

export const stopServer = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    if (!state.server) return resolve();
    state.server.close(() => resolve());
  });
  state.server = undefined;
};
