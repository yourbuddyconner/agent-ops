import type { IdentityProvider, ProviderConfig, CallbackData, IdentityResult } from '@valet/sdk/identity';

export const githubIdentityProvider: IdentityProvider = {
  id: 'github',
  displayName: 'GitHub',
  icon: 'github',
  brandColor: '#24292e',
  protocol: 'oauth2',
  configKeys: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],

  getAuthUrl(config: ProviderConfig, callbackUrl: string, state: string): string {
    const params = new URLSearchParams({
      client_id: config.clientId!,
      redirect_uri: callbackUrl,
      scope: 'read:user user:email',
      state,
    });
    return `https://github.com/login/oauth/authorize?${params}`;
  },

  async handleCallback(config: ProviderConfig, data: CallbackData): Promise<IdentityResult> {
    if (!data.code) throw new Error('Missing authorization code');

    // Exchange code for token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: data.code,
      }),
    });

    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      throw new Error(tokenData.error || 'Token exchange failed');
    }

    // Fetch profile
    const profileRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Valet',
      },
    });
    if (!profileRes.ok) throw new Error('Failed to fetch GitHub profile');

    const profile = (await profileRes.json()) as {
      id: number;
      login: string;
      name: string | null;
      email: string | null;
      avatar_url: string;
    };

    // If email is private, fetch from /user/emails
    let email = profile.email;
    if (!email) {
      const emailsRes = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Valet',
        },
      });
      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as Array<{
          email: string;
          primary: boolean;
          verified: boolean;
        }>;
        const primary = emails.find((e) => e.primary && e.verified);
        email = primary?.email || emails.find((e) => e.verified)?.email || null;
      }
    }

    if (!email) throw new Error('No verified email found on GitHub account');

    return {
      externalId: String(profile.id),
      email,
      name: profile.name || profile.login,
      avatarUrl: profile.avatar_url,
      username: profile.login,
    };
  },
};
