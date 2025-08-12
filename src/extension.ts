import * as vscode from 'vscode';
import * as http from 'http';
import { AddressInfo } from 'net';

// Type definitions
interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string | MessageContent[];
}

interface MessageContent {
  readonly type: string;
  readonly text?: string;
  readonly [key: string]: unknown;
}

interface ChatCompletionRequest {
  readonly model?: string;
  readonly messages: ChatMessage[];
  readonly stream?: boolean;
  readonly [key: string]: unknown;
}

interface BridgeConfig {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly token: string;
  readonly historyWindow: number;
  readonly verbose: boolean;
  readonly maxConcurrent: number;
}

interface ErrorResponse {
  readonly error: {
    readonly message: string;
    readonly type: string;
    readonly code: string;
    readonly reason?: string;
  };
}

interface LanguageModelAPI {
  readonly selectChatModels: (selector?: { vendor?: string; family?: string }) => Promise<LanguageModel[]>;
}

interface LanguageModel {
  readonly family?: string;
  readonly modelFamily?: string;
  readonly name?: string;
  readonly sendRequest: (messages: unknown[], options: unknown, token: vscode.CancellationToken) => Promise<LanguageModelResponse>;
}

interface LanguageModelResponse {
  readonly text: AsyncIterable<string>;
}

// Module state
interface BridgeState {
  server?: http.Server;
  modelCache?: LanguageModel;
  statusItem?: vscode.StatusBarItem;
  output?: vscode.OutputChannel;
  running: boolean;
  activeRequests: number;
  lastReason?: string;
}

const state: BridgeState = {
  running: false,
  activeRequests: 0,
};

// Type guards
const isValidRole = (role: unknown): role is 'system' | 'user' | 'assistant' =>
  typeof role === 'string' && ['system', 'user', 'assistant'].includes(role);

const isChatMessage = (msg: unknown): msg is ChatMessage =>
  typeof msg === 'object' && 
  msg !== null && 
  'role' in msg && 
  'content' in msg &&
  isValidRole((msg as any).role) &&
  ((msg as any).content !== undefined && (msg as any).content !== null);

const isChatCompletionRequest = (body: unknown): body is ChatCompletionRequest =>
  typeof body === 'object' && 
  body !== null && 
  'messages' in body &&
  Array.isArray((body as any).messages) &&
  (body as any).messages.length > 0 &&
  (body as any).messages.every(isChatMessage);

const hasLanguageModelAPI = (): boolean =>
  !!(vscode as any).lm && typeof (vscode as any).lm.selectChatModels === 'function';

// Configuration helpers
const getBridgeConfig = (): BridgeConfig => {
  const cfg = vscode.workspace.getConfiguration('bridge');
  return {
    enabled: cfg.get<boolean>('enabled') ?? false,
    host: cfg.get<string>('host') ?? '127.0.0.1',
    port: cfg.get<number>('port') ?? 0,
    token: (cfg.get<string>('token') ?? '').trim(),
    historyWindow: cfg.get<number>('historyWindow') ?? 3,
    verbose: cfg.get<boolean>('verbose') ?? false,
    maxConcurrent: cfg.get<number>('maxConcurrent') ?? 1,
  };
};

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  state.output = vscode.window.createOutputChannel('Copilot Bridge');
  state.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  state.statusItem.text = 'Copilot Bridge: Disabled';
  state.statusItem.show();
  ctx.subscriptions.push(state.statusItem, state.output);

  ctx.subscriptions.push(vscode.commands.registerCommand('bridge.enable', async () => {
    await startBridge();
    await getModel(true);
  }));
  
  ctx.subscriptions.push(vscode.commands.registerCommand('bridge.disable', async () => {
    await stopBridge();
  }));
  
  ctx.subscriptions.push(vscode.commands.registerCommand('bridge.status', async () => {
    const info = state.server?.address();
    const bound = info && typeof info === 'object' ? `${info.address}:${info.port}` : 'n/a';
    const config = getBridgeConfig();
    const hasToken = config.token.length > 0;
    vscode.window.showInformationMessage(
      `Copilot Bridge: ${state.running ? 'Enabled' : 'Disabled'} | Bound: ${bound} | Token: ${hasToken ? 'Set' : 'None'}`
    );
  }));

  const config = getBridgeConfig();
  if (config.enabled) {
    await startBridge();
  }
}

