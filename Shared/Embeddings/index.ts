import { type EmbeddingConfig } from './config.js';
import { type EmbeddingProvider, BaseEmbeddingProvider } from './provider.js';
import { Logger } from '../Utils/logger.js';

const logger = new Logger('shared:embeddings');

export type { EmbeddingProvider } from './provider.js';
export { BaseEmbeddingProvider } from './provider.js';
export { EmbeddingConfigSchema, type EmbeddingConfig } from './config.js';
export { cosineSimilarity } from './math.js';

/**
 * Extra provider factory — lets consumers register providers that
 * depend on libraries Shared doesn't ship (e.g. Memorizer's lmstudio via openai SDK).
 */
export type ExtraProviderFactory = (config: EmbeddingConfig) => EmbeddingProvider;

// Lazy wrapper for Ollama provider (dynamic import avoids loading code until needed)
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

// Lazy wrapper for HuggingFace provider
class HuggingFaceProviderWrapper extends BaseEmbeddingProvider {
  private config: EmbeddingConfig;
  private provider: EmbeddingProvider | null = null;

  constructor(config: EmbeddingConfig) {
    super('huggingface-embedding');
    this.config = config;
  }

  private async getProvider(): Promise<EmbeddingProvider> {
    if (!this.provider) {
      const { HuggingFaceEmbeddingProvider } = await import('./huggingface-provider.js');
      this.provider = new HuggingFaceEmbeddingProvider(this.config);
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
 * Create an embedding provider from config.
 *
 * Built-in providers: `ollama`, `huggingface`, `none`.
 * Pass `extraProviders` to register additional providers (e.g. `lmstudio`)
 * without Shared needing those dependencies.
 */
export function createEmbeddingProvider(
  config: EmbeddingConfig,
  extraProviders?: Record<string, ExtraProviderFactory>,
): EmbeddingProvider | null {
  // Check extraProviders first so consumers can override built-ins
  if (extraProviders && config.provider in extraProviders) {
    return extraProviders[config.provider](config);
  }

  switch (config.provider) {
    case 'ollama':
      return new OllamaProviderWrapper(config);
    case 'huggingface':
      return new HuggingFaceProviderWrapper(config);
    case 'none':
      logger.info('Embedding provider disabled');
      return null;
    default:
      logger.warn('Unknown embedding provider, disabling', { provider: config.provider });
      return null;
  }
}
