import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbeddingToolSelector } from '../../src/agent/embedding-tool-selector.js';
import type { EmbeddingProvider } from '@mcp/shared/Embeddings/provider.js';
import type { CoreTool } from 'ai';

/** Create a mock provider where embed returns a deterministic vector based on text content */
function createMockProvider(): EmbeddingProvider {
  // Map of text → embedding vector (simple deterministic mapping)
  const embeddings: Record<string, Float32Array> = {
    // Tool description embeddings
    'searcher_web_search: Search the web': new Float32Array([1, 0, 0, 0]),
    'gmail_send_email: Send an email': new Float32Array([0, 1, 0, 0]),
    'filer_create_file: Create a file': new Float32Array([0, 0, 1, 0]),
    'send_telegram: Send telegram message': new Float32Array([0, 0, 0, 1]),
    'store_fact: Store a fact': new Float32Array([0.5, 0.5, 0, 0]),
  };

  return {
    embed: vi.fn(async (text: string) => {
      return embeddings[text] ?? new Float32Array([0.25, 0.25, 0.25, 0.25]);
    }),
    embedBatch: vi.fn(async (texts: string[]) => {
      return texts.map(t => embeddings[t] ?? new Float32Array([0.25, 0.25, 0.25, 0.25]));
    }),
  };
}

function makeTool(description: string): CoreTool {
  return { description, parameters: { type: 'object', properties: {} } } as unknown as CoreTool;
}

const ALL_TOOLS: Record<string, CoreTool> = {
  searcher_web_search: makeTool('Search the web'),
  gmail_send_email: makeTool('Send an email'),
  filer_create_file: makeTool('Create a file'),
  send_telegram: makeTool('Send telegram message'),
  store_fact: makeTool('Store a fact'),
};

const CORE_TOOLS = ['send_telegram', 'store_fact'];

describe('EmbeddingToolSelector', () => {
  let provider: EmbeddingProvider;
  let selector: EmbeddingToolSelector;

  beforeEach(async () => {
    provider = createMockProvider();
    selector = new EmbeddingToolSelector(provider, {
      similarityThreshold: 0.3,
      topK: 15,
      minTools: 2,
    });
    await selector.initialize(ALL_TOOLS);
  });

  it('initializes and embeds all tool descriptions', () => {
    expect(selector.isInitialized()).toBe(true);
    expect(provider.embedBatch).toHaveBeenCalledOnce();
    expect((provider.embedBatch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toHaveLength(5);
  });

  it('always includes core tools', async () => {
    const selected = await selector.selectTools('anything', ALL_TOOLS, CORE_TOOLS);
    expect(selected).toHaveProperty('send_telegram');
    expect(selected).toHaveProperty('store_fact');
  });

  it('includes at least minTools tools beyond core', async () => {
    const selected = await selector.selectTools('random query', ALL_TOOLS, CORE_TOOLS);
    // Core (2) + minTools (2) = at least 4
    expect(Object.keys(selected).length).toBeGreaterThanOrEqual(4);
  });

  it('respects topK limit', async () => {
    const smallSelector = new EmbeddingToolSelector(provider, {
      similarityThreshold: 0,
      topK: 3,
      minTools: 1,
    });
    await smallSelector.initialize(ALL_TOOLS);

    const selected = await smallSelector.selectTools('test', ALL_TOOLS, CORE_TOOLS);
    expect(Object.keys(selected).length).toBeLessThanOrEqual(3);
  });

  it('throws if not initialized', async () => {
    const fresh = new EmbeddingToolSelector(provider);
    await expect(fresh.selectTools('test', ALL_TOOLS, CORE_TOOLS)).rejects.toThrow('not initialized');
  });

  it('handles empty tools map', async () => {
    const emptySelector = new EmbeddingToolSelector(provider);
    await emptySelector.initialize({});
    const selected = await emptySelector.selectTools('test', {}, []);
    expect(Object.keys(selected)).toHaveLength(0);
  });

  it('embeds the user message for comparison', async () => {
    await selector.selectTools('search the web for cats', ALL_TOOLS, CORE_TOOLS);
    expect(provider.embed).toHaveBeenCalledWith('search the web for cats');
  });

  // ─── Observability (stats getter) ────────────────────────────────

  it('returns null stats before any selection', () => {
    expect(selector.getLastSelectionStats()).toBeNull();
  });

  it('populates stats after selectTools()', async () => {
    await selector.selectTools('search the web', ALL_TOOLS, CORE_TOOLS);
    const stats = selector.getLastSelectionStats();

    expect(stats).not.toBeNull();
    expect(stats!.method).toBe('embedding');
    expect(stats!.totalTools).toBe(5);
    expect(stats!.selectedCount).toBeGreaterThanOrEqual(4); // core + minTools
    expect(stats!.topScore).toBeGreaterThan(0);
    expect(stats!.coreToolCount).toBe(2);
    expect(stats!.topTools).toHaveLength(5);
    expect(stats!.topTools[0]).toHaveProperty('name');
    expect(stats!.topTools[0]).toHaveProperty('score');
  });

  // ─── Re-initialization ──────────────────────────────────────────

  it('re-initializes with a different tool set', async () => {
    const newTools: Record<string, CoreTool> = {
      searcher_web_search: makeTool('Search the web'),
      new_tool: makeTool('A brand new tool'),
    };

    // Reset the mock to track second call
    (provider.embedBatch as ReturnType<typeof vi.fn>).mockClear();
    await selector.initialize(newTools);

    expect(selector.isInitialized()).toBe(true);
    // Should have been called for the 2 uncached tools (no cache path = no caching)
    expect(provider.embedBatch).toHaveBeenCalledOnce();
    expect((provider.embedBatch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toHaveLength(2);
  });
});
