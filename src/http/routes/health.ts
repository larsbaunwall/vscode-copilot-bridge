import * as vscode from 'vscode';
import type { ServerResponse } from 'http';
import { writeJson } from '../utils';
import { hasLMApi, getModel } from '../../models';
import { state } from '../../state';
import { verbose } from '../../log';

interface HealthResponse {
  readonly ok: boolean;
  readonly status: string;
  readonly copilot: string;
  readonly reason?: string;
  readonly version: string;
  readonly features: {
    readonly chat_completions: boolean;
    readonly streaming: boolean;
    readonly tool_calling: boolean;
    readonly function_calling: boolean;
    readonly models_list: boolean;
  };
  readonly active_requests: number;
  readonly model_attempted?: boolean;
}

export const handleHealthCheck = async (res: ServerResponse, v: boolean): Promise<void> => {
  const hasLM = hasLMApi();
  
  // Attempt model resolution if cache is empty and verbose logging is enabled
  if (!state.modelCache && v) {
    verbose(`Healthz: model=${state.modelCache ? 'present' : 'missing'} lmApi=${hasLM ? 'ok' : 'missing'}`);
    try {
      await getModel();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      verbose(`Health check model resolution failed: ${msg}`);
    }
  }
  
  const unavailableReason = state.modelCache
    ? undefined
    : (!hasLM ? 'missing_language_model_api' : (state.lastReason || 'copilot_model_unavailable'));
  
  const response: HealthResponse = {
    ok: true,
    status: 'operational',
    copilot: state.modelCache ? 'ok' : 'unavailable',
    reason: unavailableReason,
    version: vscode.version,
    features: {
      chat_completions: true,
      streaming: true,
      tool_calling: true,
      function_calling: true, // deprecated but supported
      models_list: true
    },
    active_requests: state.activeRequests,
    model_attempted: state.modelAttempted
  };
  
  writeJson(res, 200, response);
};
