import { type EmbeddingProvider, BaseEmbeddingProvider } from './provider.js';
import { type EmbeddingConfig } from '../config/schema.js';
import { getConfig } from '../config/index.js';
import { logger } from '@mcp/shared/Utils/logger.js';

export type { EmbeddingProvider } from './provider.js';
export { BaseEmbeddingProvider } from './provider.js';

// Lazy wrapper for Ollama provider (mirrors ai-provider.ts pattern)
class OllamaProviderWrapper extends BaseEmbeddingProvider {
  private config: EmbeddingConfig;
  private provider: EmbeddingProvider | null = null;

  constructor(config: EmbeddingConfig) {
    super('ollama-embedding');
    this.config = config;
  }

  private async getProvider(): Promise<EmbeddingProvider> {
    if (!this.provider) {
      const { OllamaEmbeddingProvider } = await import('./ollama-provider.js');
      this.provider = new OllamaEmbeddingProvider(this.config);
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

// Lazy wrapper for LM Studio provider
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

export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider | null {
  switch (config.provider) {
    case 'ollama':
      return new OllamaProviderWrapper(config);
    case 'lmstudio':
      return new LMStudioEmbeddingWrapper(config);
    case 'none':
      logger.info('Embedding provider disabled — keyword-only search');
      return null;
    default:
      logger.warn('Unknown embedding provider, disabling vector search', { provider: config.provider });
      return null;
  }
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
