import type { IdentityProvider, ProviderConfig, CallbackData, IdentityResult } from '@valet/sdk/identity';

// ─── Google JWKS id_token verification ──────────────────────────────────────

interface GoogleJWK {
  kid: string;
  kty: string;
  alg: string;
  n: string;
  e: string;
  use: string;
}

let cachedKeys: GoogleJWK[] | null = null;
let cachedKeysExpiry = 0;

async function getGooglePublicKeys(): Promise<GoogleJWK[]> {
  if (cachedKeys && Date.now() < cachedKeysExpiry) return cachedKeys;

  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!res.ok) throw new Error(`Failed to fetch Google JWKS: ${res.status}`);

  // Respect Cache-Control max-age
  const cacheControl = res.headers.get('Cache-Control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const ttlMs = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) * 1000 : 3600_000;

  const jwks = (await res.json()) as { keys: GoogleJWK[] };
  cachedKeys = jwks.keys;
  cachedKeysExpiry = Date.now() + ttlMs;
  return cachedKeys;
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function verifyGoogleIdToken(
  idToken: string,
  expectedAudience: string,
): Promise<{
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Invalid id_token format');

  const headerJson = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
  const kid = headerJson.kid as string;
  const alg = headerJson.alg as string;
  if (alg !== 'RS256') throw new Error(`Unsupported id_token algorithm: ${alg}`);

  // Find the matching public key
  const keys = await getGooglePublicKeys();
  const jwk = keys.find(k => k.kid === kid);
  if (!jwk) throw new Error(`No matching Google public key for kid=${kid}`);

  // Import the RSA public key
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256' },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  // Verify signature
  const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = base64UrlDecode(parts[2]);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature.buffer as ArrayBuffer, signingInput);
  if (!valid) throw new Error('id_token signature verification failed');

  // Decode and validate claims
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1]))) as {
    iss: string;
    aud: string;
    exp: number;
    iat: number;
    sub: string;
    email: string;
    email_verified: boolean;
    name?: string;
    picture?: string;
  };

  // Validate issuer
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
    throw new Error(`Invalid id_token issuer: ${payload.iss}`);
  }

  // Validate audience
  if (payload.aud !== expectedAudience) {
    throw new Error(`id_token audience mismatch: expected ${expectedAudience}, got ${payload.aud}`);
  }

  // Validate expiry (allow 60s clock skew)
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now - 60) {
    throw new Error('id_token has expired');
  }

  return payload;
}

export { verifyGoogleIdToken };

// ─── Provider ───────────────────────────────────────────────────────────────

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

    // Verify id_token signature and validate claims (iss, aud, exp)
    const payload = await verifyGoogleIdToken(tokenData.id_token, config.clientId!);

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
