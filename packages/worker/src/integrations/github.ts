import type { SyncResult, GitHub } from '@agent-ops/shared';
import { BaseIntegration, type SyncOptions, type IntegrationCredentials, integrationRegistry } from './base.js';

const GITHUB_API = 'https://api.github.com';

interface GitHubApiRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  html_url: string;
  default_branch: string;
}

interface GitHubApiIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
  created_at: string;
  updated_at: string;
}

interface GitHubApiPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  merged_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * GitHub integration for syncing repositories, issues, and pull requests.
 *
 * Supports:
 * - OAuth App authentication
 * - Personal Access Token authentication
 * - Webhook events
 */
export class GitHubIntegration extends BaseIntegration {
  readonly service = 'github' as const;
  readonly supportedEntities = ['repositories', 'issues', 'pull_requests', 'commits'];

  private get token(): string {
    return this.credentials.access_token || this.credentials.token || '';
  }

  validateCredentials(): boolean {
    return !!this.token;
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await this.githubFetch('/user');
      return res.ok;
    } catch {
      return false;
    }
  }

  async sync(options: SyncOptions): Promise<SyncResult> {
    if (!this.validateCredentials()) {
      return this.failedResult([this.syncError('auth', 'Invalid credentials', 'INVALID_CREDENTIALS')]);
    }

    const entities = options.entities || this.supportedEntities;
    let totalSynced = 0;
    const errors: SyncResult['errors'] = [];

    // Sync repositories first (needed for issues/PRs)
    if (entities.includes('repositories')) {
      const result = await this.syncRepositories(options);
      totalSynced += result.recordsSynced;
      errors.push(...result.errors);
    }

    // Sync issues
    if (entities.includes('issues')) {
      const result = await this.syncIssues(options);
      totalSynced += result.recordsSynced;
      errors.push(...result.errors);
    }

    // Sync pull requests
    if (entities.includes('pull_requests')) {
      const result = await this.syncPullRequests(options);
      totalSynced += result.recordsSynced;
      errors.push(...result.errors);
    }

    return {
      success: errors.length === 0,
      recordsSynced: totalSynced,
      errors,
      completedAt: new Date(),
    };
  }

  private async syncRepositories(options: SyncOptions): Promise<SyncResult> {
    const repos: GitHub.Repository[] = [];
    let page = 1;
    const perPage = 100;

    try {
      while (true) {
        const res = await this.githubFetch(`/user/repos?per_page=${perPage}&page=${page}&sort=updated`);
        if (!res.ok) {
          return this.failedResult([
            this.syncError('repositories', `Failed to fetch repos: ${res.status}`, 'FETCH_FAILED'),
          ]);
        }

        const data = await res.json<GitHubApiRepo[]>();
        if (data.length === 0) break;

        for (const repo of data) {
          repos.push({
            id: repo.id,
            name: repo.name,
            fullName: repo.full_name,
            private: repo.private,
            description: repo.description,
            url: repo.html_url,
            defaultBranch: repo.default_branch,
          });
        }

        if (data.length < perPage) break;
        page++;
      }

      return this.successResult(repos.length);
    } catch (error) {
      return this.failedResult([
        this.syncError('repositories', String(error), 'SYNC_ERROR'),
      ]);
    }
  }

  private async syncIssues(options: SyncOptions): Promise<SyncResult> {
    const issues: GitHub.Issue[] = [];

    try {
      // Get user's repos first
      const reposRes = await this.githubFetch('/user/repos?per_page=100&sort=updated');
      if (!reposRes.ok) {
        return this.failedResult([
          this.syncError('issues', 'Failed to fetch repos', 'FETCH_FAILED'),
        ]);
      }

      const repos = await reposRes.json<GitHubApiRepo[]>();

      // Fetch issues from each repo (limit to most recently updated)
      for (const repo of repos.slice(0, 10)) {
        const issuesRes = await this.githubFetch(
          `/repos/${repo.full_name}/issues?state=all&per_page=50&sort=updated`
        );

        if (issuesRes.ok) {
          const repoIssues = await issuesRes.json<GitHubApiIssue[]>();
          for (const issue of repoIssues) {
            // Skip pull requests (they appear in issues endpoint too)
            if ('pull_request' in issue) continue;

            issues.push({
              id: issue.id,
              number: issue.number,
              title: issue.title,
              body: issue.body,
              state: issue.state,
              labels: issue.labels.map((l) => l.name),
              assignees: issue.assignees.map((a) => a.login),
              createdAt: new Date(issue.created_at),
              updatedAt: new Date(issue.updated_at),
            });
          }
        }
      }

      return this.successResult(issues.length);
    } catch (error) {
      return this.failedResult([
        this.syncError('issues', String(error), 'SYNC_ERROR'),
      ]);
    }
  }

  private async syncPullRequests(options: SyncOptions): Promise<SyncResult> {
    const pullRequests: GitHub.PullRequest[] = [];

    try {
      const reposRes = await this.githubFetch('/user/repos?per_page=100&sort=updated');
      if (!reposRes.ok) {
        return this.failedResult([
          this.syncError('pull_requests', 'Failed to fetch repos', 'FETCH_FAILED'),
        ]);
      }

      const repos = await reposRes.json<GitHubApiRepo[]>();

      for (const repo of repos.slice(0, 10)) {
        const prsRes = await this.githubFetch(
          `/repos/${repo.full_name}/pulls?state=all&per_page=50&sort=updated`
        );

        if (prsRes.ok) {
          const repoPRs = await prsRes.json<GitHubApiPullRequest[]>();
          for (const pr of repoPRs) {
            pullRequests.push({
              id: pr.id,
              number: pr.number,
              title: pr.title,
              body: pr.body,
              state: pr.merged_at ? 'merged' : pr.state,
              head: pr.head,
              base: pr.base,
              createdAt: new Date(pr.created_at),
              updatedAt: new Date(pr.updated_at),
              mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
            });
          }
        }
      }

      return this.successResult(pullRequests.length);
    } catch (error) {
      return this.failedResult([
        this.syncError('pull_requests', String(error), 'SYNC_ERROR'),
      ]);
    }
  }

  async fetchEntity(entityType: string, id: string): Promise<unknown> {
    switch (entityType) {
      case 'repository': {
        const res = await this.githubFetch(`/repos/${id}`);
        if (!res.ok) throw new Error(`Repository not found: ${id}`);
        return res.json();
      }
      case 'issue': {
        // id format: "owner/repo/123"
        const [owner, repo, number] = id.split('/');
        const res = await this.githubFetch(`/repos/${owner}/${repo}/issues/${number}`);
        if (!res.ok) throw new Error(`Issue not found: ${id}`);
        return res.json();
      }
      case 'pull_request': {
        const [owner, repo, number] = id.split('/');
        const res = await this.githubFetch(`/repos/${owner}/${repo}/pulls/${number}`);
        if (!res.ok) throw new Error(`Pull request not found: ${id}`);
        return res.json();
      }
      default:
        throw new Error(`Unknown entity type: ${entityType}`);
    }
  }

  async pushEntity(entityType: string, data: unknown): Promise<string> {
    switch (entityType) {
      case 'issue': {
        const issue = data as { owner: string; repo: string; title: string; body?: string };
        const res = await this.githubFetch(`/repos/${issue.owner}/${issue.repo}/issues`, {
          method: 'POST',
          body: JSON.stringify({ title: issue.title, body: issue.body }),
        });
        if (!res.ok) throw new Error('Failed to create issue');
        const created = await res.json<{ number: number }>();
        return `${issue.owner}/${issue.repo}/${created.number}`;
      }
      case 'comment': {
        const comment = data as { owner: string; repo: string; issueNumber: number; body: string };
        const res = await this.githubFetch(
          `/repos/${comment.owner}/${comment.repo}/issues/${comment.issueNumber}/comments`,
          {
            method: 'POST',
            body: JSON.stringify({ body: comment.body }),
          }
        );
        if (!res.ok) throw new Error('Failed to create comment');
        const created = await res.json<{ id: number }>();
        return String(created.id);
      }
      default:
        throw new Error(`Cannot push entity type: ${entityType}`);
    }
  }

  async handleWebhook(event: string, payload: unknown): Promise<void> {
    // Handle GitHub webhook events for real-time sync
    console.log(`GitHub webhook: ${event}`, payload);

    // In a real implementation, you'd update the synced_entities table
    // based on the webhook payload
  }

  // OAuth methods
  getOAuthUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: this.credentials.client_id || '',
      redirect_uri: redirectUri,
      scope: 'repo read:user read:org',
      state,
    });
    return `https://github.com/login/oauth/authorize?${params}`;
  }

  async exchangeOAuthCode(code: string, redirectUri: string): Promise<IntegrationCredentials> {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: this.credentials.client_id,
        client_secret: this.credentials.client_secret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!res.ok) {
      throw new Error('Failed to exchange OAuth code');
    }

    const data = await res.json<{ access_token: string; token_type: string; scope: string }>();
    return {
      access_token: data.access_token,
      token_type: data.token_type,
      scope: data.scope,
    };
  }

  // Helper for GitHub API calls
  private async githubFetch(path: string, options?: RequestInit): Promise<Response> {
    return fetch(`${GITHUB_API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'AgentOps/1.0',
        ...options?.headers,
      },
    });
  }
}

// Register the integration
integrationRegistry.register('github', () => new GitHubIntegration());
