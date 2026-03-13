export class GitCredentialManager {
  private token: string | null = null;
  private expiresAt: number | null = null;
  private refreshCallback:
    | (() => Promise<{ accessToken: string; expiresAt?: string }>)
    | null = null;
  private pendingRefresh: Promise<{ accessToken: string; expiresAt?: string }> | null = null;

  setToken(token: string, expiresAt?: string) {
    this.token = token;
    this.expiresAt = expiresAt ? new Date(expiresAt).getTime() : null;
  }

  setRefreshCallback(
    cb: () => Promise<{ accessToken: string; expiresAt?: string }>,
  ) {
    this.refreshCallback = cb;
  }

  async getCredentials(_host?: string): Promise<string> {
    // Check if token is expired (with 60s buffer)
    if (this.token && this.expiresAt && Date.now() > this.expiresAt - 60_000) {
      if (this.refreshCallback) {
        // Deduplicate concurrent refresh requests — all callers await the same promise
        if (!this.pendingRefresh) {
          this.pendingRefresh = this.refreshCallback().finally(() => {
            this.pendingRefresh = null;
          });
        }
        const result = await this.pendingRefresh;
        this.setToken(result.accessToken, result.expiresAt);
      }
    }

    if (!this.token) {
      throw new Error("No git credential available");
    }

    // Return in git credential helper format
    return `username=oauth2\npassword=${this.token}\n`;
  }
}

export const gitCredentials = new GitCredentialManager();