export async function deactivate(): Promise<void> {
  await stopBridge();
}

async function startBridge(): Promise<void> {
  if (state.running) return;
  state.running = true;

  const config = getBridgeConfig();

  try {
    state.server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
      try {
        if (config.verbose) state.output?.appendLine(`HTTP ${req.method} ${req.url}`);
        
        if (!isAuthorized(req, config.token)) {
          writeErrorResponse(res, 401, 'unauthorized', 'invalid_request_error', 'unauthorized');
          return;
        }
        
        if (req.method === 'POST' && req.url?.startsWith('/v1/chat/completions')) {
          if (state.activeRequests >= config.maxConcurrent) {
            res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '1' });
            res.end(JSON.stringify({ 
              error: { 
                message: 'too many requests', 
                type: 'rate_limit_error', 
                code: 'rate_limit_exceeded' 
              } 
            }));
            if (config.verbose) {
              state.output?.appendLine(`429 throttled (active=${state.activeRequests}, max=${config.maxConcurrent})`);
            }
            return;
          }
        }

        if (req.method === 'GET' && req.url === '/healthz') {
          await handleHealthCheck(res, config.verbose);
          return;
        }

        if (req.method === 'GET' && req.url === '/v1/models') {
          await handleModelsRequest(res);
          return;
        }

        if (req.method === 'POST' && req.url?.startsWith('/v1/chat/completions')) {
          await handleChatCompletion(req, res, config);
          return;
        }

        res.writeHead(404).end();
      } catch (error) {
        handleServerError(error, res);
      }
    });

    await startServer(state.server, config);
    updateStatusAfterStart(config);
  } catch (error) {
    handleStartupError(error, config);
  }
}

// Helper functions
const isAuthorized = (req: http.IncomingMessage, token: string): boolean =>
  !token || req.headers.authorization === `Bearer ${token}`;

const writeErrorResponse = (
  res: http.ServerResponse, 
  status: number, 
  message: string, 
  type: string, 
  code: string,
  reason?: string
): void => {
  writeJson(res, status, { 
    error: { message, type, code, ...(reason && { reason }) } 
  });
};

const handleServerError = (error: unknown, res: http.ServerResponse): void => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;
  
  state.output?.appendLine(`Error: ${errorStack || errorMessage}`);
  state.modelCache = undefined;
  writeErrorResponse(res, 500, errorMessage || 'internal_error', 'server_error', 'internal_error');
};

const handleStartupError = (error: unknown, config: BridgeConfig): never => {
  state.running = false;
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;
  
  state.output?.appendLine(`Failed to start: ${errorStack || errorMessage}`);
  if (state.statusItem) {
    state.statusItem.text = 'Copilot Bridge: Error';
  }
  throw error;
};

const startServer = async (server: http.Server, config: BridgeConfig): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => resolve());
  });
};

const updateStatusAfterStart = (config: BridgeConfig): void => {
  const addr = state.server?.address() as AddressInfo | null;
  const shown = addr ? `${addr.address}:${addr.port}` : `${config.host}:${config.port}`;
  
  if (state.statusItem) {
    state.statusItem.text = `Copilot Bridge: ${state.modelCache ? 'OK' : 'Unavailable'} @ ${shown}`;
  }
  
  state.output?.appendLine(`Started at http://${shown} | Copilot: ${state.modelCache ? 'ok' : 'unavailable'}`);
  
  if (config.verbose) {
    const tokenStatus = config.token ? 'set' : 'unset';
    state.output?.appendLine(
      `Config: host=${config.host} port=${addr?.port ?? config.port} hist=${config.historyWindow} maxConcurrent=${config.maxConcurrent} token=${tokenStatus}`
    );
  }
};

