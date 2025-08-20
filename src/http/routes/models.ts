import { writeJson } from '../utils';
import { listCopilotModels } from '../../models';
import type { ServerResponse } from 'http';

export const handleModelsRequest = async (res: ServerResponse): Promise<void> => {
  try {
    const models = await listCopilotModels();
    writeJson(res, 200, {
      data: models.map((id: string) => ({
        id,
        object: 'model',
        owned_by: 'vscode-bridge',
      })),
    });
  } catch {
    writeJson(res, 200, {
      data: [],
    });
  }
};
