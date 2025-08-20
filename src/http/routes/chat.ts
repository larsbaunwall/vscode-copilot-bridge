import * as vscode from 'vscode';
import type { IncomingMessage, ServerResponse } from 'http';
import { state } from '../../state';
import { getBridgeConfig } from '../../config';
import { isChatCompletionRequest, normalizeMessagesLM } from '../../messages';
import { getModel, hasLMApi } from '../../models';
import { readJson, writeErrorResponse, writeJson } from '../utils';
import { verbose } from '../../log';

export const handleChatCompletion = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const config = getBridgeConfig();
  state.activeRequests++;
  verbose(`Request started (active=${state.activeRequests})`);

  try {
    const body = await readJson(req);
    if (!isChatCompletionRequest(body)) {
      return writeErrorResponse(res, 400, 'invalid request', 'invalid_request_error', 'invalid_payload');
    }

    const requestedModel = body.model;
    const stream = body.stream !== false; // default true
    const model = await getModel(false, requestedModel);

    if (!model) {
      const hasLM = hasLMApi();
      if (requestedModel && hasLM) {
        state.lastReason = 'not_found';
        return writeErrorResponse(res, 404, 'model not found', 'invalid_request_error', 'model_not_found', 'not_found');
      }
      const reason = !hasLM ? 'missing_language_model_api' : (state.lastReason || 'copilot_model_unavailable');
      return writeErrorResponse(res, 503, 'Copilot unavailable', 'server_error', 'copilot_unavailable', reason);
    }

    const lmMessages = normalizeMessagesLM(body.messages, config.historyWindow) as vscode.LanguageModelChatMessage[];
    verbose(`LM request via API model=${model.family || model.id || model.name || 'unknown'}`);

    const cts = new vscode.CancellationTokenSource();
    const response = await model.sendRequest(lmMessages, {}, cts.token);
    await sendResponse(res, response, stream);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeErrorResponse(res, 500, msg || 'internal_error', 'server_error', 'internal_error');
  } finally {
    state.activeRequests--;
    verbose(`Request complete (active=${state.activeRequests})`);
  }
};

const sendResponse = async (res: ServerResponse, response: vscode.LanguageModelChatResponse, stream: boolean): Promise<void> => {
  if (stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    const id = `cmp_${Math.random().toString(36).slice(2)}`;
    verbose(`SSE start id=${id}`);
    for await (const fragment of response.text) {
      res.write(`data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content: fragment } }],
      })}\n\n`);
    }
    verbose(`SSE end id=${id}`);
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  let content = '';
  for await (const fragment of response.text) content += fragment;
  verbose(`Non-stream complete len=${content.length}`);
  writeJson(res, 200, {
    id: `cmpl_${Math.random().toString(36).slice(2)}`,
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
  });
};