const handleHealthCheck = async (res: http.ServerResponse, verbose: boolean): Promise<void> => {
  const hasLM = hasLanguageModelAPI();
  if (!state.modelCache && verbose) {
    state.output?.appendLine(`Healthz: model=${state.modelCache ? 'present' : 'missing'} lmApi=${hasLM ? 'ok' : 'missing'}`);
    await getModel();
  }
  
  const unavailableReason = state.modelCache 
    ? undefined 
    : (!hasLM ? 'missing_language_model_api' : (state.lastReason || 'copilot_model_unavailable'));
    
  writeJson(res, 200, { 
    ok: true, 
    copilot: state.modelCache ? 'ok' : 'unavailable', 
    reason: unavailableReason, 
    version: vscode.version 
  });
};

const handleModelsRequest = async (res: http.ServerResponse): Promise<void> => {
  try {
    const models = await listCopilotModels();
    writeJson(res, 200, { 
      data: models.map((id: string) => ({ 
        id, 
        object: 'model', 
        owned_by: 'vscode-bridge' 
      })) 
    });
  } catch {
    writeJson(res, 200, { 
      data: [{ 
        id: 'copilot', 
        object: 'model', 
        owned_by: 'vscode-bridge' 
      }] 
    });
  }
};

const handleChatCompletion = async (
  req: http.IncomingMessage, 
  res: http.ServerResponse, 
  config: BridgeConfig
): Promise<void> => {
  state.activeRequests++;
  if (config.verbose) {
    state.output?.appendLine(`Request started (active=${state.activeRequests})`);
  }
  
  try {
    const body = await readJson(req);
    if (!isChatCompletionRequest(body)) {
      writeErrorResponse(res, 400, 'invalid request', 'invalid_request_error', 'invalid_payload');
      return;
    }

    const { model: requestedModel, stream = true } = body;
    const familyOverride = extractModelFamily(requestedModel);
    
    const model = await getModel(false, familyOverride);
    if (!model) {
      const hasLM = hasLanguageModelAPI();
      if (familyOverride && hasLM) {
        state.lastReason = 'not_found';
        writeErrorResponse(res, 404, 'model not found', 'invalid_request_error', 'model_not_found', 'not_found');
        return;
      }
      
      const reason = !hasLM ? 'missing_language_model_api' : (state.lastReason || 'copilot_model_unavailable');
      writeErrorResponse(res, 503, 'Copilot unavailable', 'server_error', 'copilot_unavailable', reason);
      return;
    }

    const lmMessages = normalizeMessagesLM(body.messages, config.historyWindow);
    
    if (config.verbose) {
      state.output?.appendLine(`Sending request to Copilot via Language Model API... ${model.family || model.modelFamily || model.name || 'unknown'}`);
    }
    
    const cts = new vscode.CancellationTokenSource();
    const response = await model.sendRequest(lmMessages, {}, cts.token);

    if (stream) {
      await handleStreamResponse(res, response, config.verbose);
    } else {
      await handleNonStreamResponse(res, response, config.verbose);
    }
  } finally {
    state.activeRequests--;
    if (config.verbose) {
      state.output?.appendLine(`Request complete (active=${state.activeRequests})`);
    }
  }
};

const extractModelFamily = (requestedModel?: string): string | undefined => {
  if (!requestedModel) return undefined;
  
  if (/-copilot$/i.test(requestedModel)) {
    return requestedModel.replace(/-copilot$/i, '');
  }
  
  if (requestedModel.toLowerCase() === 'copilot') {
    return undefined;
  }
  
  return undefined;
};

const handleStreamResponse = async (
  res: http.ServerResponse, 
  response: LanguageModelResponse, 
  verbose: boolean
): Promise<void> => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  const id = `cmp_${Math.random().toString(36).slice(2)}`;
  if (verbose) {
    state.output?.appendLine(`SSE start id=${id}`);
  }
  
  try {
    for await (const fragment of response.text) {
      const payload = {
        id,
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content: fragment } }]
      };
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
    
    if (verbose) {
      state.output?.appendLine(`SSE end id=${id}`);
    }
    
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    throw error;
  }
};

