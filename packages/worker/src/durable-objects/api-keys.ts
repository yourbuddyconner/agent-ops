import type { DurableObjectState } from '@cloudflare/workers-types';
import type { Env } from '../env.js';
import type { IntegrationService, StoredAPIKey } from '@agent-ops/shared';

interface StoredCredential {
  id: string;
  userId: string;
  service: IntegrationService;
  encryptedData: string;
  scopes: string[];
  createdAt: string;
  expiresAt?: string;
}

/**
 * Durable Object for securely storing and managing API keys/credentials
 * for third-party integrations.
 *
 * Each user gets their own DO instance (keyed by user ID).
 */
export class APIKeysDurableObject implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      switch (path) {
        case '/store':
          return this.handleStore(request);
        case '/retrieve':
          return this.handleRetrieve(request);
        case '/list':
          return this.handleList(request);
        case '/rotate':
          return this.handleRotate(request);
        case '/revoke':
          return this.handleRevoke(request);
        default:
          return new Response('Not Found', { status: 404 });
      }
    } catch (error) {
      console.error('APIKeysDO error:', error);
      return new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  /**
   * Store encrypted credentials for a service
   */
  private async handleStore(request: Request): Promise<Response> {
    const body = await request.json<{
      userId: string;
      service: IntegrationService;
      credentials: Record<string, string>;
      scopes?: string[];
      expiresAt?: string;
    }>();

    const id = `${body.service}`;
    const encryptedData = await this.encrypt(JSON.stringify(body.credentials));

    const stored: StoredCredential = {
      id,
      userId: body.userId,
      service: body.service,
      encryptedData,
      scopes: body.scopes || [],
      createdAt: new Date().toISOString(),
      expiresAt: body.expiresAt,
    };

    await this.state.storage.put(`credential:${id}`, stored);

    return Response.json({ success: true, id });
  }

  /**
   * Retrieve decrypted credentials for a service
   */
  private async handleRetrieve(request: Request): Promise<Response> {
    const { service } = await request.json<{ service: IntegrationService }>();

    const stored = await this.state.storage.get<StoredCredential>(`credential:${service}`);
    if (!stored) {
      return Response.json({ error: 'Credentials not found' }, { status: 404 });
    }

    // Check expiration
    if (stored.expiresAt && new Date(stored.expiresAt) < new Date()) {
      return Response.json({ error: 'Credentials expired' }, { status: 410 });
    }

    const decrypted = await this.decrypt(stored.encryptedData);
    const credentials = JSON.parse(decrypted);

    return Response.json({
      credentials,
      scopes: stored.scopes,
      createdAt: stored.createdAt,
      expiresAt: stored.expiresAt,
    });
  }

  /**
   * List all stored credentials (without decrypting)
   */
  private async handleList(_request: Request): Promise<Response> {
    const entries = await this.state.storage.list<StoredCredential>({ prefix: 'credential:' });
    const credentials: Array<{
      service: IntegrationService;
      scopes: string[];
      createdAt: string;
      expiresAt?: string;
    }> = [];

    entries.forEach((value) => {
      credentials.push({
        service: value.service,
        scopes: value.scopes,
        createdAt: value.createdAt,
        expiresAt: value.expiresAt,
      });
    });

    return Response.json({ credentials });
  }

  /**
   * Rotate credentials for a service
   */
  private async handleRotate(request: Request): Promise<Response> {
    const { service, newCredentials } = await request.json<{
      service: IntegrationService;
      newCredentials: Record<string, string>;
    }>();

    const stored = await this.state.storage.get<StoredCredential>(`credential:${service}`);
    if (!stored) {
      return Response.json({ error: 'Credentials not found' }, { status: 404 });
    }

    const encryptedData = await this.encrypt(JSON.stringify(newCredentials));
    stored.encryptedData = encryptedData;
    stored.createdAt = new Date().toISOString();

    await this.state.storage.put(`credential:${service}`, stored);

    return Response.json({ success: true });
  }

  /**
   * Revoke/delete credentials for a service
   */
  private async handleRevoke(request: Request): Promise<Response> {
    const { service } = await request.json<{ service: IntegrationService }>();

    await this.state.storage.delete(`credential:${service}`);

    return Response.json({ success: true });
  }

  /**
   * Encrypt data using AES-GCM
   */
  private async encrypt(data: string): Promise<string> {
    const key = await this.getEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(data);

    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

    // Combine IV + ciphertext
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    return btoa(String.fromCharCode(...combined));
  }

  /**
   * Decrypt data using AES-GCM
   */
  private async decrypt(data: string): Promise<string> {
    const key = await this.getEncryptionKey();
    const combined = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));

    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);

    return new TextDecoder().decode(decrypted);
  }

  /**
   * Get or derive encryption key from environment secret
   */
  private async getEncryptionKey(): Promise<CryptoKey> {
    const keyMaterial = new TextEncoder().encode(this.env.ENCRYPTION_KEY);

    // Use PBKDF2 to derive a proper key from the secret
    const baseKey = await crypto.subtle.importKey('raw', keyMaterial, 'PBKDF2', false, [
      'deriveBits',
      'deriveKey',
    ]);

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: new TextEncoder().encode('agent-ops-salt'),
        iterations: 100000,
        hash: 'SHA-256',
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }
}
