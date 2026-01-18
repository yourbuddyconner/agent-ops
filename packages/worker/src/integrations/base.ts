import type { IntegrationService, SyncResult, SyncError } from '@agent-ops/shared';

export interface SyncOptions {
  entities?: string[];
  fullSync?: boolean;
  cursor?: string;
}

export interface IntegrationCredentials {
  [key: string]: string;
}

/**
 * Base class for third-party integrations.
 * Each integration must implement sync, fetchEntity, and pushEntity methods.
 */
export abstract class BaseIntegration {
  abstract readonly service: IntegrationService;
  abstract readonly supportedEntities: string[];

  protected credentials: IntegrationCredentials = {};

  /**
   * Set credentials for the integration
   */
  setCredentials(credentials: IntegrationCredentials): void {
    this.credentials = credentials;
  }

  /**
   * Validate that required credentials are present
   */
  abstract validateCredentials(): boolean;

  /**
   * Test connection to the service
   */
  abstract testConnection(): Promise<boolean>;

  /**
   * Sync data from the service
   */
  abstract sync(options: SyncOptions): Promise<SyncResult>;

  /**
   * Fetch a specific entity by type and ID
   */
  abstract fetchEntity(entityType: string, id: string): Promise<unknown>;

  /**
   * Push/update an entity to the service
   */
  abstract pushEntity(entityType: string, data: unknown): Promise<string>;

  /**
   * Handle webhook events from the service
   */
  abstract handleWebhook(event: string, payload: unknown): Promise<void>;

  /**
   * Get OAuth authorization URL (if applicable)
   */
  getOAuthUrl?(redirectUri: string, state: string): string;

  /**
   * Exchange OAuth code for tokens (if applicable)
   */
  exchangeOAuthCode?(code: string, redirectUri: string): Promise<IntegrationCredentials>;

  /**
   * Refresh OAuth tokens (if applicable)
   */
  refreshOAuthTokens?(refreshToken: string): Promise<IntegrationCredentials>;

  /**
   * Helper to create a successful sync result
   */
  protected successResult(recordsSynced: number, nextCursor?: string): SyncResult {
    return {
      success: true,
      recordsSynced,
      errors: [],
      nextCursor,
      completedAt: new Date(),
    };
  }

  /**
   * Helper to create a failed sync result
   */
  protected failedResult(errors: SyncError[]): SyncResult {
    return {
      success: false,
      recordsSynced: 0,
      errors,
      completedAt: new Date(),
    };
  }

  /**
   * Helper to create a sync error
   */
  protected syncError(entity: string, message: string, code: string, entityId?: string): SyncError {
    return { entity, entityId, message, code };
  }
}

/**
 * Registry of all available integrations
 */
export class IntegrationRegistry {
  private integrations = new Map<IntegrationService, () => BaseIntegration>();

  register(service: IntegrationService, factory: () => BaseIntegration): void {
    this.integrations.set(service, factory);
  }

  get(service: IntegrationService): BaseIntegration | null {
    const factory = this.integrations.get(service);
    return factory ? factory() : null;
  }

  has(service: IntegrationService): boolean {
    return this.integrations.has(service);
  }

  list(): IntegrationService[] {
    return Array.from(this.integrations.keys());
  }
}

export const integrationRegistry = new IntegrationRegistry();
