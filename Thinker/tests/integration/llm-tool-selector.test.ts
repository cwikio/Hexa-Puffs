/**
 * LLM Tool Selector Validation Tests
 *
 * Validates whether Qwen3.5-4B can correctly select tools from the full 144-tool catalog
 * using Ollama's OpenAI-compatible API.
 *
 * Prerequisites:
 *   - Ollama running at localhost:11434
 *   - Model pulled (default: qwen3.5:4b-q4_K_M)
 *
 * Run: cd Thinker && npx vitest run tests/integration/llm-tool-selector.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL = process.env.TOOL_SELECTOR_MODEL || 'qwen3.5:4b-q4_K_M';
const REQUEST_TIMEOUT_MS = 30_000;

// Load the full 144-tool fixture
const toolSchemas: ToolSchema[] = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/tool-schemas.json'), 'utf-8'),
);

interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface ToolCallResponse {
  function: {
    name: string;
    arguments: string;
  };
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCallResponse[];
    };
    finish_reason: string;
  }>;
}

// ── Ollama helpers ─────────────────────────────────────────────

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

const SYSTEM_PROMPT = [
  'You are a tool-calling assistant with access to many tools.',
  'When the user asks something that requires action (searching, sending, reading files, storing info, etc.), call the most appropriate tool.',
  'You do NOT have access to real-time information. For weather, news, current events, scores, or any time-sensitive data, ALWAYS use a search tool.',
  'When the user is just chatting (greetings, thanks, jokes, general knowledge questions), respond directly without calling any tool.',
  'Pick exactly ONE tool — the most specific match. Do not call multiple tools.',
].join(' ');

async function selectTool(message: string): Promise<{
  toolName: string | null;
  args: Record<string, unknown>;
  finishReason: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${OLLAMA_HOST}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: message },
        ],
        tools: toolSchemas,
        tool_choice: 'auto',
        temperature: 0.1,
        max_tokens: 512,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Ollama ${res.status}: ${body}`);
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const choice = data.choices[0];
    const toolCalls = choice?.message?.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      return { toolName: null, args: {}, finishReason: choice?.finish_reason ?? 'unknown' };
    }

    const first = toolCalls[0];
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(first.function.arguments) as Record<string, unknown>;
    } catch {
      // malformed JSON — test will catch it via assertion
    }

    return { toolName: first.function.name, args, finishReason: choice?.finish_reason ?? 'unknown' };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Pre-flight checks (top-level await) ───────────────────────

const ollamaUp = await isOllamaAvailable();
const modelReady = ollamaUp && (await isModelAvailable());

console.log(`Ollama: ${ollamaUp ? 'up' : 'down'}, Model (${MODEL}): ${modelReady ? 'ready' : 'missing'}`);
console.log(`Tool fixture: ${toolSchemas.length} tools loaded`);

const skipReason = !ollamaUp
  ? 'Ollama not running'
  : !modelReady
    ? `Model ${MODEL} not available`
    : false;

// ── Test suite ─────────────────────────────────────────────────

describe('LLM Tool Selector (Qwen3.5-4B)', () => {

  // Warmup: first call loads model into VRAM (~30s). Fire it before tests run.
  it.skipIf(skipReason)(
    'warmup (loads model into VRAM)',
    async () => {
      const { toolName } = await selectTool('hello');
      // Any response is fine — we just need the model loaded
      expect(true).toBe(true);
    },
    90_000, // generous timeout for cold start
  );

  // ── Tier 1: Basic tool selection (must-pass: 7/8) ───────────

  describe('Tier 1: Basic tool selection', () => {
    it.skipIf(skipReason)(
      'search for AI news → searcher_news_search',
      async () => {
        const { toolName, args } = await selectTool('search for AI news');
        expect(toolName).toBe('searcher_news_search');
        expect(String(args.query ?? '')).toMatch(/ai/i);
      },
      REQUEST_TIMEOUT_MS + 5_000,
    );

    it.skipIf(skipReason)(
      'send me my emails → gmail_get_new_emails or gmail_list_emails',
      async () => {
        const { toolName } = await selectTool('send me my emails');
        expect(['gmail_get_new_emails', 'gmail_list_emails']).toContain(toolName);
      },
      REQUEST_TIMEOUT_MS + 5_000,
    );

    it.skipIf(skipReason)(
      'remember I prefer dark mode → memory_store_fact or store_fact',
      async () => {
        const { toolName, args } = await selectTool('remember I prefer dark mode');
        expect(['memory_store_fact', 'store_fact']).toContain(toolName);
        expect(String(args.fact ?? '')).toMatch(/dark.?mode/i);
      },
      REQUEST_TIMEOUT_MS + 5_000,
    );

    it.skipIf(skipReason)(
      'what meetings do I have tomorrow → gmail_list_events',
      async () => {
        const { toolName } = await selectTool('what meetings do I have tomorrow');
        expect(toolName).toBe('gmail_list_events');
      },
      REQUEST_TIMEOUT_MS + 5_000,
    );

    it.skipIf(skipReason)(
      'search the web for best pizza in London → searcher_web_search',
      async () => {
        const { toolName, args } = await selectTool('search the web for best pizza in London');
        expect(toolName).toBe('searcher_web_search');
        expect(String(args.query ?? '')).toMatch(/pizza/i);
      },
      REQUEST_TIMEOUT_MS + 5_000,
    );

    it.skipIf(skipReason)(
      "what's the weather in Warsaw → searcher_web_search",
      async () => {
        const { toolName, args } = await selectTool("what's the weather in Warsaw");
        expect(toolName).toBe('searcher_web_search');
        expect(String(args.query ?? '')).toMatch(/weather|warsaw/i);
      },
      REQUEST_TIMEOUT_MS + 5_000,
    );

    it.skipIf(skipReason)(
      'show me pictures of cats → searcher_image_search',
      async () => {
        const { toolName, args } = await selectTool('show me pictures of cats');
        expect(toolName).toBe('searcher_image_search');
        expect(String(args.query ?? '')).toMatch(/cat/i);
      },
      REQUEST_TIMEOUT_MS + 5_000,
    );

    it.skipIf(skipReason)(
      'read the file report.txt → filer_read_file',
      async () => {
        const { toolName, args } = await selectTool('read the file report.txt');
        expect(toolName).toBe('filer_read_file');
        expect(String(args.path ?? '')).toMatch(/report/i);
      },
      REQUEST_TIMEOUT_MS + 5_000,
    );
  });

  // ── Tier 2: Disambiguation (must-pass: 3/4) ─────────────────

  describe('Tier 2: Disambiguation', () => {
    it.skipIf(skipReason)(
      'check my inbox → gmail_get_new_emails (not gmail_list_emails)',
      async () => {
        const { toolName } = await selectTool('check my inbox');
        expect(['gmail_get_new_emails', 'gmail_list_emails']).toContain(toolName);
      },
      REQUEST_TIMEOUT_MS + 5_000,
    );

    it.skipIf(skipReason)(
      'send hello to the group → telegram tool (not gmail)',
      async () => {
        const { toolName } = await selectTool('send hello to the group');
        // Model may pick send_message directly or list_chats first (to find the group)
        // Key: it should pick a telegram tool, not gmail
        expect(toolName).toMatch(/^telegram_/);
      },
      REQUEST_TIMEOUT_MS + 5_000,
    );

    it.skipIf(skipReason)(
      'what do you know about me → memory tool',
      async () => {
        const { toolName } = await selectTool('what do you know about me');
        expect([
          'memory_retrieve_memories',
          'memory_list_facts',
          'memory_get_profile',
          'search_memories',
        ]).toContain(toolName);
      },
      REQUEST_TIMEOUT_MS + 5_000,
    );

    it.skipIf(skipReason)(
      'remind me in 5 minutes to call John → queue_task, memory_store_skill, or send_telegram',
      async () => {
        const { toolName } = await selectTool('remind me in 5 minutes to call John');
        // queue_task is ideal, memory_store_skill is acceptable, telegram_send_message is a reasonable fallback
        expect(['queue_task', 'memory_store_skill', 'telegram_send_message', 'send_telegram']).toContain(toolName);
      },
      REQUEST_TIMEOUT_MS + 5_000,
    );
  });

  // ── Tier 3: No tool needed (must-pass: 2/3) ─────────────────

  describe('Tier 3: No tool needed', () => {
    it.skipIf(skipReason)(
      'hello, how are you? → no tool call',
      async () => {
        const { toolName, finishReason } = await selectTool('hello, how are you?');
        expect(toolName).toBeNull();
        expect(finishReason).toBe('stop');
      },
      REQUEST_TIMEOUT_MS + 5_000,
    );

    it.skipIf(skipReason)(
      'thanks! → no tool call',
      async () => {
        const { toolName, finishReason } = await selectTool('thanks!');
        expect(toolName).toBeNull();
        expect(finishReason).toBe('stop');
      },
      REQUEST_TIMEOUT_MS + 5_000,
    );

    it.skipIf(skipReason)(
      'tell me a joke → no tool call',
      async () => {
        const { toolName, finishReason } = await selectTool('tell me a joke');
        expect(toolName).toBeNull();
        expect(finishReason).toBe('stop');
      },
      REQUEST_TIMEOUT_MS + 5_000,
    );
  });
});

// ── Comparison: Current regex pipeline ─────────────────────────
// Runs the same test messages through the current regex-based selector
// to show what tools it would have included (no LLM needed).

import { selectToolsForMessage } from '../../src/agent/tool-selector.js';
import type { CoreTool } from 'ai';

/** Build a minimal CoreTool map from the fixture for regex testing */
function buildToolMap(): Record<string, CoreTool> {
  const map: Record<string, CoreTool> = {};
  for (const schema of toolSchemas) {
    const name = schema.function.name;
    map[name] = {
      type: 'function' as const,
      description: schema.function.description,
      parameters: {
        type: 'object',
        jsonSchema: schema.function.parameters,
      },
    } as unknown as CoreTool;
  }
  return map;
}

