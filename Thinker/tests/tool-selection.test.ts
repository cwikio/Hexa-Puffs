/**
 * Unit tests for the tool selection with fallback logic.
 *
 * Tests the selectToolsWithFallback function which merges
 * embedding + regex results, and the required_tools direct
 * resolution path used by skills.
 */

import { describe, it, expect, vi } from 'vitest';
import type { CoreTool } from 'ai';
import { selectToolsWithFallback } from '../src/agent/tool-selection.js';
import type { EmbeddingToolSelector, ToolSelectionStats } from '../src/agent/embedding-tool-selector.js';

/** Create a minimal mock tool */
function mockTool(name: string): CoreTool {
  return {
    type: 'function',
    description: `Mock tool: ${name}`,
    parameters: { type: 'object', properties: {} },
  } as unknown as CoreTool;
}

/** Build a tool map from an array of names */
function buildToolMap(names: string[]): Record<string, CoreTool> {
  const map: Record<string, CoreTool> = {};
  for (const name of names) {
    map[name] = mockTool(name);
  }
  return map;
}

const ALL_TOOL_NAMES = [
  'send_telegram', 'store_fact', 'search_memories', 'get_status', 'spawn_subagent',
  'searcher_web_search', 'searcher_news_search', 'searcher_image_search', 'searcher_web_fetch',
  'memory_list_facts', 'memory_store_fact', 'memory_retrieve_memories',
  'memory_list_contacts', 'memory_create_contact', 'memory_list_projects',
  'gmail_list_emails', 'gmail_get_email', 'gmail_send_email',
  'gmail_get_new_emails', 'gmail_list_events', 'gmail_create_event',
  'filer_create_file', 'filer_read_file',
  'telegram_send_message', 'telegram_send_media',
];

const ALL_TOOLS = buildToolMap(ALL_TOOL_NAMES);

/** Create a mock EmbeddingToolSelector */
function createMockEmbeddingSelector(
  overrides: Partial<{
    initialized: boolean;
    selectResult: Record<string, CoreTool>;
    stats: ToolSelectionStats | null;
    scores: Map<string, number> | null;
    shouldThrow: boolean;
  }> = {}
): EmbeddingToolSelector {
  const {
    initialized = true,
    selectResult = {},
    stats = null,
    scores = null,
    shouldThrow = false,
  } = overrides;

  return {
    isInitialized: () => initialized,
    selectTools: vi.fn(async () => {
      if (shouldThrow) throw new Error('Embedding failed');
      return selectResult;
    }),
    getLastSelectionStats: () => stats,
    getLastScores: () => scores,
    initialize: vi.fn(),
  } as unknown as EmbeddingToolSelector;
}

