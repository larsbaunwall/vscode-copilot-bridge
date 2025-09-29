import { writeJson, writeErrorResponse } from '../utils';
import { listCopilotModels } from '../../models';
import { verbose } from '../../log';
import type { ServerResponse } from 'http';

interface ModelObject {
  readonly id: string;
  readonly object: 'model';
  readonly created: number;
  readonly owned_by: string;
  readonly permission: readonly unknown[];
  readonly root: string;
  readonly parent: null;
}

interface ModelsListResponse {
  readonly object: 'list';
  readonly data: readonly ModelObject[];
}

export const handleModelsRequest = async (res: ServerResponse): Promise<void> => {
  try {
    const modelIds = await listCopilotModels();
    verbose(`Models listed: ${modelIds.length} available`);
    
    const models: ModelObject[] = modelIds.map((id: string) => ({
      id,
      object: 'model' as const,
      created: Math.floor(Date.now() / 1000),
      owned_by: 'copilot',
      permission: [],
      root: id,
      parent: null,
    }));

    const response: ModelsListResponse = {
      object: 'list',
      data: models,
    };
    
    writeJson(res, 200, response);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    verbose(`Models request failed: ${msg}`);
    writeErrorResponse(res, 500, msg || 'Failed to list models', 'server_error', 'internal_error');
  }
};