const handleNonStreamResponse = async (
  res: http.ServerResponse, 
  response: LanguageModelResponse, 
  verbose: boolean
): Promise<void> => {
  let content = '';
  for await (const fragment of response.text) {
    content += fragment;
  }
  
  if (verbose) {
    state.output?.appendLine(`Non-stream complete len=${content.length}`);
  }
  
  writeJson(res, 200, {
    id: `cmpl_${Math.random().toString(36).slice(2)}`,
    object: 'chat.completion',
    choices: [{ 
      index: 0, 
      message: { role: 'assistant', content }, 
      finish_reason: 'stop' 
    }]
  });
};

async function stopBridge(): Promise<void> {
  if (!state.running) return;
  state.running = false;
  
  try {
    await new Promise<void>((resolve) => {
      if (!state.server) return resolve();
      state.server.close(() => resolve());
    });
  } finally {
    state.server = undefined;
    state.modelCache = undefined;
    if (state.statusItem) {
      state.statusItem.text = 'Copilot Bridge: Disabled';
    }
    state.output?.appendLine('Stopped');
  }
}

// Text conversion utility
const toText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(toText).join('\n');
  if (content && typeof content === 'object' && 'text' in content && typeof (content as any).text === 'string') {
    return (content as any).text;
  }
  try { 
    return JSON.stringify(content); 
  } catch { 
    return String(content); 
  }
};

const normalizeMessagesLM = (messages: ChatMessage[], histWindow: number): unknown[] => {
  const systemMessages = messages.filter((m) => m.role === 'system');
  const systemMessage = systemMessages[systemMessages.length - 1]; // Take the last system message
  const conversationMessages = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-histWindow * 2);

  const vsCode = vscode as any;
  const User = vsCode.LanguageModelChatMessage?.User;
  const Assistant = vsCode.LanguageModelChatMessage?.Assistant;

  const result: unknown[] = [];
  let firstUserSeen = false;

  for (const message of conversationMessages) {
    if (message.role === 'user') {
      let text = toText(message.content);
      if (!firstUserSeen && systemMessage) {
        text = `[SYSTEM]\n${toText(systemMessage.content)}\n\n[DIALOG]\nuser: ${text}`;
        firstUserSeen = true;
      }
      result.push(User ? User(text) : { role: 'user', content: text });
    } else if (message.role === 'assistant') {
      const text = toText(message.content);
      result.push(Assistant ? Assistant(text) : { role: 'assistant', content: text });
    }
  }

  if (!firstUserSeen && systemMessage) {
    const text = `[SYSTEM]\n${toText(systemMessage.content)}`;
    result.unshift(User ? User(text) : { role: 'user', content: text });
  }

  if (result.length === 0) {
    result.push(User ? User('') : { role: 'user', content: '' });
  }

  return result;
};

async function getModel(force = false, family?: string): Promise<LanguageModel | undefined> {
  if (!force && state.modelCache && !family) return state.modelCache;
  
  const config = getBridgeConfig();
  const hasLM = hasLanguageModelAPI();
  
  if (!hasLM) {
    if (!family) state.modelCache = undefined;
    state.lastReason = 'missing_language_model_api';
    updateStatusWithError();
    if (config.verbose) {
      state.output?.appendLine('VS Code Language Model API not available; update VS Code or enable proposed API (Insiders/F5/--enable-proposed-api).');
    }
    return undefined;
  }

  try {
    const models = await selectChatModels(family);
    if (!models || models.length === 0) {
      if (!family) state.modelCache = undefined;
      state.lastReason = family ? 'not_found' : 'copilot_model_unavailable';
      updateStatusWithError();
      if (config.verbose) {
        const message = family 
          ? `No Copilot language models available for family="${family}".`
          : 'No Copilot language models available.';
        state.output?.appendLine(message);
      }
      return undefined;
    }
    
    const chosen = models[0];
    if (!family) state.modelCache = chosen;
    state.lastReason = undefined;
    updateStatusWithSuccess();
    if (config.verbose) {
      const familyInfo = family ? ` (family=${family})` : '';
      state.output?.appendLine(`Copilot model selected${familyInfo}.`);
    }
    return chosen;
  } catch (error) {
    if (!family) state.modelCache = undefined;
    updateStatusWithError();
    handleModelSelectionError(error, family, config.verbose);
    return undefined;
  }
}

