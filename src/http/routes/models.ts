import { writeJson } from '../utils';
import { listCopilotModels } from '../../models';
import type { ServerResponse } from 'http';

export const handleModelsRequest = async (res: ServerResponse): Promise<void> => {
  try {
    const modelIds = await listCopilotModels();
    const models = modelIds.map((id: string) => ({
      id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'copilot',
      permission: [],
      root: id,
      parent: null,
    }));

    writeJson(res, 200, {
      object: 'list',
      data: models,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeJson(res, 500, {
      error: {
        message: msg || 'Failed to list models',
        type: 'server_error',
        code: 'internal_error'
      }
    });
  }
};
