import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HuggingFaceEmbeddingProvider } from '../Embeddings/huggingface-provider.js';
import type { EmbeddingConfig } from '../Embeddings/config.js';

function makeConfig(overrides?: Partial<EmbeddingConfig>): EmbeddingConfig {
  return {
    provider: 'huggingface',
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaModel: 'nomic-embed-text',
    lmstudioBaseUrl: 'http://localhost:1234/v1',
    lmstudioModel: 'text-embedding-nomic-embed-text-v1.5',
    huggingfaceApiKey: 'hf_test_key',
    huggingfaceModel: 'nomic-ai/nomic-embed-text-v1.5',
    dimensions: 768,
    vectorWeight: 0.6,
    textWeight: 0.4,
    ...overrides,
  };
}

describe('HuggingFaceEmbeddingProvider', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws if no API key', () => {
    expect(() => new HuggingFaceEmbeddingProvider(makeConfig({ huggingfaceApiKey: undefined })))
      .toThrow('HuggingFace API key is required');
  });

  it('calls correct URL with auth header', async () => {
    const mockEmbedding = [[0.1, 0.2, 0.3]];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockEmbedding),
    });

    const provider = new HuggingFaceEmbeddingProvider(makeConfig());
    await provider.embed('test');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api-inference.huggingface.co/pipeline/feature-extraction/nomic-ai/nomic-embed-text-v1.5',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Authorization': 'Bearer hf_test_key',
          'Content-Type': 'application/json',
        },
      }),
    );
  });

  it('returns Float32Array from embed()', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([[0.1, 0.2, 0.3]]),
    });

    const provider = new HuggingFaceEmbeddingProvider(makeConfig());
    const result = await provider.embed('test');

    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(3);
    expect(result[0]).toBeCloseTo(0.1);
  });

  it('handles batch embeddings', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([[0.1, 0.2], [0.3, 0.4]]),
    });

    const provider = new HuggingFaceEmbeddingProvider(makeConfig());
    const results = await provider.embedBatch(['hello', 'world']);

    expect(results).toHaveLength(2);
    expect(results[0]).toBeInstanceOf(Float32Array);
    expect(results[1]).toBeInstanceOf(Float32Array);
  });

  it('returns empty array for empty batch', async () => {
    const provider = new HuggingFaceEmbeddingProvider(makeConfig());
    const results = await provider.embedBatch([]);
    expect(results).toEqual([]);
  });

  it('throws on HTTP error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    const provider = new HuggingFaceEmbeddingProvider(makeConfig());
    await expect(provider.embed('test')).rejects.toThrow('HuggingFace embedding request failed (401)');
  });

  it('throws on count mismatch', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([[0.1]]),  // 1 result for 2 inputs
    });

    const provider = new HuggingFaceEmbeddingProvider(makeConfig());
    await expect(provider.embedBatch(['a', 'b'])).rejects.toThrow('1 embeddings for 2 inputs');
  });

  it('sends wait_for_model option', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([[0.1]]),
    });

    const provider = new HuggingFaceEmbeddingProvider(makeConfig());
    await provider.embed('test');

    const callBody = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(callBody.options.wait_for_model).toBe(true);
  });
});
