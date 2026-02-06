import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetAllRoutes = vi.hoisted(() => vi.fn());
const mockGetToolDefinitions = vi.hoisted(() => vi.fn());

vi.mock('../../src/core/orchestrator.js', () => ({
  getOrchestrator: vi.fn().mockResolvedValue({
    getToolRouter: () => ({
      getAllRoutes: mockGetAllRoutes,
      getToolDefinitions: mockGetToolDefinitions,
    }),
  }),
}));

import { handleGetToolCatalog } from '../../src/tools/tool-catalog.js';

interface CatalogData {
  summary: string;
  catalog: Record<string, Array<{ name: string; description: string }>>;
}

describe('handleGetToolCatalog', () => {
  beforeEach(() => {
    mockGetAllRoutes.mockReset();
    mockGetToolDefinitions.mockReset();
  });

  it('should group tools by MCP name', async () => {
    mockGetAllRoutes.mockReturnValue([
      { exposedName: 'telegram_send_message', mcpName: 'telegram', originalName: 'send_message' },
      { exposedName: 'telegram_get_messages', mcpName: 'telegram', originalName: 'get_messages' },
      { exposedName: 'gmail_send_email', mcpName: 'gmail', originalName: 'send_email' },
    ]);
    mockGetToolDefinitions.mockReturnValue([
      { name: 'telegram_send_message', description: 'Send a message via Telegram. Supports rich text.', inputSchema: { type: 'object', properties: {} } },
      { name: 'telegram_get_messages', description: 'Get messages from a chat', inputSchema: { type: 'object', properties: {} } },
      { name: 'gmail_send_email', description: 'Send an email via Gmail', inputSchema: { type: 'object', properties: {} } },
    ]);

    const result = await handleGetToolCatalog();
    const data = result.data as CatalogData;

    expect(result.success).toBe(true);
    expect(data.summary).toBe('3 tools across 2 MCP servers');
    expect(data.catalog.telegram).toHaveLength(2);
    expect(data.catalog.gmail).toHaveLength(1);
  });

  it('should take only the first sentence of descriptions', async () => {
    mockGetAllRoutes.mockReturnValue([
      { exposedName: 'telegram_send_message', mcpName: 'telegram', originalName: 'send_message' },
    ]);
    mockGetToolDefinitions.mockReturnValue([
      { name: 'telegram_send_message', description: 'Send a message via Telegram. Supports rich text and markdown formatting.', inputSchema: { type: 'object', properties: {} } },
    ]);

    const result = await handleGetToolCatalog();
    const data = result.data as CatalogData;

    expect(data.catalog.telegram[0].description).toBe('Send a message via Telegram.');
  });

  it('should sort tools alphabetically within each group', async () => {
    mockGetAllRoutes.mockReturnValue([
      { exposedName: 'memory_store_fact', mcpName: 'memory', originalName: 'store_fact' },
      { exposedName: 'memory_list_facts', mcpName: 'memory', originalName: 'list_facts' },
      { exposedName: 'memory_delete_fact', mcpName: 'memory', originalName: 'delete_fact' },
    ]);
    mockGetToolDefinitions.mockReturnValue([
      { name: 'memory_store_fact', description: 'Store a fact', inputSchema: { type: 'object', properties: {} } },
      { name: 'memory_list_facts', description: 'List facts', inputSchema: { type: 'object', properties: {} } },
      { name: 'memory_delete_fact', description: 'Delete a fact', inputSchema: { type: 'object', properties: {} } },
    ]);

    const result = await handleGetToolCatalog();
    const data = result.data as CatalogData;
    const names = data.catalog.memory.map((t) => t.name);

    expect(names).toEqual(['memory_delete_fact', 'memory_list_facts', 'memory_store_fact']);
  });

  it('should return (no description) for tools without matching definitions', async () => {
    mockGetAllRoutes.mockReturnValue([
      { exposedName: 'orphan_tool', mcpName: 'orphan', originalName: 'tool' },
    ]);
    mockGetToolDefinitions.mockReturnValue([]);

    const result = await handleGetToolCatalog();
    const data = result.data as CatalogData;

    expect(data.catalog.orphan[0].description).toBe('(no description)');
  });

  it('should handle empty tool list', async () => {
    mockGetAllRoutes.mockReturnValue([]);
    mockGetToolDefinitions.mockReturnValue([]);

    const result = await handleGetToolCatalog();
    const data = result.data as CatalogData;

    expect(result.success).toBe(true);
    expect(data.summary).toBe('0 tools across 0 MCP servers');
    expect(data.catalog).toEqual({});
  });

  it('should return error on orchestrator failure', async () => {
    mockGetAllRoutes.mockImplementation(() => {
      throw new Error('Connection lost');
    });

    const result = await handleGetToolCatalog();

    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection lost');
  });

  it('should add trailing period to descriptions without one', async () => {
    mockGetAllRoutes.mockReturnValue([
      { exposedName: 'test_tool', mcpName: 'test', originalName: 'tool' },
    ]);
    mockGetToolDefinitions.mockReturnValue([
      { name: 'test_tool', description: 'A tool that does stuff', inputSchema: { type: 'object', properties: {} } },
    ]);

    const result = await handleGetToolCatalog();
    const data = result.data as CatalogData;

    expect(data.catalog.test[0].description).toBe('A tool that does stuff.');
  });
});
