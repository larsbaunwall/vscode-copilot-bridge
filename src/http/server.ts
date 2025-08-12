const polka = require('polka');
import type { Server } from 'http';
import { getBridgeConfig } from '../config';
import { state } from '../state';
import { isAuthorized } from './auth';
import { handleHealthCheck } from './routes/health';
import { handleModelsRequest } from './routes/models';
import { handleChatCompletion } from './routes/chat';
import { writeErrorResponse } from './utils';
import { ensureOutput, verbose } from '../log';
import { updateStatusAfterStart } from '../status';

export const startServer = async (): Promise<void> => {
  if (state.server) return;
  const config = getBridgeConfig();
  ensureOutput();

  const app = polka();

  app.use((req: any, res: any, next: any) => {
    verbose(`HTTP ${req.method} ${req.url}`);
    if (!isAuthorized(req, config.token)) {
      writeErrorResponse(res, 401, 'unauthorized', 'invalid_request_error', 'unauthorized');
      return;
    }
    next();
  });

  app.get('/healthz', async (_req: any, res: any) => {
    await handleHealthCheck(res, config.verbose);
  });

  app.get('/v1/models', async (_req: any, res: any) => {
    await handleModelsRequest(res);
  });

  app.post('/v1/chat/completions', async (req: any, res: any) => {
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
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e);
      writeErrorResponse(res, 500, msg || 'internal_error', 'server_error', 'internal_error');
    }
  });

  await new Promise<void>((resolve, reject) => {
    let resolved = false;
    try {
      app.listen(config.port, config.host, () => {
        const srv: Server | undefined = app.server;
        if (!srv) {
          reject(new Error('Server failed to start'));
          return;
        }
        state.server = srv;
        updateStatusAfterStart();
        resolved = true;
        resolve();
      });
    } catch (err) {
      reject(err);
      return;
    }
    const srv: Server | undefined = app.server;
    if (srv && typeof (srv as any).on === 'function') {
      srv.on('error', reject);
    }
    if (!resolved && app.server && typeof (app.server as any).on === 'function') {
      app.server.on('error', reject);
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
