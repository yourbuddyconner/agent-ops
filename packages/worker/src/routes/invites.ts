import { Hono } from 'hono';
import type { Env, Variables } from '../env.js';
import { getInviteByCode, getInviteByCodeAny, getOrgSettings } from '../lib/db.js';
import { NotFoundError } from '@agent-ops/shared';

export const invitesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /invites/:code — Public endpoint to validate an invite code
 * Returns invite info (role, org name) for the invite landing page
 */
invitesRouter.get('/:code', async (c) => {
  const code = c.req.param('code');

  const invite = await getInviteByCodeAny(c.env.DB, code);
  if (!invite) {
    throw new NotFoundError('Invite not found');
  }

  const isExpired = new Date(invite.expiresAt) < new Date();
  const isAccepted = !!invite.acceptedAt;

  const orgSettings = await getOrgSettings(c.env.DB);

  return c.json({
    code: invite.code,
    role: invite.role,
    orgName: orgSettings.name,
    status: isAccepted ? 'accepted' : isExpired ? 'expired' : 'valid',
  });
});
