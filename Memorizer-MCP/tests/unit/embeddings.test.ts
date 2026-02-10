/**
 * Unit tests for embedding provider factory.
 * Tests provider selection based on config — no real API calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger — factory must be self-contained because vi.mock is hoisted
vi.mock('@mcp/shared/Utils/logger.js', () => {
  const instance = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  };
  return { Logger: vi.fn(() => instance), logger: instance };
});

// Mock config
vi.mock('../../src/config/index.js', () => ({
  getConfig: vi.fn(() => ({
    embedding: {
      provider: 'none',
      ollamaBaseUrl: 'http://localhost:11434',
      ollamaModel: 'nomic-embed-text',
      lmstudioBaseUrl: 'http://localhost:1234/v1',
      lmstudioModel: 'text-embedding-nomic-embed-text-v1.5',
      dimensions: 768,
      vectorWeight: 0.6,
      textWeight: 0.4,
    },
  })),
}));

import { createEmbeddingProvider } from '../../src/embeddings/index.js';
import type { EmbeddingConfig } from '../../src/config/schema.js';

function makeConfig(overrides: Partial<EmbeddingConfig> = {}): EmbeddingConfig {
  return {
    provider: 'none',
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaModel: 'nomic-embed-text',
    lmstudioBaseUrl: 'http://localhost:1234/v1',
    lmstudioModel: 'text-embedding-nomic-embed-text-v1.5',
    dimensions: 768,
    vectorWeight: 0.6,
    textWeight: 0.4,
    ...overrides,
  };
}

describe('createEmbeddingProvider', () => {
  it('should return null when provider is "none"', () => {
    const provider = createEmbeddingProvider(makeConfig({ provider: 'none' }));
    expect(provider).toBeNull();
  });

  it('should create Ollama wrapper when provider is "ollama"', () => {
    const provider = createEmbeddingProvider(makeConfig({ provider: 'ollama' }));
    expect(provider).not.toBeNull();
    // Should have embed and embedBatch methods
    expect(typeof provider!.embed).toBe('function');
    expect(typeof provider!.embedBatch).toBe('function');
  });

  it('should create LM Studio wrapper when provider is "lmstudio"', () => {
    const provider = createEmbeddingProvider(makeConfig({ provider: 'lmstudio' }));
    expect(provider).not.toBeNull();
    expect(typeof provider!.embed).toBe('function');
    expect(typeof provider!.embedBatch).toBe('function');
  });
});
