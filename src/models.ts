import * as vscode from 'vscode';
import { state, LanguageModel } from './state';
import { updateStatusWithError, updateStatusWithSuccess } from './status';
import { verbose } from './log';

const hasLanguageModelAPI = (): boolean =>
  !!(vscode as any).lm && typeof (vscode as any).lm.selectChatModels === 'function';

export const selectChatModels = async (family?: string): Promise<LanguageModel[]> => {
  const lm = (vscode as any).lm;
  const selector = family ? { family } : undefined;
  const models = await lm.selectChatModels(selector);
  return models as unknown as LanguageModel[];
};

export const getModel = async (force = false, family?: string): Promise<LanguageModel | undefined> => {
  if (!force && state.modelCache && !family) return state.modelCache;

  const hasLM = hasLanguageModelAPI();

  if (!hasLM) {
    if (!family) state.modelCache = undefined;
    state.lastReason = 'missing_language_model_api';
    updateStatusWithError();
    verbose('VS Code Language Model API not available; update VS Code or enable proposed API (Insiders/F5/--enable-proposed-api).');
    return undefined;
  }

  try {
    const models = await selectChatModels(family);
    if (!models || models.length === 0) {
      if (!family) state.modelCache = undefined;
      state.lastReason = family ? 'not_found' : 'copilot_model_unavailable';
      updateStatusWithError();
      const m = family ? `no models for family ${family}` : 'no copilot models available';
      verbose(m);
      return undefined;
    }
    state.modelCache = models[0];
    state.lastReason = undefined;
    updateStatusWithSuccess();
    return state.modelCache;
  } catch (e: any) {
    handleModelSelectionError(e, family);
    return undefined;
  }
};

export const handleModelSelectionError = (error: unknown, family?: string): void => {
  const msg = error instanceof Error ? error.message : String(error);
  if (/not found/i.test(msg) || /Unknown model family/i.test(msg)) {
    state.lastReason = 'not_found';
  } else if (/No chat models/i.test(msg)) {
    state.lastReason = 'copilot_model_unavailable';
  } else {
    state.lastReason = 'copilot_model_unavailable';
  }
  updateStatusWithError();
  const fam = family ? ` family=${family}` : '';
  verbose(`Model selection failed: ${msg}${fam}`);
};

export const listCopilotModels = async (): Promise<string[]> => {
  try {
    const models = await selectChatModels();
    const ids = models.map((m: any) => {
      const normalized = m.family || m.modelFamily || m.name || 'copilot';
      return `${normalized}-copilot`;
    });
    return ids.length ? ids : ['copilot'];
  } catch {
    return ['copilot'];
  }
};

export const hasLMApi = hasLanguageModelAPI;
