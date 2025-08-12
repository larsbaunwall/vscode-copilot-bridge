import * as vscode from 'vscode';
import type { ServerResponse } from 'http';
import { writeJson } from '../utils';
import { hasLMApi, getModel } from '../../models';
import { state } from '../../state';
import { verbose } from '../../log';

export const handleHealthCheck = async (res: ServerResponse, v: boolean): Promise<void> => {
  const hasLM = hasLMApi();
  if (!state.modelCache && v) {
    verbose(`Healthz: model=${state.modelCache ? 'present' : 'missing'} lmApi=${hasLM ? 'ok' : 'missing'}`);
    await getModel();
  }
  const unavailableReason = state.modelCache
    ? undefined
    : (!hasLM ? 'missing_language_model_api' : (state.lastReason || 'copilot_model_unavailable'));
  writeJson(res, 200, {
    ok: true,
    copilot: state.modelCache ? 'ok' : 'unavailable',
    reason: unavailableReason,
    version: vscode.version,
  });
};