const selectChatModels = async (family?: string): Promise<LanguageModel[]> => {
  const lm = (vscode as any).lm;
  if (family) {
    return await lm.selectChatModels({ vendor: 'copilot', family });
  } else {
    // Try gpt-4o first, fallback to any copilot model
    let models = await lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
    state.output?.appendLine(`Fallback to gpt-4o. Family requested was: ${family}.`);

    if (!models || models.length === 0) {
      models = await lm.selectChatModels({ vendor: 'copilot' });
    }
    return models;
  }
};

const updateStatusWithError = (): void => {
  const info = state.server?.address() as AddressInfo | null;
  const bound = info ? `${info.address}:${info.port}` : '';
  if (state.statusItem) {
    state.statusItem.text = `Copilot Bridge: Unavailable ${bound ? `@ ${bound}` : ''}`;
  }
};

const updateStatusWithSuccess = (): void => {
  const info = state.server?.address() as AddressInfo | null;
  const bound = info ? `${info.address}:${info.port}` : '';
  if (state.statusItem) {
    state.statusItem.text = `Copilot Bridge: OK ${bound ? `@ ${bound}` : ''}`;
  }
};

const handleModelSelectionError = (error: unknown, family: string | undefined, verbose: boolean): void => {
  const vsCode = vscode as any;
  
  if (vsCode.LanguageModelError && error instanceof vsCode.LanguageModelError) {
    const code = (error as any).code || '';
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (/consent/i.test(errorMessage) || code === 'UserNotSignedIn') {
      state.lastReason = 'consent_required';
    } else if (code === 'RateLimited') {
      state.lastReason = 'rate_limited';
    } else if (code === 'NotFound') {
      state.lastReason = 'not_found';
    } else {
      state.lastReason = 'copilot_unavailable';
    }
    
    if (verbose) {
      const familyInfo = family ? ` family=${family}` : '';
      state.output?.appendLine(`LM select error: ${errorMessage} code=${code}${familyInfo}`);
    }
  } else {
    state.lastReason = 'copilot_unavailable';
    if (verbose) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const familyInfo = family ? ` family=${family}` : '';
      state.output?.appendLine(`LM select error: ${errorMessage}${familyInfo}`);
    }
  }
};

async function listCopilotModels(): Promise<string[]> {
  const hasLM = hasLanguageModelAPI();
  if (!hasLM) return ['copilot'];
  
  try {
    const models: LanguageModel[] = await (vscode as any).lm.selectChatModels({ vendor: 'copilot' });
    if (!models || models.length === 0) return ['copilot'];
    
    const ids = models.map((model, index) => {
      const family = model.family || model.modelFamily || model.name || '';
      const normalized = typeof family === 'string' && family.trim() 
        ? family.trim().toLowerCase() 
        : `copilot-${index + 1}`;
      return normalized.endsWith('-copilot') ? normalized : `${normalized}-copilot`;
    });
    
    return Array.from(new Set(ids));
  } catch {
    return ['copilot'];
  }
}

const readJson = (req: http.IncomingMessage): Promise<unknown> => {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: any) => { 
      data += chunk.toString(); 
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        const snippet = data.length > 200 ? data.slice(0, 200) + '...' : data;
        const errorMessage = error instanceof Error ? error.message : String(error);
        reject(new Error(`Failed to parse JSON: ${errorMessage}. Data: "${snippet}"`));
      }
    });
    req.on('error', reject);
  });
};

const writeJson = (res: http.ServerResponse, status: number, obj: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};
