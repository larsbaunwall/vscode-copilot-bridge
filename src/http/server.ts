import polka from 'polka';
import type { Server, IncomingMessage, ServerResponse } from 'http';
import { getBridgeConfig } from '../config';
import { state } from '../state';
import { isAuthorized } from './auth';
import { handleHealthCheck } from './routes/health';
import { handleModelsRequest } from './routes/models';
import { handleChatCompletion } from './routes/chat';
import { handleMessages } from './routes/messages';
import { writeErrorResponse, writeNotFound, writeRateLimit, writeTokenRequired, writeUnauthorized } from './utils';
import { ensureOutput, verbose } from '../log';
import { updateStatus } from '../status';

export const startServer = async (): Promise<void> => {
  if (state.server) {
    verbose('Server already running, skipping start');
    return;
  }
  
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
      writeNotFound(res);
    },
  });

  // Auth middleware - runs before all routes (except /health)
  app.use((req, res, next) => {
    const path = req.url ?? '/';
    if (path === '/health') {
      return next();
    }
    // Use cached config from closure instead of fresh read (PERFORMANCE FIX)
    if (!config.token) {
      if (config.verbose) {
        verbose('401 unauthorized: missing auth token');
      }
      writeTokenRequired(res);
      return;
    }
    if (!isAuthorized(req, config.token)) {
      writeUnauthorized(res);
      return;
    }
    next();
  });

  // Verbose logging middleware
  if (config.verbose) {
    app.use((req, res, next) => {
      verbose(`${req.method} ${req.url}`);
      next();
    });
  }

  app.get('/health', async (_req: IncomingMessage, res: ServerResponse) => {
    await handleHealthCheck(res, config.verbose);
  });

  app.get('/v1/models', async (_req: IncomingMessage, res: ServerResponse) => {
    await handleModelsRequest(res);
  });

  app.post('/v1/chat/completions', async (req: IncomingMessage, res: ServerResponse) => {
    // Rate limiting check
    if (state.activeRequests >= config.maxConcurrent) {
      if (config.verbose) {
        verbose(`429 throttled (active=${state.activeRequests}, max=${config.maxConcurrent})`);
      }
      writeRateLimit(res);
      return;
    }
    
    try {
      await handleChatCompletion(req, res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      writeErrorResponse(res, 500, msg || 'internal_error', 'server_error', 'internal_error');
    }
  });

  app.post('/v1/messages', async (req: IncomingMessage, res: ServerResponse) => {
    // Rate limiting check
    if (state.activeRequests >= config.maxConcurrent) {
      if (config.verbose) {
        verbose(`429 throttled (active=${state.activeRequests}, max=${config.maxConcurrent})`);
      }
      writeRateLimit(res);
      return;
    }
    
    try {
      await handleMessages(req, res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      writeErrorResponse(res, 500, msg || 'internal_error', 'server_error', 'internal_error');
    }
  });

  await new Promise<void>((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 3;
    const retryDelay = 1000; // 1 second
    
    const tryListen = () => {
      attempts++;
      try {
        const listener = app.listen(config.port, config.host, () => {
          const srv = app.server as Server | undefined;
          if (!srv) return reject(new Error('Server failed to start'));
          
          // Enable SO_REUSEADDR to allow immediate port reuse after restart
          srv.on('listening', () => {
            const address = srv.address();
            if (address && typeof address === 'object') {
              verbose(`Server listening on ${address.address}:${address.port}`);
            }
          });
          
          state.server = srv;
          updateStatus('start');
          resolve();
        });
        
        const srv = app.server as Server | undefined;
        srv?.on('error', (err: NodeJS.ErrnoException) => {
          // Clear state on error to allow retry
          state.server = undefined;
          
          if (err.code === 'EADDRINUSE') {
            if (attempts < maxAttempts) {
              verbose(`Port ${config.port} in use, retrying in ${retryDelay}ms (attempt ${attempts}/${maxAttempts})`);
              setTimeout(tryListen, retryDelay);
            } else {
              reject(new Error(`Port ${config.port} is already in use after ${maxAttempts} attempts. Please wait a moment and try again, or change the port.`));
            }
          } else {
            reject(err);
          }
        });
      } catch (err) {
        state.server = undefined;
        reject(err);
      }
    };
    
    tryListen();
  });
};

export const stopServer = async (): Promise<void> => {
  if (!state.server) {
    verbose('No server to stop');
    return;
  }
  
  const serverToClose = state.server;
  state.server = undefined; // Clear reference immediately to prevent double-stop
  
  // Force-close all active connections to ensure port is released
  verbose('Closing all server connections...');
  
  // Get all sockets and destroy them
  const sockets = new Set<any>();
  serverToClose.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  
  // Destroy existing connections
  sockets.forEach(socket => {
    try {
      socket.destroy();
    } catch (e) {
      // Ignore errors during socket destruction
    }
  });
  
  // Add timeout to prevent hanging
  const closePromise = new Promise<void>((resolve) => {
    serverToClose.close((err) => {
      if (err) {
        verbose(`Server close error (ignoring): ${err.message}`);
      } else {
        verbose('Server closed successfully');
      }
      resolve();
    });
  });
  
  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(() => {
      verbose('Server close timeout - forcing');
      // Force unref to release the port
      serverToClose.unref();
      resolve();
    }, 2000); // 2 second timeout (reduced from 5)
  });
  
  await Promise.race([closePromise, timeoutPromise]);
  
  // Give the OS a moment to fully release the port
  await new Promise(resolve => setTimeout(resolve, 100));
};
