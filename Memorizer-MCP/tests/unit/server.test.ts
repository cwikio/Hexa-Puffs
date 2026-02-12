/**
 * Unit tests for Memorizer MCP server registration + annotations.
 * Uses InMemoryTransport — does NOT require a running server.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// Mock the database before importing server — use importOriginal to keep
// all constant exports (FACT_CATEGORIES, TRIGGER_TYPES, CONTACT_TYPES, etc.)
// in sync with the real module, only overriding runtime functions.
vi.mock('../../src/db/index.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getDatabase: vi.fn(),
    generateId: vi.fn(() => 'test-id'),
  };
});

// Mock the fact extractor
vi.mock('../../src/services/fact-extractor.js', () => ({
  getFactExtractor: vi.fn(),
}));

// Mock the sanitizer
vi.mock('../../src/services/sanitizer.js', () => ({
  isFactSafe: vi.fn(() => true),
}));

// Mock the config
vi.mock('../../src/config/index.js', () => ({
  getConfig: vi.fn(() => ({
    database: { path: '/tmp/test.db' },
    export: { path: '/tmp/export' },
    embedding: {
      provider: 'none',
      vectorWeight: 0.6,
      textWeight: 0.4,
    },
  })),
}));

// Mock the embeddings
vi.mock('../../src/embeddings/index.js', () => ({
  getEmbeddingProvider: vi.fn(() => null),
  isVectorSearchEnabled: vi.fn(() => false),
}));

vi.mock('../../src/embeddings/fact-embeddings.js', () => ({
  embedFact: vi.fn(),
  reembedFact: vi.fn(),
  deleteFactEmbedding: vi.fn(),
}));

// Mock the logger
vi.mock('@mcp/shared/Utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { createServer } from '../../src/server.js';

const EXPECTED_TOOLS = [
  'store_fact',
  'list_facts',
  'delete_fact',
  'update_fact',
  'store_conversation',
  'search_conversations',
  'get_profile',
  'update_profile',
  'retrieve_memories',
  'get_memory_stats',
  'export_memory',
  'import_memory',
  'store_skill',
  'list_skills',
  'get_skill',
  'update_skill',
  'delete_skill',
  'backfill_extract_facts',
  'synthesize_facts',
  'backfill_embeddings',
  'create_contact',
  'list_contacts',
  'update_contact',
  'create_project',
  'list_projects',
  'update_project',
  'query_timeline',
];

const READ_ONLY_TOOLS = [
  'list_facts',
  'search_conversations',
  'get_profile',
  'retrieve_memories',
  'get_memory_stats',
  'export_memory',
  'list_skills',
  'get_skill',
  'list_contacts',
  'list_projects',
  'query_timeline',
];

const DESTRUCTIVE_TOOLS = [
  'delete_fact',
  'import_memory',
  'delete_skill',
  'synthesize_facts',
];

describe('Memorizer MCP Server Registration', () => {
  let client: Client;
  let tools: Tool[];

  beforeAll(async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);

    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);

    const result = await client.listTools();
    tools = result.tools;
  });

  afterAll(async () => {
    await client.close();
  });

  it('should register all 27 tools', () => {
    expect(tools).toHaveLength(27);
  });

  it('should register tools with correct names', () => {
    const toolNames = tools.map(t => t.name).sort();
    expect(toolNames).toEqual([...EXPECTED_TOOLS].sort());
  });

  it('should have non-empty descriptions on all tools', () => {
    for (const tool of tools) {
      expect(tool.description, `${tool.name} should have a description`).toBeTruthy();
      expect(tool.description!.length, `${tool.name} description should not be empty`).toBeGreaterThan(0);
    }
  });

  it('should have annotations on all tools', () => {
    for (const tool of tools) {
      expect(tool.annotations, `${tool.name} should have annotations`).toBeDefined();
    }
  });

  it('should mark read-only tools correctly', () => {
    for (const tool of tools) {
      const expected = READ_ONLY_TOOLS.includes(tool.name);
      expect(
        tool.annotations?.readOnlyHint,
        `${tool.name} readOnlyHint should be ${expected}`
      ).toBe(expected);
    }
  });

  it('should mark destructive tools correctly', () => {
    for (const tool of tools) {
      const expected = DESTRUCTIVE_TOOLS.includes(tool.name);
      expect(
        tool.annotations?.destructiveHint,
        `${tool.name} destructiveHint should be ${expected}`
      ).toBe(expected);
    }
  });

  it('should mark all tools as closed-world (local SQLite)', () => {
    for (const tool of tools) {
      expect(
        tool.annotations?.openWorldHint,
        `${tool.name} openWorldHint should be false`
      ).toBe(false);
    }
  });

  it('should have input schemas on all tools', () => {
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} should have an inputSchema`).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  });
});
