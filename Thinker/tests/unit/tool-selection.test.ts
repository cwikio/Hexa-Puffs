import { describe, it, expect, vi } from 'vitest';
import { selectToolsWithFallback } from '../../src/agent/tool-selection.js';
import type { EmbeddingToolSelector } from '../../src/agent/embedding-tool-selector.js';
import type { ToolSelectionStats } from '../../src/agent/embedding-tool-selector.js';
import type { CoreTool } from 'ai';

function makeTool(description: string): CoreTool {
  return { description, parameters: { type: 'object', properties: {} } } as unknown as CoreTool;
}

const TOOLS: Record<string, CoreTool> = {
  send_telegram: makeTool('Send telegram message'),
  searcher_web_search: makeTool('Search the web'),
  gmail_send_email: makeTool('Send an email'),
};

describe('selectToolsWithFallback', () => {
  it('uses embedding selector when initialized', async () => {
    const mockResult = { send_telegram: TOOLS.send_telegram };
    const selector = {
      isInitialized: () => true,
      selectTools: vi.fn().mockResolvedValue(mockResult),
      getLastSelectionStats: vi.fn().mockReturnValue({
        method: 'embedding',
        selectedCount: 1,
        totalTools: 3,
        topScore: 0.85,
        bottomSelectedScore: 0.85,
        coreToolCount: 1,
        aboveThreshold: 1,
        topTools: [{ name: 'send_telegram', score: 0.85 }],
      } satisfies ToolSelectionStats),
    } as unknown as EmbeddingToolSelector;

    const result = await selectToolsWithFallback('hello', TOOLS, selector);
    expect(result).toBe(mockResult);
    expect(selector.selectTools).toHaveBeenCalledOnce();
  });

  it('falls back to regex when embedding selector is null', async () => {
    const result = await selectToolsWithFallback('search for weather', TOOLS, null);
    // Regex selector should return some tools (at minimum core tools)
    expect(Object.keys(result).length).toBeGreaterThan(0);
  });

  it('falls back to regex when embedding selector is not initialized', async () => {
    const selector = {
      isInitialized: () => false,
      selectTools: vi.fn(),
      getLastSelectionStats: vi.fn(),
    } as unknown as EmbeddingToolSelector;

    const result = await selectToolsWithFallback('hello', TOOLS, selector);
    expect(selector.selectTools).not.toHaveBeenCalled();
    expect(Object.keys(result).length).toBeGreaterThan(0);
  });

  it('falls back to regex when embedding selector throws', async () => {
    const selector = {
      isInitialized: () => true,
      selectTools: vi.fn().mockRejectedValue(new Error('connection failed')),
      getLastSelectionStats: vi.fn().mockReturnValue(null),
    } as unknown as EmbeddingToolSelector;

    const result = await selectToolsWithFallback('hello', TOOLS, selector);
    // Should not throw — returns regex fallback
    expect(Object.keys(result).length).toBeGreaterThan(0);
  });

  it('logs method=embedding when embedding selector succeeds', async () => {
    const mockResult = { send_telegram: TOOLS.send_telegram };
    const selector = {
      isInitialized: () => true,
      selectTools: vi.fn().mockResolvedValue(mockResult),
      getLastSelectionStats: vi.fn().mockReturnValue({
        method: 'embedding',
        selectedCount: 1,
        totalTools: 3,
        topScore: 0.85,
        bottomSelectedScore: 0.85,
        coreToolCount: 1,
        aboveThreshold: 1,
        topTools: [{ name: 'send_telegram', score: 0.85 }],
      } satisfies ToolSelectionStats),
    } as unknown as EmbeddingToolSelector;

    await selectToolsWithFallback('hello', TOOLS, selector);
    expect(selector.getLastSelectionStats).toHaveBeenCalled();
  });
});
