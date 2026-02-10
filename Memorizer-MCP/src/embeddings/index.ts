import {
  type EmbeddingProvider,
  type EmbeddingConfig,
  BaseEmbeddingProvider,
  createEmbeddingProvider as sharedCreateProvider,
} from '@mcp/shared/Embeddings/index.js';
import { getConfig } from '../config/index.js';

export type { EmbeddingProvider } from '@mcp/shared/Embeddings/index.js';
export { BaseEmbeddingProvider } from '@mcp/shared/Embeddings/index.js';

// Lazy wrapper for LM Studio provider (stays local — needs `openai` SDK)
class LMStudioEmbeddingWrapper extends BaseEmbeddingProvider {
  private config: EmbeddingConfig;
  private provider: EmbeddingProvider | null = null;

  constructor(config: EmbeddingConfig) {
    super('lmstudio-embedding');
    this.config = config;
  }

  private async getProvider(): Promise<EmbeddingProvider> {
    if (!this.provider) {
      const { LMStudioEmbeddingProvider } = await import('./lmstudio-provider.js');
      this.provider = new LMStudioEmbeddingProvider(this.config);
    }
    return this.provider;
  }

  async embed(text: string): Promise<Float32Array> {
    const provider = await this.getProvider();
    return provider.embed(text);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const provider = await this.getProvider();
    return provider.embedBatch(texts);
  }
}

/**
 * Memorizer-specific provider factory.
 * Delegates to Shared's factory but adds `lmstudio` via extraProviders.
 */
export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider | null {
  return sharedCreateProvider(config, {
    lmstudio: (cfg) => new LMStudioEmbeddingWrapper(cfg),
  });
}

// Singleton — undefined means not yet initialized, null means disabled
let providerInstance: EmbeddingProvider | null | undefined;

/**
 * Get the singleton embedding provider.
 * Returns null when embeddings are disabled (EMBEDDING_PROVIDER=none).
 */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  if (providerInstance === undefined) {
    const config = getConfig();
    providerInstance = createEmbeddingProvider(config.embedding);
  }
  return providerInstance;
}

/**
 * Check if vector search is available.
 */
export function isVectorSearchEnabled(): boolean {
  return getEmbeddingProvider() !== null;
}

/** Reset singleton (for tests) */
export function resetEmbeddingProvider(): void {
  providerInstance = undefined;
}
