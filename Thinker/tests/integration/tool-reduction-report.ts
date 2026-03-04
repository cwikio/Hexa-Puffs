/**
 * Tool Reduction Report Generator
 *
 * Runs the full pipeline (4B LLM → embedding+regex → cap → sticky/playbook)
 * and exports a detailed markdown table showing every tool passed to Groq.
 *
 * Run: cd Thinker && npx tsx tests/integration/tool-reduction-report.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import type { CoreTool } from 'ai';
import { jsonSchema } from 'ai';
import { EmbeddingConfigSchema, createEmbeddingProvider } from '@mcp/shared/Embeddings/index.js';
import { EmbeddingToolSelector } from '../../src/agent/embedding-tool-selector.js';
import { ToolSelector } from '../../src/agent/components/tool-selector.js';
import { CORE_TOOL_NAMES, REDUCED_CORE_TOOL_NAMES } from '../../src/agent/tool-selection.js';
import { LlmToolSelector } from '../../src/agent/components/llm-tool-selector.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL = process.env.TOOL_SELECTOR_MODEL || 'qwen3.5:4b-q4_K_M';

const MESSAGES = [
  'search for AI news',
  'send an email to bob about the project update',
  'what meetings do I have tomorrow',
  'read the file report.txt',
  'remember I like dark mode',
  'show me pictures of cats',
  'what do you know about me',
  'check my password vault for github',
  'navigate to google.com and take a screenshot',
  'run the python script',
  'delete the spam email from my inbox',
  'create a new calendar event for Friday at 3pm',
  'send a message to the family group on telegram',
  'what is the weather in Warsaw',
  'save this note to my workspace',
  'hello how are you',
  'remind me every morning to check email',
  'find a picture of sunset and send it to the group',
  'who is the president of France',
  'browse to amazon.com and search for headphones',
];

// ── Load fixture ────────────────────────────────────────────────

interface FixtureSchema {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

const fixtureSchemas: FixtureSchema[] = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/tool-schemas.json'), 'utf-8'),
);

function buildToolMap(): Record<string, CoreTool> {
  const map: Record<string, CoreTool> = {};
  for (const schema of fixtureSchemas) {
    map[schema.function.name] = {
      type: 'function' as const,
      description: schema.function.description,
      parameters: jsonSchema(schema.function.parameters),
    } as unknown as CoreTool;
  }
  return map;
}

// ── Helpers ─────────────────────────────────────────────────────

interface CategorizedTool {
  name: string;
  score: number | null; // embedding similarity score, null if not scored
}

function categorizeTools(
  names: string[],
  llmPick: string | null,
  scores: Map<string, number> | null,
): {
  core: CategorizedTool[];
  llmPick: CategorizedTool[];
  contextual: CategorizedTool[];
} {
  const coreSet = new Set(CORE_TOOL_NAMES);
  const core: CategorizedTool[] = [];
  const pick: CategorizedTool[] = [];
  const contextual: CategorizedTool[] = [];

  for (const name of names) {
    const score = scores?.get(name) ?? null;
    const entry = { name, score };
    if (name === llmPick) {
      pick.push(entry);
    } else if (coreSet.has(name)) {
      core.push(entry);
    } else {
      contextual.push(entry);
    }
  }

  // Sort contextual by score descending (highest similarity first)
  contextual.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  core.sort((a, b) => a.name.localeCompare(b.name));

  return { core, llmPick: pick, contextual };
}

function formatToolWithScore(t: CategorizedTool): string {
  if (t.score !== null) {
    return `\`${t.name}\` (${t.score.toFixed(3)})`;
  }
  return `\`${t.name}\``;
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  console.log('Loading tools...');
  const allTools = buildToolMap();
  console.log(`Loaded ${Object.keys(allTools).length} tools`);

  // Initialize real Ollama embedding provider (nomic-embed-text)
  const embeddingConfig = EmbeddingConfigSchema.parse({
    provider: 'ollama',
    ollamaBaseUrl: OLLAMA_HOST,
  });
  const provider = createEmbeddingProvider(embeddingConfig);
  if (!provider) {
    console.error('Failed to create embedding provider');
    process.exit(1);
  }

  const cachePath = join(homedir(), '.hexa-puffs/data/embedding-cache.json');
  const embeddingSelector = new EmbeddingToolSelector(provider, {
    similarityThreshold: 0.4,
    topK: 8,
    minTools: 5,
    cachePath,
    providerName: 'ollama',
    modelName: 'nomic-embed-text',
  });
  console.log('Initializing embeddings (cached after first run)...');
  await embeddingSelector.initialize(allTools);

  const toolSelector = new ToolSelector(embeddingSelector, allTools, undefined);

  // Initialize LLM selector
  console.log('Initializing LLM selector...');
  const llmSelector = new LlmToolSelector({
    host: OLLAMA_HOST,
    model: MODEL,
    timeoutMs: 60_000, // 60s to handle cold start / slow first inferences
    enabled: true,
  });
  await llmSelector.initialize();
  llmSelector.updateToolSchemas(allTools);

  if (!llmSelector.isAvailable()) {
    console.error('Ollama not available — cannot generate report');
    process.exit(1);
  }

  // Warmup
  console.log('Warming up model...');
  await llmSelector.selectFirstTool('hello', allTools);

  // ── Run pipeline for each message ─────────────────────────────

  interface Result {
    message: string;
    llmPick: string | null;
    llmPickConfirmed: boolean; // true if embedding+regex independently selected the LLM pick
    defaultTools: string[];
    reducedTools: string[];
    scores: Map<string, number> | null; // embedding similarity scores from the reduced run
  }

  const results: Result[] = [];

  for (let i = 0; i < MESSAGES.length; i++) {
    const msg = MESSAGES[i];
    process.stdout.write(`[${i + 1}/${MESSAGES.length}] "${msg}"...`);

    const llmPick = await llmSelector.selectFirstTool(msg, allTools);

    // Default pipeline (no reduction)
    const defaultResult = await toolSelector.selectTools(msg, [], [], undefined);
    const defaultNames = Object.keys(defaultResult);

    // Reduced pipeline (when LLM picks)
    const reducedResult = await toolSelector.selectTools(
      msg, [], [],
      llmPick ? { maxTools: 15, coreToolNames: REDUCED_CORE_TOOL_NAMES } : undefined,
    );
    // Capture scores right after selection (before they get overwritten by next call)
    const scores = embeddingSelector.getLastScores();
    // Check if LLM pick was independently confirmed by embedding+regex
    const llmPickConfirmed = llmPick ? llmPick.toolName in reducedResult : false;
    // Inject LLM pick (like loop.ts does)
    if (llmPick && !reducedResult[llmPick.toolName] && allTools[llmPick.toolName]) {
      reducedResult[llmPick.toolName] = allTools[llmPick.toolName];
    }
    const reducedNames = Object.keys(reducedResult);

    results.push({
      message: msg,
      llmPick: llmPick?.toolName ?? null,
      llmPickConfirmed,
      defaultTools: defaultNames.sort(),
      reducedTools: reducedNames.sort(),
      scores: scores ? new Map(scores) : null, // clone since it gets overwritten
    });

    console.log(` pick=${llmPick?.toolName ?? 'null'}, default=${defaultNames.length}, reduced=${reducedNames.length}`);
  }

  // ── Generate Markdown ─────────────────────────────────────────

  const lines: string[] = [];

  lines.push('# Tool Reduction Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Model: ${MODEL}`);
  lines.push(`Total tools in catalog: ${Object.keys(allTools).length}`);
  lines.push('');

  // Summary table
  lines.push('## Summary');
  lines.push('');
  lines.push('| # | Message | LLM Pick | Confirmed | Default | Reduced | Saved |');
  lines.push('|---|---------|----------|-----------|---------|---------|-------|');

  let totalDefault = 0;
  let totalReduced = 0;
  let picksCount = 0;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const saved = r.defaultTools.length - r.reducedTools.length;
    const pick = r.llmPick ? `\`${r.llmPick}\`` : '_null_';
    if (r.llmPick) picksCount++;
    totalDefault += r.defaultTools.length;
    totalReduced += r.reducedTools.length;
    const confirmed = r.llmPick ? (r.llmPickConfirmed ? 'yes' : 'no') : '-';
    lines.push(`| ${i + 1} | ${r.message} | ${pick} | ${confirmed} | ${r.defaultTools.length} | ${r.reducedTools.length} | ${saved > 0 ? `-${saved}` : '0'} |`);
  }

  const avgDefault = totalDefault / results.length;
  const avgReduced = totalReduced / results.length;
  const reduction = ((avgDefault - avgReduced) / avgDefault) * 100;

  lines.push('');
  lines.push(`**LLM picks:** ${picksCount}/${results.length} (${((picksCount / results.length) * 100).toFixed(0)}%)`);
  lines.push(`**Average tools — default:** ${avgDefault.toFixed(1)}, **reduced:** ${avgReduced.toFixed(1)}, **reduction:** ${reduction.toFixed(1)}%`);
  lines.push('');

  // Detailed tool lists (reduced pipeline — what actually gets sent to Groq)
  lines.push('## Detailed Tool Lists (Reduced Pipeline → sent to Groq)');
  lines.push('');
  lines.push('> **Core tools** = always-included safety-net tools (e.g. `send_telegram`, `searcher_web_search`)');
  lines.push('>');
  lines.push('> **Regex + Embedding tools** = contextual tools selected by keyword regex matching and vector embedding similarity, sorted by embedding similarity score (highest first)');
  lines.push('>');
  lines.push('> Score in parentheses = cosine similarity to the user message (nomic-embed-text via Ollama)');
  lines.push('');

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const cats = categorizeTools(r.reducedTools, r.llmPick, r.scores);

    lines.push(`### ${i + 1}. "${r.message}"`);
    lines.push('');
    const pickLabel = r.llmPick
      ? `\`${r.llmPick}\` — ${r.llmPickConfirmed ? 'confirmed by embeddings' : 'NOT in embedding results (injected)'}`
      : '_null (no reduction applied)_';
    lines.push(`- **LLM Pick (4B):** ${pickLabel}`);
    lines.push(`- **Total tools sent to Groq:** ${r.reducedTools.length}`);
    lines.push('');

    if (cats.core.length > 0) {
      lines.push(`**Core tools (${cats.core.length}):** ${cats.core.map(t => `\`${t.name}\``).join(', ')}`);
      lines.push('');
    }

    if (cats.contextual.length > 0) {
      lines.push(`**Regex + Embedding tools (${cats.contextual.length}):**`);
      for (const t of cats.contextual) {
        lines.push(`- ${formatToolWithScore(t)}`);
      }
      lines.push('');
    }

    // Show what was dropped vs default
    const dropped = r.defaultTools.filter(t => !r.reducedTools.includes(t));
    if (dropped.length > 0) {
      lines.push(`**Dropped vs default (${dropped.length}):** ~~\`${dropped.join('`~~, ~~`')}\`~~`);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  // Write to file
  const outputPath = resolve(__dirname, '../../tool-reduction-report.md');
  writeFileSync(outputPath, lines.join('\n'), 'utf-8');
  console.log(`\nReport written to: ${outputPath}`);
}

main().catch((err) => {
  console.error('Report generation failed:', err);
  process.exit(1);
});