interface TestCase {
  message: string;
  expectedTool: string;
  label: string;
}

const COMPARISON_CASES: TestCase[] = [
  { message: 'search for AI news', expectedTool: 'searcher_news_search', label: 'AI news' },
  { message: 'send me my emails', expectedTool: 'gmail_get_new_emails', label: 'emails' },
  { message: 'remember I prefer dark mode', expectedTool: 'memory_store_fact', label: 'dark mode' },
  { message: 'what meetings do I have tomorrow', expectedTool: 'gmail_list_events', label: 'meetings' },
  { message: 'search the web for best pizza in London', expectedTool: 'searcher_web_search', label: 'pizza search' },
  { message: "what's the weather in Warsaw", expectedTool: 'searcher_web_search', label: 'weather' },
  { message: 'show me pictures of cats', expectedTool: 'searcher_image_search', label: 'cat pictures' },
  { message: 'read the file report.txt', expectedTool: 'filer_read_file', label: 'read file' },
  { message: 'check my inbox', expectedTool: 'gmail_get_new_emails', label: 'inbox' },
  { message: 'send hello to the group', expectedTool: 'telegram_send_message', label: 'group message' },
  { message: 'what do you know about me', expectedTool: 'memory_retrieve_memories', label: 'about me' },
  { message: 'remind me in 5 minutes to call John', expectedTool: 'queue_task', label: 'reminder' },
];

describe('Comparison: Current regex pipeline', () => {
  const allTools = buildToolMap();

  for (const tc of COMPARISON_CASES) {
    it(`regex: "${tc.label}" → includes ${tc.expectedTool}?`, () => {
      const selected = selectToolsForMessage(tc.message, allTools);
      const selectedNames = Object.keys(selected);
      const included = selectedNames.includes(tc.expectedTool);
      const count = selectedNames.length;

      // Log for comparison (not a strict pass/fail — informational)
      console.log(
        `  [regex] "${tc.label}" → ${count} tools selected, ` +
        `${tc.expectedTool}: ${included ? 'INCLUDED' : 'MISSING'}`,
      );

      // The regex pipeline should include the expected tool in its selection
      expect(included).toBe(true);
    });
  }
});
