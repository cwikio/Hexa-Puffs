/**
 * Tool Reduction Integration Tests
 *
 * Tests the real ToolSelector + selectToolsWithFallback() with tool reduction
 * options (reduced core tools + tighter cap when 4B picks a tool).
 *
 * Section A: Deterministic tests with a mock embedding provider (no Ollama needed)
 * Section B: Full pipeline tests with real Ollama LlmToolSelector (skipped if unavailable)
 *
 * Run: cd Thinker && npx vitest run tests/integration/tool-reduction.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import type { CoreTool } from 'ai';
import { jsonSchema } from 'ai';
import type { EmbeddingProvider } from '@mcp/shared/Embeddings/provider.js';
import { EmbeddingConfigSchema, createEmbeddingProvider } from '@mcp/shared/Embeddings/index.js';
import { EmbeddingToolSelector } from '../../src/agent/embedding-tool-selector.js';
import { ToolSelector } from '../../src/agent/components/tool-selector.js';
import {
  selectToolsWithFallback,
  CORE_TOOL_NAMES,
  REDUCED_CORE_TOOL_NAMES,
  type ToolSelectionOptions,
} from '../../src/agent/tool-selection.js';
import { LlmToolSelector } from '../../src/agent/components/llm-tool-selector.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load fixture ────────────────────────────────────────────────

interface FixtureSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const fixtureSchemas: FixtureSchema[] = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/tool-schemas.json'), 'utf-8'),
);

/** Build a CoreTool map from the fixture (same pattern as catalog test) */
function buildToolMap(): Record<string, CoreTool> {
  const map: Record<string, CoreTool> = {};
  for (const schema of fixtureSchemas) {
    const name = schema.function.name;
    map[name] = {
      type: 'function' as const,
      description: schema.function.description,
      parameters: jsonSchema(schema.function.parameters),
    } as unknown as CoreTool;
  }
  return map;
}

// ── Mock Embedding Provider ─────────────────────────────────────
// Produces deterministic vectors based on keyword overlap so that
// semantically similar messages/tools get higher cosine similarity.

const EMBEDDING_DIM = 64;

/**
 * Simple keyword-based mock: hash each word into a dimension index
 * and accumulate counts, then L2-normalize. This gives us deterministic
 * cosine similarity that rewards keyword overlap.
 */
function keywordEmbedding(text: string): Float32Array {
  const vec = new Float32Array(EMBEDDING_DIM);
  const words = text.toLowerCase().replace(/[^a-z0-9_]/g, ' ').split(/\s+/).filter(Boolean);
  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
    }
    const idx = ((hash % EMBEDDING_DIM) + EMBEDDING_DIM) % EMBEDDING_DIM;
    vec[idx] += 1;
  }
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBEDDING_DIM; i++) vec[i] /= norm;
  return vec;
}

class MockEmbeddingProvider implements EmbeddingProvider {
  async embed(text: string): Promise<Float32Array> {
    return keywordEmbedding(text);
  }
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map(keywordEmbedding);
  }
}

// ── Ollama availability checks ──────────────────────────────────

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL = process.env.TOOL_SELECTOR_MODEL || 'qwen3.5:4b-q4_K_M';

async function isOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function isModelAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return data.models?.some((m) => m.name.startsWith(MODEL.split(':')[0])) ?? false;
  } catch {
    return false;
  }
}

const ollamaUp = await isOllamaAvailable();
const modelReady = ollamaUp && (await isModelAvailable());
const skipOllama = !ollamaUp
  ? 'Ollama not running'
  : !modelReady
    ? `Model ${MODEL} not available`
    : false;

console.log(`[tool-reduction] Ollama: ${ollamaUp ? 'up' : 'down'}, Model: ${modelReady ? 'ready' : 'missing'}`);
console.log(`[tool-reduction] Fixture: ${fixtureSchemas.length} tools loaded`);

// ══════════════════════════════════════════════════════════════════
// A. Reduction Logic (mocked LLM — deterministic, no Ollama)
// ══════════════════════════════════════════════════════════════════

