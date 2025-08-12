import * as vscode from 'vscode';
import type { IncomingMessage, ServerResponse } from 'http';
import { state } from '../../state';
import { getBridgeConfig } from '../../config';
import { extractModelFamily, isChatCompletionRequest, normalizeMessagesLM } from '../../messages';
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
      writeErrorResponse(res, 400, 'invalid request', 'invalid_request_error', 'invalid_payload');
      return;
    }
    const { model: requestedModel, stream = true } = body;
    const familyOverride = extractModelFamily(requestedModel);
    const model = await getModel(false, familyOverride);
    if (!model) {
      const hasLM = hasLMApi();
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
    verbose(`Sending request to Copilot via Language Model API... ${model.family || model.modelFamily || model.name || 'unknown'}`);
    const cts = new vscode.CancellationTokenSource();
    const response = await model.sendRequest(lmMessages, {}, cts.token);
    if (stream) {
      await handleStreamResponse(res, response);
    } else {
      await handleNonStreamResponse(res, response);
    }
  } finally {
    state.activeRequests--;
    verbose(`Request complete (active=${state.activeRequests})`);
  }
};

const handleStreamResponse = async (res: ServerResponse, response: any): Promise<void> => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  const id = `cmp_${Math.random().toString(36).slice(2)}`;
  verbose(`SSE start id=${id}`);
  for await (const fragment of response.text) {
    const payload = {
      id,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { content: fragment } }],
    };
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
  verbose(`SSE end id=${id}`);
  res.write('data: [DONE]\n\n');
  res.end();
};

const handleNonStreamResponse = async (res: ServerResponse, response: any): Promise<void> => {
  let content = '';
  for await (const fragment of response.text) {
    content += fragment;
  }
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
