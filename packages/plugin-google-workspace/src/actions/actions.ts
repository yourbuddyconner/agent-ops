import type { ActionSource } from '@valet/sdk';

// Placeholder — action implementations will be added in a subsequent task.
export const googleWorkspaceActions: ActionSource = {
  listActions: () => [],
  execute: async (_actionId, _params, _ctx) => ({
    success: false,
    error: 'Not yet implemented',
  }),
};
