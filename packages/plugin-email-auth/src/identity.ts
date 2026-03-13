import type { IdentityProvider, ProviderConfig, CallbackData, IdentityResult } from '@valet/sdk/identity';

const MIN_ITERATIONS = 100_000;

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: MIN_ITERATIONS, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${MIN_ITERATIONS}:${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, iterStr, saltHex, hashHex] = stored.split(':');
  const iterations = parseInt(iterStr, 10);

  // Reject tampered iteration counts
  if (!iterations || iterations < MIN_ITERATIONS) {
    throw new Error(`Invalid PBKDF2 iterations: ${iterStr}`);
  }

  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const computed = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial, 256
  ));

  // Constant-time comparison on raw bytes
  const expected = new Uint8Array(hashHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  if (computed.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed[i] ^ expected[i];
  }
  return diff === 0;
}

export const emailIdentityProvider: IdentityProvider = {
  id: 'email',
  displayName: 'Email',
  icon: 'key',
  protocol: 'credentials',
  configKeys: [],

  async handleCallback(_config: ProviderConfig, data: CallbackData): Promise<IdentityResult> {
    if (!data.email || !data.password) {
      throw new Error('Email and password are required');
    }
    return {
      externalId: data.email.toLowerCase(),
      email: data.email.toLowerCase(),
    };
  },
};

export { hashPassword, verifyPassword };
