import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { EmbeddingToolSelector } from '../../src/agent/embedding-tool-selector.js';
import type { EmbeddingProvider } from '@mcp/shared/Embeddings/provider.js';
import type { CoreTool } from 'ai';

function makeTool(description: string): CoreTool {
  return { description, parameters: { type: 'object', properties: {} } } as unknown as CoreTool;
}

/** Mock provider that tracks embedBatch calls and returns deterministic vectors */
function createTrackingProvider(): EmbeddingProvider & { embedBatch: ReturnType<typeof vi.fn> } {
  let callCount = 0;

  return {
    embed: vi.fn(async (_text: string) => {
      return new Float32Array([0.25, 0.25, 0.25, 0.25]);
    }),
    embedBatch: vi.fn(async (texts: string[]) => {
      callCount++;
      // Return unique but deterministic embeddings based on text hash
      return texts.map((_t, i) => {
        const vec = new Float32Array(4);
        vec[0] = Math.sin(callCount * 100 + i);
        vec[1] = Math.cos(callCount * 100 + i);
        vec[2] = Math.sin(callCount * 200 + i);
        vec[3] = Math.cos(callCount * 200 + i);
        return vec;
      });
    }),
  };
}

const TOOLS_5: Record<string, CoreTool> = {
  tool_a: makeTool('Tool A description'),
  tool_b: makeTool('Tool B description'),
  tool_c: makeTool('Tool C description'),
  tool_d: makeTool('Tool D description'),
  tool_e: makeTool('Tool E description'),
};

describe('Embedding Cache Persistence (integration)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'emb-cache-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('full lifecycle: cache write → new instance → cache hit', async () => {
    const cachePath = join(tmpDir, 'cache.json');

    // First instance: embed all 5 tools
    const provider1 = createTrackingProvider();
    const selector1 = new EmbeddingToolSelector(provider1, {
      cachePath,
      providerName: 'test',
      modelName: 'test-model',
    });
    await selector1.initialize(TOOLS_5);

    expect(provider1.embedBatch).toHaveBeenCalledOnce();
    expect(provider1.embedBatch.mock.calls[0][0]).toHaveLength(5);

    // Verify cache file written
    const cacheRaw = await readFile(cachePath, 'utf-8');
    const cacheData = JSON.parse(cacheRaw);
    expect(cacheData.provider).toBe('test');
    expect(cacheData.model).toBe('test-model');
    expect(Object.keys(cacheData.entries)).toHaveLength(5);

    // Second instance: same tools → should NOT call embedBatch
    const provider2 = createTrackingProvider();
    const selector2 = new EmbeddingToolSelector(provider2, {
      cachePath,
      providerName: 'test',
      modelName: 'test-model',
    });
    await selector2.initialize(TOOLS_5);

    expect(provider2.embedBatch).not.toHaveBeenCalled();
    expect(selector2.isInitialized()).toBe(true);
  });

  it('incremental embedding: only new tools get embedded', async () => {
    const cachePath = join(tmpDir, 'cache.json');

    // Phase 1: embed 5 tools
    const provider1 = createTrackingProvider();
    const selector1 = new EmbeddingToolSelector(provider1, {
      cachePath,
      providerName: 'test',
      modelName: 'test-model',
    });
    await selector1.initialize(TOOLS_5);
    expect(provider1.embedBatch).toHaveBeenCalledOnce();

    // Phase 2: 5 old + 2 new → only 2 should be embedded
    const tools7: Record<string, CoreTool> = {
      ...TOOLS_5,
      tool_f: makeTool('Tool F description'),
      tool_g: makeTool('Tool G description'),
    };

    const provider2 = createTrackingProvider();
    const selector2 = new EmbeddingToolSelector(provider2, {
      cachePath,
      providerName: 'test',
      modelName: 'test-model',
    });
    await selector2.initialize(tools7);

    expect(provider2.embedBatch).toHaveBeenCalledOnce();
    expect(provider2.embedBatch.mock.calls[0][0]).toHaveLength(2);
    expect(selector2.isInitialized()).toBe(true);
  });

  it('cache invalidation: discards cache when provider/model changes', async () => {
    const cachePath = join(tmpDir, 'cache.json');

    // Phase 1: embed with provider "test"
    const provider1 = createTrackingProvider();
    const selector1 = new EmbeddingToolSelector(provider1, {
      cachePath,
      providerName: 'test',
      modelName: 'test-model',
    });
    await selector1.initialize(TOOLS_5);
    expect(provider1.embedBatch).toHaveBeenCalledOnce();

    // Phase 2: different model → cache should be discarded, all 5 re-embedded
    const provider2 = createTrackingProvider();
    const selector2 = new EmbeddingToolSelector(provider2, {
      cachePath,
      providerName: 'test',
      modelName: 'different-model',
    });
    await selector2.initialize(TOOLS_5);

    expect(provider2.embedBatch).toHaveBeenCalledOnce();
    expect(provider2.embedBatch.mock.calls[0][0]).toHaveLength(5);
  });

  it('hot-reload simulation: re-initialize with changed tools', async () => {
    const cachePath = join(tmpDir, 'cache.json');

    // Phase 1: tools A, B, C
    const provider = createTrackingProvider();
    const selector = new EmbeddingToolSelector(provider, {
      cachePath,
      providerName: 'test',
      modelName: 'test-model',
    });

    const toolsABC: Record<string, CoreTool> = {
      tool_a: makeTool('Tool A description'),
      tool_b: makeTool('Tool B description'),
      tool_c: makeTool('Tool C description'),
    };
    await selector.initialize(toolsABC);
    expect(provider.embedBatch).toHaveBeenCalledOnce();
    expect(provider.embedBatch.mock.calls[0][0]).toHaveLength(3);

    // Phase 2: re-initialize with A, B, D (C removed, D added)
    provider.embedBatch.mockClear();

    const toolsABD: Record<string, CoreTool> = {
      tool_a: makeTool('Tool A description'),
      tool_b: makeTool('Tool B description'),
      tool_d: makeTool('Tool D description'),
    };
    await selector.initialize(toolsABD);

    // Only D should be embedded (A, B cached)
    expect(provider.embedBatch).toHaveBeenCalledOnce();
    expect(provider.embedBatch.mock.calls[0][0]).toHaveLength(1);
    expect(provider.embedBatch.mock.calls[0][0][0]).toContain('tool_d');
  });

  it('works without cache path (no caching)', async () => {
    const provider = createTrackingProvider();
    const selector = new EmbeddingToolSelector(provider);
    await selector.initialize(TOOLS_5);

    expect(provider.embedBatch).toHaveBeenCalledOnce();
    expect(provider.embedBatch.mock.calls[0][0]).toHaveLength(5);
    expect(selector.isInitialized()).toBe(true);
  });
});
