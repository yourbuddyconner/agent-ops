import { ModalClient } from 'modal';

export interface SandboxConfig {
  appName: string;
  sandboxName: string;
  image: string;
  command: string[];
  port: number;
  timeoutMs: number;
  idleTimeoutMs: number;
  callbackToken: string;
}

export interface SandboxResult {
  sandboxId: string;
  tunnelUrl: string;
}

/**
 * Service for managing Modal sandboxes.
 * Handles creation, lookup, and termination of sandboxes.
 */
export class ModalService {
  private modal: ModalClient;

  constructor() {
    this.modal = new ModalClient();
  }

  /**
   * Get an existing sandbox or create a new one.
   * Uses named sandboxes for persistent lookup.
   */
  async getOrCreateSandbox(config: SandboxConfig): Promise<SandboxResult> {
    const app = await this.modal.apps.fromName(config.appName, {
      createIfMissing: true,
    });
    const image = this.modal.images.fromRegistry(config.image);

    try {
      // Try to get existing sandbox first
      const existing = await this.modal.sandboxes.fromName(
        config.appName,
        config.sandboxName
      );
      const tunnels = await existing.tunnels();
      return {
        sandboxId: existing.sandboxId,
        tunnelUrl: tunnels[config.port].url,
      };
    } catch {
      // Sandbox doesn't exist, create a new one
      // Pass callback token as environment variable for auth
      const secret = await this.modal.secrets.fromObject({
        CALLBACK_TOKEN: config.callbackToken,
      });

      const sb = await this.modal.sandboxes.create(app, image, {
        name: config.sandboxName,
        command: config.command,
        encryptedPorts: [config.port],
        timeoutMs: config.timeoutMs,
        idleTimeoutMs: config.idleTimeoutMs,
        secrets: [secret],
      });

      const tunnels = await sb.tunnels();
      return {
        sandboxId: sb.sandboxId,
        tunnelUrl: tunnels[config.port].url,
      };
    }
  }

  /**
   * Terminate a sandbox by name.
   * Silently ignores if sandbox is already terminated.
   */
  async terminateSandbox(appName: string, sandboxName: string): Promise<void> {
    try {
      const sb = await this.modal.sandboxes.fromName(appName, sandboxName);
      await sb.terminate();
    } catch {
      // Sandbox may already be terminated or not exist
    }
  }

  /**
   * Check if a sandbox is running by attempting to reach its health endpoint.
   */
  async isSandboxHealthy(tunnelUrl: string): Promise<boolean> {
    try {
      const response = await fetch(`${tunnelUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
