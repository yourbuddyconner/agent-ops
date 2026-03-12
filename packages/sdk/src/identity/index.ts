// ─── Identity Provider Contract ──────────────────────────────────────────────

export type IdentityProtocol = 'oauth2' | 'oidc' | 'saml' | 'credentials';

export interface ProviderConfig {
  clientId?: string;
  clientSecret?: string;
  entityId?: string;
  ssoUrl?: string;
  certificate?: string;
  [key: string]: string | undefined;
}

export interface CallbackData {
  code?: string;
  samlResponse?: string;
  email?: string;
  password?: string;
  state?: string;
  redirectUri?: string;
}

export interface IdentityResult {
  externalId: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  username?: string;
}

export interface IdentityProvider {
  readonly id: string;
  readonly displayName: string;
  readonly icon: string;
  readonly brandColor?: string;
  readonly protocol: IdentityProtocol;
  readonly configKeys: string[]; // env var keys needed (e.g. ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'])

  // Redirect URL for OAuth/OIDC/SAML. Not present on 'credentials' protocol.
  getAuthUrl?(config: ProviderConfig, callbackUrl: string, state: string): string;
  handleCallback(config: ProviderConfig, callbackData: CallbackData): Promise<IdentityResult>;
}

export interface IdentityProviderPackage {
  provider: IdentityProvider;
}