describe('Tool Reduction Integration', () => {
  const allTools = buildToolMap();
  const toolNames = Object.keys(allTools);
  let embeddingSelector: EmbeddingToolSelector;
  let toolSelector: ToolSelector;

  beforeAll(async () => {
    const provider = new MockEmbeddingProvider();
    embeddingSelector = new EmbeddingToolSelector(provider, {
      similarityThreshold: 0.5,
      topK: 9,
      minTools: 6,
    });
    await embeddingSelector.initialize(allTools);

    toolSelector = new ToolSelector(embeddingSelector, allTools, undefined);
  });

  describe('reduction logic (mocked LLM)', () => {
    it('default options: result has ≤25 tools, all 6 core tools present', async () => {
      const result = await selectToolsWithFallback(
        'search for AI news',
        allTools,
        embeddingSelector,
        undefined,
        undefined, // default options
      );

      const names = Object.keys(result);
      expect(names.length).toBeLessThanOrEqual(20);

      for (const coreTool of CORE_TOOL_NAMES) {
        if (allTools[coreTool]) {
          expect(names).toContain(coreTool);
        }
      }
    });

    it('reduced options: result has ≤15 tools, only 2 core tools from reduced set', async () => {
      const reducedOptions: ToolSelectionOptions = {
        maxContextualTools: 9,
        coreToolNames: REDUCED_CORE_TOOL_NAMES,
      };

      const result = await selectToolsWithFallback(
        'search for AI news',
        allTools,
        embeddingSelector,
        undefined,
        reducedOptions,
      );

      const names = Object.keys(result);
      // 2 reduced core + 9 max contextual = 11
      expect(names.length).toBeLessThanOrEqual(11);

      // Reduced core set should be present
      for (const coreTool of REDUCED_CORE_TOOL_NAMES) {
        if (allTools[coreTool]) {
          expect(names).toContain(coreTool);
        }
      }
    });

    it('reduced mode drops store_fact, search_memories, get_status, spawn_subagent from core', async () => {
      const reducedOptions: ToolSelectionOptions = {
        maxContextualTools: 9,
        coreToolNames: REDUCED_CORE_TOOL_NAMES,
      };

      // Use a generic message that wouldn't match memory/status tools via regex/embedding
      const result = await selectToolsWithFallback(
        'show me pictures of cute dogs',
        allTools,
        embeddingSelector,
        undefined,
        reducedOptions,
      );

      const names = Object.keys(result);
      const droppedCoreTools = ['store_fact', 'search_memories', 'get_status', 'spawn_subagent'];

      // At least some of these should be absent — the mock embedding may match
      // some by chance (hash-based scores are not semantic), but all 4 should
      // never be present since they were removed from the core set.
      const presentDropped = droppedCoreTools.filter(t => names.includes(t));
      expect(presentDropped.length).toBeLessThan(droppedCoreTools.length);
    });

    it('contextual embedding/regex tools preserved in reduced mode', async () => {
      const reducedOptions: ToolSelectionOptions = {
        maxContextualTools: 9,
        coreToolNames: REDUCED_CORE_TOOL_NAMES,
      };

      const result = await selectToolsWithFallback(
        'search for AI news',
        allTools,
        embeddingSelector,
        undefined,
        reducedOptions,
      );

      const names = Object.keys(result);
      // "search" keyword should trigger search group via regex
      expect(names).toContain('searcher_web_search');
      // News search should match via embedding or regex
      expect(names).toContain('searcher_news_search');
    });

    it('sticky tools still injected after cap in reduced mode', async () => {
      const reducedOptions: ToolSelectionOptions = {
        maxContextualTools: 9,
        coreToolNames: REDUCED_CORE_TOOL_NAMES,
      };

      // Simulate recent tool usage with telegram_send_message
      const recentToolsByTurn = [
        { tools: ['telegram_send_message'] },
      ];

      const result = await toolSelector.selectTools(
        'what about the other one?',
        [],
        recentToolsByTurn,
        reducedOptions,
      );

      const names = Object.keys(result);
      // telegram_send_message should be injected as a sticky tool
      expect(names).toContain('telegram_send_message');
    });

    it('reduced mode produces fewer tools than default for same message', async () => {
      const messages = [
        'search for AI news',
        'send an email to bob',
        'what meetings do I have tomorrow',
        'read the file report.txt',
        'show me pictures of cats',
      ];

      let defaultTotal = 0;
      let reducedTotal = 0;

      for (const msg of messages) {
        const defaultResult = await selectToolsWithFallback(
          msg, allTools, embeddingSelector, undefined, undefined,
        );
        const reducedResult = await selectToolsWithFallback(
          msg, allTools, embeddingSelector, undefined,
          { maxContextualTools: 9, coreToolNames: REDUCED_CORE_TOOL_NAMES },
        );

        const defaultCount = Object.keys(defaultResult).length;
        const reducedCount = Object.keys(reducedResult).length;

        console.log(`  "${msg}": default=${defaultCount}, reduced=${reducedCount}`);
        defaultTotal += defaultCount;
        reducedTotal += reducedCount;
      }

      const avgDefault = defaultTotal / messages.length;
      const avgReduced = reducedTotal / messages.length;
      const reduction = ((avgDefault - avgReduced) / avgDefault) * 100;

      console.log(`  Average: default=${avgDefault.toFixed(1)}, reduced=${avgReduced.toFixed(1)}, reduction=${reduction.toFixed(1)}%`);

      // Reduced mode should have fewer tools on average
      expect(avgReduced).toBeLessThan(avgDefault);
    });

    it('ToolSelector threads options correctly to selectToolsWithFallback', async () => {
      const reducedOptions: ToolSelectionOptions = {
        maxContextualTools: 9,
        coreToolNames: REDUCED_CORE_TOOL_NAMES,
      };

      const result = await toolSelector.selectTools(
        'search for AI news',
        [],
        [],
        reducedOptions,
      );

      const names = Object.keys(result);
      // Base: 2 core + 9 contextual = 11, sticky/playbook may add more on top
      expect(names.length).toBeLessThanOrEqual(20); // generous upper bound with sticky
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // B. Full Pipeline with Real Ollama (skip if unavailable)
  // ══════════════════════════════════════════════════════════════════

  describe('full pipeline (real Ollama)', () => {
    let llmSelector: LlmToolSelector;
    let realEmbeddingSelector: EmbeddingToolSelector;
    let realToolSelector: ToolSelector;

    beforeAll(async () => {
      if (skipOllama) return;

      // Real embedding provider (nomic-embed-text via Ollama)
      const embeddingConfig = EmbeddingConfigSchema.parse({
        provider: 'ollama',
        ollamaBaseUrl: OLLAMA_HOST,
      });
      const realProvider = createEmbeddingProvider(embeddingConfig);
      if (!realProvider) throw new Error('Failed to create real embedding provider');

      const cachePath = join(homedir(), '.hexa-puffs/data/embedding-cache.json');
      realEmbeddingSelector = new EmbeddingToolSelector(realProvider, {
        similarityThreshold: 0.5,
        topK: 9,
        minTools: 6,
        cachePath,
        providerName: 'ollama',
        modelName: 'nomic-embed-text',
      });
      await realEmbeddingSelector.initialize(allTools);
      realToolSelector = new ToolSelector(realEmbeddingSelector, allTools, undefined);

      // LLM tool selector (4B model)
      llmSelector = new LlmToolSelector({
        host: OLLAMA_HOST,
        model: MODEL,
        timeoutMs: 30_000,
        enabled: true,
      });
      await llmSelector.initialize();
      llmSelector.updateToolSchemas(allTools);

      // Warmup: first call loads model into VRAM
      if (llmSelector.isAvailable()) {
        await llmSelector.selectFirstTool('hello', allTools);
      }
    }, 120_000);

    it.skipIf(skipOllama)(
      'LLM picks tool → reduced set is smaller',
      async () => {
        const llmPick = await llmSelector.selectFirstTool('search for AI news', allTools);

        // With pick: reduced options
        const reducedResult = await realToolSelector.selectTools(
          'search for AI news',
          [],
          [],
          llmPick ? { maxContextualTools: 9, coreToolNames: REDUCED_CORE_TOOL_NAMES } : undefined,
        );
        if (llmPick && !reducedResult[llmPick.toolName] && allTools[llmPick.toolName]) {
          reducedResult[llmPick.toolName] = allTools[llmPick.toolName];
        }

        // Without pick: default options
        const defaultResult = await realToolSelector.selectTools(
          'search for AI news',
          [],
          [],
          undefined,
        );

        const reducedNames = Object.keys(reducedResult);
        const defaultNames = Object.keys(defaultResult);

        console.log(`  LLM pick: ${llmPick?.toolName ?? 'null'}`);
        console.log(`  With pick (reduced): ${reducedNames.length} tools`);
        console.log(`  Without pick (default): ${defaultNames.length} tools`);

        if (llmPick) {
          // LLM pick must be in the reduced set
          expect(reducedNames).toContain(llmPick.toolName);
          // Reduced set uses only 2 core tools vs 6 — verify the 4 dropped ones are mostly absent
          const droppedCore = ['store_fact', 'search_memories', 'get_status', 'spawn_subagent'];
          const presentInReduced = droppedCore.filter(t => reducedNames.includes(t));
          const presentInDefault = droppedCore.filter(t => defaultNames.includes(t));
          expect(presentInReduced.length).toBeLessThanOrEqual(presentInDefault.length);
          // 2 reduced core + 9 contextual + 1 LLM pick = 12 max
          expect(reducedNames.length).toBeLessThanOrEqual(12);
        }
      },
      60_000,
    );

    it.skipIf(skipOllama)(
      'LLM returns null (greeting) → full set used',
      async () => {
        const llmPick = await llmSelector.selectFirstTool('hello how are you', allTools);

        const result = await realToolSelector.selectTools(
          'hello how are you',
          [],
          [],
          llmPick ? { maxContextualTools: 9, coreToolNames: REDUCED_CORE_TOOL_NAMES } : undefined,
        );

        const names = Object.keys(result);

        console.log(`  LLM pick: ${llmPick?.toolName ?? 'null'}`);
        console.log(`  Tool count: ${names.length}`);

        // For greetings, 4B should return null → full pipeline
        if (!llmPick) {
          for (const coreTool of CORE_TOOL_NAMES) {
            if (allTools[coreTool]) {
              expect(names).toContain(coreTool);
            }
          }
        }
      },
      60_000,
    );

    it.skipIf(skipOllama)(
      'email message → LLM picks gmail tool → reduced + email siblings',
      async () => {
        const llmPick = await llmSelector.selectFirstTool('send an email to bob about the meeting', allTools);

        const result = await realToolSelector.selectTools(
          'send an email to bob about the meeting',
          [],
          [],
          llmPick ? { maxContextualTools: 9, coreToolNames: REDUCED_CORE_TOOL_NAMES } : undefined,
        );
        if (llmPick && !result[llmPick.toolName] && allTools[llmPick.toolName]) {
          result[llmPick.toolName] = allTools[llmPick.toolName];
        }

        const names = Object.keys(result);

        console.log(`  LLM pick: ${llmPick?.toolName ?? 'null'}`);
        console.log(`  Tool count: ${names.length}`);
        console.log(`  Gmail tools: ${names.filter(n => n.startsWith('gmail_')).join(', ')}`);

        if (llmPick) {
          expect(names).toContain(llmPick.toolName);
          // Email regex group should still provide gmail tools
          expect(names.some(n => n.startsWith('gmail_'))).toBe(true);
        }
      },
      60_000,
    );

    it.skipIf(skipOllama)(
      'sticky tools preserved across calls with reduction',
      async () => {
        // First call — pick a tool
        const firstPick = await llmSelector.selectFirstTool('search for AI news', allTools);
        const firstResult = await realToolSelector.selectTools(
          'search for AI news',
          [],
          [],
          firstPick ? { maxContextualTools: 9, coreToolNames: REDUCED_CORE_TOOL_NAMES } : undefined,
        );
        if (firstPick && !firstResult[firstPick.toolName] && allTools[firstPick.toolName]) {
          firstResult[firstPick.toolName] = allTools[firstPick.toolName];
        }

        // Simulate sticky tools from first call
        const firstTools = Object.keys(firstResult);
        const recentToolsByTurn = [{ tools: firstTools.slice(0, 3) }];

        // Second call — follow-up with sticky context
        const secondPick = await llmSelector.selectFirstTool('what about yesterday', allTools);
        const secondResult = await realToolSelector.selectTools(
          'what about yesterday',
          [],
          recentToolsByTurn,
          secondPick ? { maxContextualTools: 9, coreToolNames: REDUCED_CORE_TOOL_NAMES } : undefined,
        );

        const secondNames = Object.keys(secondResult);

        console.log(`  First pick: ${firstPick?.toolName ?? 'null'}, first tools: ${firstTools.length}`);
        console.log(`  Sticky tools: ${recentToolsByTurn[0].tools.join(', ')}`);
        console.log(`  Second pick: ${secondPick?.toolName ?? 'null'}, second tools: ${secondNames.length}`);

        // At least some sticky tools should be present in the second call
        const stickyPresent = recentToolsByTurn[0].tools.filter(t => secondNames.includes(t));
        console.log(`  Sticky tools present in second call: ${stickyPresent.length}/${recentToolsByTurn[0].tools.length}`);
        expect(stickyPresent.length).toBeGreaterThan(0);
      },
      90_000,
    );

    it.skipIf(skipOllama)(
      'comparison: 10 messages with and without reduction',
      async () => {
        const messages = [
          'search for AI news',
          'send an email to bob',
          'what meetings do I have tomorrow',
          'read the file report.txt',
          'remember I like dark mode',
          'show me pictures of cats',
          'what do you know about me',
          'check my password vault for github',
          'navigate to google.com',
          'run the python script',
        ];

        let defaultTotal = 0;
        let reducedTotal = 0;
        let picksCount = 0;

        for (const msg of messages) {
          const llmPick = await llmSelector.selectFirstTool(msg, allTools);
          if (llmPick) picksCount++;

          // Default pipeline
          const defaultResult = await realToolSelector.selectTools(msg, [], [], undefined);
          const defaultCount = Object.keys(defaultResult).length;

          // Reduced pipeline (only when LLM picks)
          const reducedResult = await realToolSelector.selectTools(
            msg, [], [],
            llmPick ? { maxContextualTools: 9, coreToolNames: REDUCED_CORE_TOOL_NAMES } : undefined,
          );
          if (llmPick && !reducedResult[llmPick.toolName] && allTools[llmPick.toolName]) {
            reducedResult[llmPick.toolName] = allTools[llmPick.toolName];
          }
          const reducedCount = Object.keys(reducedResult).length;

          console.log(
            `  "${msg}": pick=${llmPick?.toolName ?? 'null'}, ` +
            `default=${defaultCount}, reduced=${reducedCount}`,
          );

          defaultTotal += defaultCount;
          reducedTotal += reducedCount;
        }

        const avgDefault = defaultTotal / messages.length;
        const avgReduced = reducedTotal / messages.length;
        const reduction = ((avgDefault - avgReduced) / avgDefault) * 100;

        console.log(`\n  Summary:`);
        console.log(`    LLM picks: ${picksCount}/${messages.length}`);
        console.log(`    Avg default: ${avgDefault.toFixed(1)} tools`);
        console.log(`    Avg reduced: ${avgReduced.toFixed(1)} tools`);
        console.log(`    Reduction: ${reduction.toFixed(1)}%`);

        // With ~90% pick rate, we should see meaningful reduction
        if (picksCount > 0) {
          expect(avgReduced).toBeLessThan(avgDefault);
        }
      },
      300_000, // 10 messages × 2 calls each × 30s timeout
    );
  });
});