describe('selectToolsWithFallback', () => {
  // ─── Regex fallback ──────────────────────────────────────────
  describe('regex fallback (no embedding selector)', () => {
    it('should use regex selection when embedding selector is null', async () => {
      const result = await selectToolsWithFallback('check my email', ALL_TOOLS, null);
      // Should have email tools from regex
      expect(result).toHaveProperty('gmail_list_emails');
      // Should have core tools
      expect(result).toHaveProperty('send_telegram');
    });

    it('should use regex when embedding selector is not initialized', async () => {
      const selector = createMockEmbeddingSelector({ initialized: false });
      const result = await selectToolsWithFallback('check my email', ALL_TOOLS, selector);
      expect(result).toHaveProperty('gmail_list_emails');
      expect(selector.selectTools).not.toHaveBeenCalled();
    });
  });

  // ─── Embedding + regex merge ─────────────────────────────────
  describe('embedding + regex merge', () => {
    it('should merge embedding and regex results', async () => {
      const embeddingResult = buildToolMap(['send_telegram', 'gmail_list_emails', 'store_fact']);
      const selector = createMockEmbeddingSelector({
        selectResult: embeddingResult,
        stats: {
          method: 'embedding',
          selectedCount: 3,
          totalTools: 25,
          topScore: 0.85,
          bottomSelectedScore: 0.4,
          coreToolCount: 2,
          aboveThreshold: 3,
          topTools: [
            { name: 'gmail_list_emails', score: 0.85 },
            { name: 'send_telegram', score: 0.6 },
            { name: 'store_fact', score: 0.4 },
          ],
        },
      });

      const result = await selectToolsWithFallback('check my email', ALL_TOOLS, selector);

      // Should have embedding-selected tools
      expect(result).toHaveProperty('gmail_list_emails');
      // Should also have regex-added email tools that embedding missed
      expect(result).toHaveProperty('gmail_send_email');
      expect(result).toHaveProperty('gmail_get_email');
    });

    it('should not duplicate tools present in both embedding and regex', async () => {
      const embeddingResult = buildToolMap(['send_telegram', 'searcher_web_search']);
      const selector = createMockEmbeddingSelector({ selectResult: embeddingResult });

      const result = await selectToolsWithFallback('search for cats', ALL_TOOLS, selector);

      // searcher_web_search should be present once (from embedding)
      expect(result).toHaveProperty('searcher_web_search');
      const toolNames = Object.keys(result);
      const searchCount = toolNames.filter(n => n === 'searcher_web_search').length;
      expect(searchCount).toBe(1);
    });
  });

  // ─── Embedding failure fallback ──────────────────────────────
  describe('embedding failure fallback', () => {
    it('should fall back to regex when embedding throws', async () => {
      const selector = createMockEmbeddingSelector({ shouldThrow: true });
      const result = await selectToolsWithFallback('check my email', ALL_TOOLS, selector);

      // Should still work via regex fallback
      expect(result).toHaveProperty('gmail_list_emails');
      expect(result).toHaveProperty('send_telegram');
    });
  });

  // ─── Tool cap ─────────────────────────────────────────────────
  describe('tool cap (Option 4)', () => {
    it('should not cap when total is under the limit', async () => {
      // Default ALL_TOOLS has 25 entries — under or at the default cap of 25
      const result = await selectToolsWithFallback('hello', ALL_TOOLS, null);
      // Should have tools but no more than the original set
      expect(Object.keys(result).length).toBeLessThanOrEqual(ALL_TOOL_NAMES.length);
    });

    it('should cap when embedding+regex merge exceeds the limit', async () => {
      // Create a large tool set (35 tools)
      const manyNames = [
        ...ALL_TOOL_NAMES,
        'extra_tool_1', 'extra_tool_2', 'extra_tool_3', 'extra_tool_4', 'extra_tool_5',
        'extra_tool_6', 'extra_tool_7', 'extra_tool_8', 'extra_tool_9', 'extra_tool_10',
      ];
      const manyTools = buildToolMap(manyNames);

      // Embedding returns all 35 tools
      const scores = new Map<string, number>();
      manyNames.forEach((name, i) => scores.set(name, 1 - i * 0.02));

      const selector = createMockEmbeddingSelector({
        selectResult: manyTools,
        scores,
        stats: {
          method: 'embedding',
          selectedCount: 35,
          totalTools: 35,
          topScore: 1.0,
          bottomSelectedScore: 0.3,
          coreToolCount: 5,
          aboveThreshold: 35,
          topTools: [{ name: 'send_telegram', score: 1.0 }],
        },
      });

      const result = await selectToolsWithFallback('do everything', manyTools, selector);
      expect(Object.keys(result).length).toBeLessThanOrEqual(25);
    });

    it('should always keep core tools when capping', async () => {
      const manyNames = [
        ...ALL_TOOL_NAMES,
        'extra_tool_1', 'extra_tool_2', 'extra_tool_3', 'extra_tool_4', 'extra_tool_5',
        'extra_tool_6', 'extra_tool_7', 'extra_tool_8', 'extra_tool_9', 'extra_tool_10',
      ];
      const manyTools = buildToolMap(manyNames);

      // Give core tools low scores to test they survive capping
      const scores = new Map<string, number>();
      const coreNames = ['send_telegram', 'store_fact', 'search_memories', 'get_status', 'spawn_subagent'];
      for (const name of manyNames) {
        scores.set(name, coreNames.includes(name) ? 0.01 : 0.9);
      }

      const selector = createMockEmbeddingSelector({
        selectResult: manyTools,
        scores,
        stats: {
          method: 'embedding',
          selectedCount: 35,
          totalTools: 35,
          topScore: 0.9,
          bottomSelectedScore: 0.01,
          coreToolCount: 5,
          aboveThreshold: 35,
          topTools: [{ name: 'extra_tool_1', score: 0.9 }],
        },
      });

      const result = await selectToolsWithFallback('do everything', manyTools, selector);

      // Core tools must survive even with lowest scores
      for (const name of coreNames) {
        expect(result).toHaveProperty(name);
      }
      expect(Object.keys(result).length).toBeLessThanOrEqual(25);
    });

    it('should prefer higher-scored tools when capping', async () => {
      const manyNames = [
        ...ALL_TOOL_NAMES,
        'extra_tool_1', 'extra_tool_2', 'extra_tool_3', 'extra_tool_4', 'extra_tool_5',
        'extra_tool_6', 'extra_tool_7', 'extra_tool_8', 'extra_tool_9', 'extra_tool_10',
      ];
      const manyTools = buildToolMap(manyNames);

      const scores = new Map<string, number>();
      // Give extra_tool_1 the highest score, extra_tool_10 the lowest
      scores.set('extra_tool_1', 0.99);
      scores.set('extra_tool_10', 0.01);
      // Fill the rest with middle scores
      for (const name of manyNames) {
        if (!scores.has(name)) scores.set(name, 0.5);
      }

      const selector = createMockEmbeddingSelector({
        selectResult: manyTools,
        scores,
        stats: {
          method: 'embedding',
          selectedCount: 35,
          totalTools: 35,
          topScore: 0.99,
          bottomSelectedScore: 0.01,
          coreToolCount: 5,
          aboveThreshold: 35,
          topTools: [{ name: 'extra_tool_1', score: 0.99 }],
        },
      });

      const result = await selectToolsWithFallback('do everything', manyTools, selector);

      // High-scored tool should be kept
      expect(result).toHaveProperty('extra_tool_1');
      // Low-scored tool should be dropped
      expect(result).not.toHaveProperty('extra_tool_10');
    });
  });
});
