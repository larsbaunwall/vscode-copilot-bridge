import * as vscode from 'vscode';
import { state } from './state';
import { updateStatus } from './status';
import { verbose } from './log';

// VS Code Language Model API (see selectChatModels docs in latest VS Code API reference)
const hasLanguageModelAPI = (): boolean => typeof vscode.lm?.selectChatModels === 'function';

export const selectChatModels = async (family?: string): Promise<vscode.LanguageModelChat[]> => {
  const selector: vscode.LanguageModelChatSelector | undefined = family ? { family } : undefined;
  return vscode.lm.selectChatModels(selector);
};

export const getModel = async (force = false, family?: string): Promise<vscode.LanguageModelChat | undefined> => {
  if (!force && state.modelCache && !family) return state.modelCache;

  // Mark that we've attempted at least one model fetch (affects status bar messaging)
  state.modelAttempted = true;

  const hasLM = hasLanguageModelAPI();

  if (!hasLM) {
    if (!family) state.modelCache = undefined;
    state.lastReason = 'missing_language_model_api';
    updateStatus('error');
    verbose('VS Code Language Model API not available; update VS Code or enable proposed API (Insiders/F5/--enable-proposed-api).');
    return undefined;
  }

  try {
    // Prefer selecting by vendor 'copilot' if no family specified to reduce unrelated models
    const models: vscode.LanguageModelChat[] = family
      ? await selectChatModels(family)
      : await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (models.length === 0) {
      if (!family) state.modelCache = undefined;
      state.lastReason = family ? 'not_found' : 'copilot_model_unavailable';
      updateStatus('error');
      verbose(family ? `no models for family ${family}` : 'no copilot models available');
      return undefined;
    }
    state.modelCache = models[0]; // keep first for now; future: choose by quality or family preference
    state.lastReason = undefined;
    updateStatus('success');
    return state.modelCache;
  } catch (e: unknown) {
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
  updateStatus('error');
  const fam = family ? ` family=${family}` : '';
  verbose(`Model selection failed: ${msg}${fam}`);
};

export const listCopilotModels = async (): Promise<string[]> => {
  try {
    const models = await selectChatModels();
    const ids = models.map((m: vscode.LanguageModelChat) => {
      const normalized = m.family || m.id || m.name || 'copilot';
      return `${normalized}`;
    });
    return ids.length ? ids : ['copilot'];
  } catch {
    return ['copilot'];
  }
};

export const hasLMApi = hasLanguageModelAPI;
