import type {
  RepoProvider,
  RepoCredential,
  RepoList,
  RepoValidation,
  SessionRepoEnv,
} from '@valet/sdk/repos';
import { githubFetch } from './actions/api.js';

// ─── GitHub App JWT and Token Minting ──────────────────────────────────────

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function base64url(data: ArrayBuffer | Uint8Array | string): string {
  let b64: string;
  if (typeof data === 'string') {
    b64 = btoa(data);
  } else {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    b64 = btoa(String.fromCharCode(...bytes));
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function mintInstallationToken(
  installationId: string,
  appId: string,
  privateKey: string,
): Promise<{ token: string; expiresAt: string }> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId }));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  const jwt = `${header}.${payload}.${base64url(signature)}`;

  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Valet',
      },
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to mint installation token: ${res.status}`);
  }

  const data = (await res.json()) as { token: string; expires_at: string };
  return { token: data.token, expiresAt: data.expires_at };
}

function mapGitHubRepo(r: any) {
  return {
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    url: r.html_url,
    cloneUrl: r.clone_url,
    defaultBranch: r.default_branch,
    private: r.private,
    description: r.description ?? null,
    updatedAt: r.updated_at,
    language: r.language ?? null,
  };
}

// ─── GitHub Repo Provider ──────────────────────────────────────────────────

export const githubRepoProvider: RepoProvider = {
  id: 'github',
  displayName: 'GitHub',
  icon: 'github',
  supportsOrgLevel: true,
  supportsPersonalLevel: true,
  urlPatterns: [/github\.com/],

  async listRepos(credential: RepoCredential, opts?) {
    if (!credential.accessToken) {
      throw new Error('GitHub repo listing requires an access token — mint a token first');
    }
    const token = credential.accessToken;
    const page = opts?.page || 1;
    const search = opts?.search;

    if (search) {
      const res = await githubFetch(
        `/search/repositories?q=${encodeURIComponent(search)}+in:name&per_page=30&page=${page}`,
        token,
      );
      const data = (await res.json()) as { items: any[]; total_count: number };
      return {
        repos: data.items.map(mapGitHubRepo),
        hasMore: data.total_count > page * 30,
      };
    }

    const res = await githubFetch(
      `/installation/repositories?per_page=30&page=${page}`,
      token,
    );
    const data = (await res.json()) as { repositories: any[]; total_count: number };
    return {
      repos: data.repositories.map(mapGitHubRepo),
      hasMore: data.total_count > page * 30,
    };
  },

  async validateRepo(credential: RepoCredential, repoUrl: string) {
    const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (!match) return { accessible: false, error: 'Invalid GitHub URL' };
    const [, owner, repo] = match;
    if (!credential.accessToken) {
      return { accessible: false, error: 'No access token available — mint a token first' };
    }
    const res = await githubFetch(`/repos/${owner}/${repo}`, credential.accessToken);
    if (!res.ok) return { accessible: false, error: `Repository not accessible: ${res.status}` };
    const data = (await res.json()) as {
      full_name: string;
      default_branch: string;
      private: boolean;
      clone_url: string;
      permissions?: { push: boolean; pull: boolean; admin: boolean };
    };
    return {
      accessible: true,
      permissions: data.permissions || { push: false, pull: true, admin: false },
      fullName: data.full_name,
      defaultBranch: data.default_branch,
      private: data.private,
      cloneUrl: data.clone_url,
    };
  },

  async assembleSessionEnv(credential: RepoCredential, opts) {
    return {
      envVars: {
        REPO_URL: opts.repoUrl,
        ...(opts.branch ? { REPO_BRANCH: opts.branch } : {}),
        ...(opts.ref ? { REPO_REF: opts.ref } : {}),
      },
      gitConfig: {
        'user.name': opts.gitUser.name,
        'user.email': opts.gitUser.email,
      },
    };
  },

  async mintToken(credential: RepoCredential) {
    // OAuth tokens don't need minting — return as-is
    if (credential.type === 'token' && credential.accessToken) {
      return { accessToken: credential.accessToken, expiresAt: credential.expiresAt };
    }
    if (!credential.installationId) {
      throw new Error('Cannot mint token without installationId');
    }
    // appId and privateKey are stored encrypted in the credential data
    const appId = credential.metadata?.appId || credential.metadata?.app_id;
    const privateKey = credential.metadata?.privateKey || credential.metadata?.private_key;
    if (!appId || !privateKey) {
      throw new Error(
        'GitHub App credentials (appId, privateKey) not found in credential',
      );
    }
    const result = await mintInstallationToken(
      credential.installationId,
      appId,
      privateKey,
    );
    return { accessToken: result.token, expiresAt: result.expiresAt };
  },
};
