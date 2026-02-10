/**
 * Unit tests for tool policy enforcement in ToolRouter.
 * Verifies allow/deny glob matching via isToolAllowed() and getFilteredToolDefinitions().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the logger before importing ToolRouter
vi.mock('@mcp/shared/Utils/logger.js', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { ToolRouter } from '../../src/routing/tool-router.js';
import type { IMCPClient, MCPToolDefinition } from '../../src/mcp-clients/types.js';

function createMockMCP(name: string, tools: MCPToolDefinition[]): IMCPClient {
  return {
    name,
    isAvailable: true,
    isRequired: false,
    isSensitive: false,
    initialize: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue(tools),
    callTool: vi.fn().mockResolvedValue({ success: true }),
  };
}

function makeTool(name: string): MCPToolDefinition {
  return {
    name,
    description: `Tool: ${name}`,
    inputSchema: { type: 'object' as const, properties: {} },
  };
}

describe('ToolRouter - isToolAllowed', () => {
  let router: ToolRouter;

  beforeEach(() => {
    router = new ToolRouter();
  });

  describe('no restrictions', () => {
    it('should allow everything when both lists are empty', () => {
      expect(router.isToolAllowed('telegram_send_message')).toBe(true);
      expect(router.isToolAllowed('gmail_send_email')).toBe(true);
      expect(router.isToolAllowed('anything')).toBe(true);
    });
  });

  describe('allowedTools only', () => {
    it('should allow tools matching the allow pattern', () => {
      expect(router.isToolAllowed('telegram_send_message', ['telegram_*'])).toBe(true);
      expect(router.isToolAllowed('telegram_get_messages', ['telegram_*'])).toBe(true);
    });

    it('should deny tools not matching the allow pattern', () => {
      expect(router.isToolAllowed('gmail_send_email', ['telegram_*'])).toBe(false);
      expect(router.isToolAllowed('web_search', ['telegram_*'])).toBe(false);
    });

    it('should support multiple allow patterns', () => {
      const allowed = ['telegram_*', 'gmail_*'];
      expect(router.isToolAllowed('telegram_send_message', allowed)).toBe(true);
      expect(router.isToolAllowed('gmail_send_email', allowed)).toBe(true);
      expect(router.isToolAllowed('web_search', allowed)).toBe(false);
    });

    it('should support exact tool name in allow list', () => {
      expect(router.isToolAllowed('web_search', ['web_search'])).toBe(true);
      expect(router.isToolAllowed('news_search', ['web_search'])).toBe(false);
    });
  });

  describe('deniedTools only', () => {
    it('should deny tools matching the deny pattern', () => {
      expect(router.isToolAllowed('gmail_send_email', [], ['gmail_*'])).toBe(false);
      expect(router.isToolAllowed('gmail_list_emails', [], ['gmail_*'])).toBe(false);
    });

    it('should allow tools not matching the deny pattern', () => {
      expect(router.isToolAllowed('telegram_send_message', [], ['gmail_*'])).toBe(true);
      expect(router.isToolAllowed('web_search', [], ['gmail_*'])).toBe(true);
    });
  });

  describe('allowedTools + deniedTools combined', () => {
    it('deny should override allow when both match', () => {
      // Allow all telegram tools, but deny telegram_delete_messages
      const allowed = ['telegram_*'];
      const denied = ['telegram_delete_messages'];

      expect(router.isToolAllowed('telegram_send_message', allowed, denied)).toBe(true);
      expect(router.isToolAllowed('telegram_delete_messages', allowed, denied)).toBe(false);
    });

    it('should deny tools not in allow list even if not in deny list', () => {
      const allowed = ['telegram_*'];
      const denied = ['gmail_*'];

      expect(router.isToolAllowed('web_search', allowed, denied)).toBe(false);
    });
  });

  describe('glob pattern edge cases', () => {
    it('should match suffix patterns', () => {
      expect(router.isToolAllowed('web_search', ['*_search'])).toBe(true);
      expect(router.isToolAllowed('news_search', ['*_search'])).toBe(true);
      expect(router.isToolAllowed('send_message', ['*_search'])).toBe(false);
    });

    it('should match middle wildcard patterns', () => {
      expect(router.isToolAllowed('get_email', ['get_*'])).toBe(true);
      expect(router.isToolAllowed('get_messages', ['get_*'])).toBe(true);
      expect(router.isToolAllowed('list_emails', ['get_*'])).toBe(false);
    });

    it('should match catch-all pattern', () => {
      expect(router.isToolAllowed('anything', ['*'])).toBe(true);
    });

    it('should match exact names without wildcards', () => {
      expect(router.isToolAllowed('store_fact', ['store_fact'])).toBe(true);
      expect(router.isToolAllowed('store_facts', ['store_fact'])).toBe(false);
    });
  });
});

describe('ToolRouter - getFilteredToolDefinitions', () => {
  let router: ToolRouter;

  beforeEach(async () => {
    router = new ToolRouter();

    const telegramMCP = createMockMCP('telegram', [
      makeTool('send_message'),
      makeTool('get_messages'),
      makeTool('list_chats'),
    ]);
    const gmailMCP = createMockMCP('gmail', [
      makeTool('send_email'),
      makeTool('list_emails'),
    ]);
    const searchMCP = createMockMCP('searcher', [
      makeTool('web_search'),
    ]);

    router.registerMCP('telegram', telegramMCP);
    router.registerMCP('gmail', gmailMCP);
    router.registerMCP('searcher', searchMCP);
    await router.discoverTools();
  });

  it('should return all tools when no filters', () => {
    const tools = router.getFilteredToolDefinitions();
    expect(tools).toHaveLength(6);
  });

  it('should filter by allowedTools', () => {
    const tools = router.getFilteredToolDefinitions(['send_*']);
    const names = tools.map((t) => t.name);

    expect(names).toContain('send_message');
    expect(names).toContain('send_email');
    expect(names).not.toContain('list_chats');
    expect(names).not.toContain('web_search');
  });

  it('should filter by deniedTools', () => {
    const tools = router.getFilteredToolDefinitions([], ['*_email*']);
    const names = tools.map((t) => t.name);

    expect(names).toContain('send_message');
    expect(names).toContain('web_search');
    expect(names).not.toContain('send_email');
    expect(names).not.toContain('list_emails');
  });

  it('should apply both allowedTools and deniedTools', () => {
    // Allow send_*, but deny send_email
    const tools = router.getFilteredToolDefinitions(['send_*'], ['send_email']);
    const names = tools.map((t) => t.name);

    expect(names).toEqual(['send_message']);
  });

  it('should return empty when nothing matches allowed', () => {
    const tools = router.getFilteredToolDefinitions(['nonexistent_*']);
    expect(tools).toHaveLength(0);
  });

  it('should return empty when everything is denied', () => {
    const tools = router.getFilteredToolDefinitions([], ['*']);
    expect(tools).toHaveLength(0);
  });
});
