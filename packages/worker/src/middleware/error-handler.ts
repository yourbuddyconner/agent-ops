import type { ErrorHandler } from 'hono';
import { AgentOpsError, ErrorCodes } from '@agent-ops/shared';
import type { Env, Variables } from '../env.js';

export const errorHandler: ErrorHandler<{ Bindings: Env; Variables: Variables }> = (err, c) => {
  const requestId = c.get('requestId');

  if (err instanceof AgentOpsError) {
    console.error(`[${requestId}] ${err.code}: ${err.message}`, err.details);
    return c.json(err.toJSON(), err.statusCode as any);
  }

  // Log unexpected errors
  console.error(`[${requestId}] Unexpected error:`, err);

  return c.json(
    {
      error: 'Internal server error',
      code: ErrorCodes.INTERNAL_ERROR,
      requestId,
    },
    500
  );
};
