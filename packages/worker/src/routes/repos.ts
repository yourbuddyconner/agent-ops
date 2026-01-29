import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { NotFoundError, ValidationError } from '@agent-ops/shared';
import type { Env, Variables } from '../env.js';
import * as db from '../lib/db.js';
import { decryptString } from '../lib/crypto.js';

export const reposRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Get the user's decrypted GitHub access token. Throws if not connected.
 */
async function getGitHubToken(env: Env, userId: string): Promise<string> {
  const oauthToken = await db.getOAuthToken(env.DB, userId, 'github');
  if (!oauthToken) {
    throw new ValidationError('GitHub account not connected');
  }
  return decryptString(oauthToken.encryptedAccessToken, env.ENCRYPTION_KEY);
}

/**
 * GET /api/repos
 * List the authenticated user's GitHub repositories
 */
reposRouter.get('/', async (c) => {
  const user = c.get('user');
  const page = parseInt(c.req.query('page') || '1');
  const perPage = parseInt(c.req.query('per_page') || '30');
  const sort = c.req.query('sort') || 'updated';

  const token = await getGitHubToken(c.env, user.id);

  const res = await fetch(
    `https://api.github.com/user/repos?sort=${sort}&per_page=${perPage}&page=${page}&type=all`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Agent-Ops',
      },
    },
  );

  if (!res.ok) {
    const err = await res.text();
    console.error('GitHub repos fetch failed:', res.status, err);
    return c.json({ error: 'Failed to fetch repositories' }, 502);
  }

  const repos = (await res.json()) as Array<{
    id: number;
    name: string;
    full_name: string;
    private: boolean;
    description: string | null;
    html_url: string;
    clone_url: string;
    default_branch: string;
    updated_at: string;
    language: string | null;
  }>;

  return c.json({
    repos: repos.map((r) => ({
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      private: r.private,
      description: r.description,
      url: r.html_url,
      cloneUrl: r.clone_url,
      defaultBranch: r.default_branch,
      updatedAt: r.updated_at,
      language: r.language,
    })),
    page,
    perPage,
  });
});

/**
 * GET /api/repos/validate
 * Validate the user has access to a given repo URL
 */
reposRouter.get('/validate', async (c) => {
  const user = c.get('user');
  const url = c.req.query('url');

  if (!url) {
    throw new ValidationError('Missing url parameter');
  }

  // Extract owner/repo from GitHub URL
  const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!match) {
    return c.json({ valid: false, error: 'Not a valid GitHub repository URL' });
  }

  const [, owner, repo] = match;
  const token = await getGitHubToken(c.env, user.id);

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Agent-Ops',
    },
  });

  if (res.status === 404) {
    return c.json({ valid: false, error: 'Repository not found or not accessible' });
  }

  if (!res.ok) {
    return c.json({ valid: false, error: 'Failed to validate repository' });
  }

  const repoData = (await res.json()) as {
    full_name: string;
    default_branch: string;
    private: boolean;
    permissions: { push: boolean };
    clone_url: string;
  };

  return c.json({
    valid: true,
    repo: {
      fullName: repoData.full_name,
      defaultBranch: repoData.default_branch,
      private: repoData.private,
      canPush: repoData.permissions?.push ?? false,
      cloneUrl: repoData.clone_url,
    },
  });
});

const createPRSchema = z.object({
  branch: z.string().min(1),
  title: z.string().min(1).max(256),
  body: z.string().optional(),
  base: z.string().optional(),
});

/**
 * POST /api/repos/pull-request
 * Create a pull request on GitHub for a given repo.
 * The session's repo URL is used to determine owner/repo.
 */
reposRouter.post('/pull-request', zValidator('json', createPRSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const repoUrl = c.req.query('repo');
  if (!repoUrl) {
    throw new ValidationError('Missing repo query parameter');
  }

  const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!match) {
    throw new ValidationError('Invalid GitHub repository URL');
  }

  const [, owner, repo] = match;
  const token = await getGitHubToken(c.env, user.id);

  // Determine base branch if not provided
  let baseBranch = body.base;
  if (!baseBranch) {
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Agent-Ops',
      },
    });
    if (repoRes.ok) {
      const repoData = (await repoRes.json()) as { default_branch: string };
      baseBranch = repoData.default_branch;
    } else {
      baseBranch = 'main';
    }
  }

  const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Agent-Ops',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: body.title,
      body: body.body || '',
      head: body.branch,
      base: baseBranch,
    }),
  });

  if (!prRes.ok) {
    const err = await prRes.text();
    console.error('GitHub PR creation failed:', prRes.status, err);
    return c.json({ error: 'Failed to create pull request', details: err }, 502);
  }

  const pr = (await prRes.json()) as {
    number: number;
    html_url: string;
    title: string;
    state: string;
  };

  return c.json({
    pr: {
      number: pr.number,
      url: pr.html_url,
      title: pr.title,
      state: pr.state,
    },
  });
});
