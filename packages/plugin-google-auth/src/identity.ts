import type { IdentityProvider, ProviderConfig, CallbackData, IdentityResult } from '@valet/sdk/identity';

export const googleIdentityProvider: IdentityProvider = {
  id: 'google',
  displayName: 'Google',
  icon: 'google',
  brandColor: '#4285f4',
  protocol: 'oidc',
  configKeys: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],

  getAuthUrl(config: ProviderConfig, callbackUrl: string, state: string): string {
    const params = new URLSearchParams({
      client_id: config.clientId!,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'offline',
      prompt: 'consent',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  },

  async handleCallback(config: ProviderConfig, data: CallbackData): Promise<IdentityResult> {
    if (!data.code) throw new Error('Missing authorization code');
    if (!data.redirectUri) throw new Error('Missing redirect URI');

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId!,
        client_secret: config.clientSecret!,
        code: data.code,
        grant_type: 'authorization_code',
        redirect_uri: data.redirectUri,
      }),
    });

    const tokenData = (await tokenRes.json()) as {
      id_token?: string;
      access_token?: string;
      error?: string;
    };

    if (!tokenData.id_token) {
      throw new Error(tokenData.error || 'Token exchange failed');
    }

    // Decode id_token JWT (no verification needed - we just received it from Google over HTTPS)
    const idTokenParts = tokenData.id_token.split('.');
    const payload = JSON.parse(atob(idTokenParts[1])) as {
      sub: string;
      email: string;
      email_verified: boolean;
      name?: string;
      picture?: string;
    };

    if (!payload.email || !payload.email_verified) {
      throw new Error('Email not verified');
    }

    return {
      externalId: payload.sub,
      email: payload.email,
      name: payload.name,
      avatarUrl: payload.picture,
    };
  },
};
