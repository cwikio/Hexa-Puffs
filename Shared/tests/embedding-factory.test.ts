import { describe, it, expect } from 'vitest';
import { createEmbeddingProvider } from '../Embeddings/index.js';
import type { EmbeddingConfig } from '../Embeddings/config.js';
import type { EmbeddingProvider } from '../Embeddings/provider.js';

function makeConfig(overrides?: Partial<EmbeddingConfig>): EmbeddingConfig {
  return {
    provider: 'none',
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaModel: 'nomic-embed-text',
    lmstudioBaseUrl: 'http://localhost:1234/v1',
    lmstudioModel: 'text-embedding-nomic-embed-text-v1.5',
    huggingfaceApiKey: undefined,
    huggingfaceModel: 'nomic-ai/nomic-embed-text-v1.5',
    dimensions: 768,
    vectorWeight: 0.6,
    textWeight: 0.4,
    ...overrides,
  };
}

describe('createEmbeddingProvider', () => {
  it('returns null for provider "none"', () => {
    const result = createEmbeddingProvider(makeConfig({ provider: 'none' }));
    expect(result).toBeNull();
  });

  it('returns a provider for "ollama"', () => {
    const result = createEmbeddingProvider(makeConfig({ provider: 'ollama' }));
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('embed');
    expect(result).toHaveProperty('embedBatch');
  });

  it('returns a provider for "huggingface" with API key', () => {
    const result = createEmbeddingProvider(
      makeConfig({ provider: 'huggingface', huggingfaceApiKey: 'hf_test' })
    );
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('embed');
  });

  it('returns null for unknown provider', () => {
    const result = createEmbeddingProvider(
      makeConfig({ provider: 'unknown' as EmbeddingConfig['provider'] })
    );
    expect(result).toBeNull();
  });

  it('uses extraProviders for custom provider', () => {
    const mockProvider: EmbeddingProvider = {
      embed: async () => new Float32Array([1, 2, 3]),
      embedBatch: async () => [new Float32Array([1, 2, 3])],
    };

    const result = createEmbeddingProvider(
      makeConfig({ provider: 'lmstudio' }),
      { lmstudio: () => mockProvider },
    );

    expect(result).toBe(mockProvider);
  });

  it('extraProviders overrides built-in providers', () => {
    const mockProvider: EmbeddingProvider = {
      embed: async () => new Float32Array([9, 9, 9]),
      embedBatch: async () => [],
    };

    const result = createEmbeddingProvider(
      makeConfig({ provider: 'ollama' }),
      { ollama: () => mockProvider },
    );

    expect(result).toBe(mockProvider);
  });
});
