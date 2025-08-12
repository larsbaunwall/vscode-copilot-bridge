import { writeJson } from '../utils';
import { listCopilotModels } from '../../models';

export const handleModelsRequest = async (res: any): Promise<void> => {
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
      data: [
        {
          id: 'copilot',
          object: 'model',
          owned_by: 'vscode-bridge',
        },
      ],
    });
  }
};
