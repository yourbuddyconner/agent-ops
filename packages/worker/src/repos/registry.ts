import type { RepoProvider } from '@valet/sdk/repos';
import { installedRepoProviders } from './packages.js';

class RepoProviderRegistry {
  private providers = new Map<string, RepoProvider>();

  register(provider: RepoProvider) {
    this.providers.set(provider.id, provider);
  }

  get(id: string): RepoProvider | undefined {
    return this.providers.get(id);
  }

  /** Resolve which repo provider handles a given URL */
  resolveByUrl(repoUrl: string): RepoProvider | undefined {
    for (const provider of this.providers.values()) {
      if (provider.urlPatterns.some((p) => p.test(repoUrl))) {
        return provider;
      }
    }
    return undefined;
  }

  /** Return ALL providers whose URL patterns match. */
  resolveAllByUrl(repoUrl: string): RepoProvider[] {
    const matches: RepoProvider[] = [];
    for (const provider of this.providers.values()) {
      if (provider.urlPatterns.some((p) => p.test(repoUrl))) {
        matches.push(provider);
      }
    }
    return matches;
  }

  list(): RepoProvider[] {
    return Array.from(this.providers.values());
  }
}

export const repoProviderRegistry = new RepoProviderRegistry();

// Auto-register discovered repo providers
for (const provider of installedRepoProviders) {
  repoProviderRegistry.register(provider);
}
