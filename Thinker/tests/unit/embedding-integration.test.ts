/**
 * Integration test: exercises the real Ollama embedding provider
 * against the EmbeddingToolSelector with actual tool descriptions.
 *
 * Requires: Ollama running locally with nomic-embed-text model.
 * Skips gracefully if Ollama is not available.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createEmbeddingProvider, type EmbeddingConfig } from '@mcp/shared/Embeddings/index.js';
import { EmbeddingToolSelector } from '../../src/agent/embedding-tool-selector.js';
import type { CoreTool } from 'ai';

function makeTool(description: string): CoreTool {
  return { description, parameters: { type: 'object', properties: {} } } as unknown as CoreTool;
}

// Realistic tool set mimicking Thinker's actual tools
const TOOLS: Record<string, CoreTool> = {
  send_telegram: makeTool('Send a message to a Telegram chat'),
  store_fact: makeTool('Store a fact about the user in persistent memory'),
  search_memories: makeTool('Search stored memories and facts about the user'),
  get_status: makeTool('Get the status of all MCP servers'),
  spawn_subagent: makeTool('Spawn a sub-agent to handle a complex task'),
  searcher_web_search: makeTool('Search the web using Bing'),
  searcher_news_search: makeTool('Search recent news articles'),
  searcher_image_search: makeTool('Search for images on the web'),
  gmail_send_email: makeTool('Send an email via Gmail'),
  gmail_list_emails: makeTool('List emails in the Gmail inbox'),
  gmail_get_email: makeTool('Get full details of a specific email'),
  gmail_reply_email: makeTool('Reply to an existing email'),
  gmail_list_events: makeTool('List upcoming calendar events'),
  gmail_create_event: makeTool('Create a new calendar event'),
  filer_create_file: makeTool('Create a new file in the workspace'),
  filer_read_file: makeTool('Read the contents of a file'),
  filer_list_files: makeTool('List files in a directory'),
  onepassword_get_item: makeTool('Get a password or secret from 1Password vault'),
  telegram_send_media: makeTool('Send a photo or media file via Telegram'),
  codexec_execute_code: makeTool('Execute Python or JavaScript code'),
  create_job: makeTool('Create a recurring cron job or scheduled task'),
};

const CORE_TOOLS = ['send_telegram', 'store_fact', 'search_memories', 'get_status', 'spawn_subagent'];

const config: EmbeddingConfig = {
  provider: 'ollama',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'nomic-embed-text',
  lmstudioBaseUrl: 'http://localhost:1234/v1',
  lmstudioModel: 'text-embedding-nomic-embed-text-v1.5',
  huggingfaceModel: 'nomic-ai/nomic-embed-text-v1.5',
  dimensions: 768,
  vectorWeight: 0.6,
  textWeight: 0.4,
};

let selector: EmbeddingToolSelector | null = null;

async function ensureSelector(): Promise<EmbeddingToolSelector> {
  if (selector) return selector;
  throw new Error('Selector not initialized — Ollama likely unavailable');
}

beforeAll(async () => {
  try {
    const resp = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return;
  } catch {
    console.log('Ollama not available — embedding integration tests will fail with skip message');
    return;
  }

  const provider = createEmbeddingProvider(config)!;
  selector = new EmbeddingToolSelector(provider, {
    similarityThreshold: 0.3,
    topK: 15,
    minTools: 5,
  });
  await selector.initialize(TOOLS);
}, 30000);

function skipIfNoOllama() {
  if (!selector) {
    console.log('  → SKIPPED (Ollama not available)');
    return true;
  }
  return false;
}

describe('Embedding tool selector (live Ollama)', () => {
  it('selects search tools for "what is the weather today"', async () => {
    if (skipIfNoOllama()) return;
    const selected = await ensureSelector().then(s => s.selectTools('what is the weather today', TOOLS, CORE_TOOLS));
    const names = Object.keys(selected);
    console.log('  Weather query tools:', names);
    expect(names).toContain('searcher_web_search');
    expect(names).toContain('send_telegram');
  });

  it('selects email tools for "send an email to John"', async () => {
    if (skipIfNoOllama()) return;
    const selected = await ensureSelector().then(s => s.selectTools('send an email to John about the meeting', TOOLS, CORE_TOOLS));
    const names = Object.keys(selected);
    console.log('  Email query tools:', names);
    expect(names).toContain('gmail_send_email');
  });

  it('selects calendar tools for "what meetings do I have tomorrow"', async () => {
    if (skipIfNoOllama()) return;
    const selected = await ensureSelector().then(s => s.selectTools('what meetings do I have tomorrow', TOOLS, CORE_TOOLS));
    const names = Object.keys(selected);
    console.log('  Calendar query tools:', names);
    expect(names).toContain('gmail_list_events');
  });

  it('selects file tools for "create a new document"', async () => {
    if (skipIfNoOllama()) return;
    const selected = await ensureSelector().then(s => s.selectTools('create a new document in my workspace', TOOLS, CORE_TOOLS));
    const names = Object.keys(selected);
    console.log('  File query tools:', names);
    expect(names).toContain('filer_create_file');
  });

  it('selects code tools for "run some python code"', async () => {
    if (skipIfNoOllama()) return;
    const selected = await ensureSelector().then(s => s.selectTools('run this python script to calculate fibonacci', TOOLS, CORE_TOOLS));
    const names = Object.keys(selected);
    console.log('  Code query tools:', names);
    expect(names).toContain('codexec_execute_code');
  });

  it('selects memory tools for "what do you remember about me"', async () => {
    if (skipIfNoOllama()) return;
    const selected = await ensureSelector().then(s => s.selectTools('what do you remember about me', TOOLS, CORE_TOOLS));
    const names = Object.keys(selected);
    console.log('  Memory query tools:', names);
    expect(names).toContain('search_memories');
    expect(names).toContain('store_fact');
  });

  it('selects password tools for "get my password"', async () => {
    if (skipIfNoOllama()) return;
    const selected = await ensureSelector().then(s => s.selectTools('get my Netflix password from 1Password', TOOLS, CORE_TOOLS));
    const names = Object.keys(selected);
    console.log('  Password query tools:', names);
    expect(names).toContain('onepassword_get_item');
  });

  it('returns fewer than all tools (proves filtering is working)', async () => {
    if (skipIfNoOllama()) return;
    const selected = await ensureSelector().then(s => s.selectTools('send an email', TOOLS, CORE_TOOLS));
    const allCount = Object.keys(TOOLS).length;
    const selectedCount = Object.keys(selected).length;
    console.log(`  Filtering: ${selectedCount}/${allCount} tools selected`);
    expect(selectedCount).toBeLessThan(allCount);
    expect(selectedCount).toBeGreaterThanOrEqual(5);
  });
});
