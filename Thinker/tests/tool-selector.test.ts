/**
 * Unit tests for the regex-based tool selector.
 *
 * Tests keyword routing, group activation, glob expansion,
 * and the default fallback behavior.
 */

import { describe, it, expect } from 'vitest';
import type { CoreTool } from 'ai';
import { selectToolsForMessage } from '../src/agent/tool-selector.js';

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

// A realistic set of tool names matching the production setup
const ALL_TOOL_NAMES = [
  // Core
  'send_telegram', 'store_fact', 'search_memories', 'get_status', 'spawn_subagent',
  // Search
  'searcher_web_search', 'searcher_news_search', 'searcher_image_search', 'searcher_web_fetch',
  // Memory (glob-matched)
  'memory_list_facts', 'memory_store_fact', 'memory_retrieve_memories',
  'memory_list_contacts', 'memory_create_contact', 'memory_list_projects',
  'memory_store_skill', 'memory_list_skills',
  // Email
  'gmail_list_emails', 'gmail_get_email', 'gmail_send_email', 'gmail_reply_email',
  'gmail_mark_read', 'gmail_get_new_emails', 'gmail_delete_email',
  // Calendar
  'gmail_list_events', 'gmail_get_event', 'gmail_create_event',
  'gmail_list_calendars', 'gmail_find_free_time',
  // Telegram (glob-matched)
  'telegram_send_message', 'telegram_send_media',
  // Filer (glob-matched)
  'filer_create_file', 'filer_read_file', 'filer_list_files',
  // 1Password (glob-matched)
  'onepassword_get_item', 'onepassword_list_items',
  // Browser
  'web_browser_navigate', 'web_browser_snapshot', 'web_browser_click',
  // Jobs
  'create_job', 'queue_task', 'list_jobs', 'get_job_status', 'delete_job',
  // CodeExec (glob-matched)
  'codexec_execute_code', 'codexec_list_runtimes',
];

const ALL_TOOLS = buildToolMap(ALL_TOOL_NAMES);

const CORE_TOOLS = ['send_telegram', 'store_fact', 'search_memories', 'get_status', 'spawn_subagent'];

describe('selectToolsForMessage', () => {
  // ─── Core tools ──────────────────────────────────────────────
  describe('core tools', () => {
    it('should always include core tools regardless of message', () => {
      const result = selectToolsForMessage('hello', ALL_TOOLS);
      for (const name of CORE_TOOLS) {
        expect(result).toHaveProperty(name);
      }
    });

    it('should include core tools even with a keyword match', () => {
      const result = selectToolsForMessage('check my email', ALL_TOOLS);
      for (const name of CORE_TOOLS) {
        expect(result).toHaveProperty(name);
      }
    });
  });

  // ─── Keyword routing ─────────────────────────────────────────
  describe('keyword routing', () => {
    it('should activate search group for "search" keyword', () => {
      const result = selectToolsForMessage('search for cats', ALL_TOOLS);
      expect(result).toHaveProperty('searcher_web_search');
      expect(result).toHaveProperty('searcher_news_search');
      expect(result).toHaveProperty('searcher_image_search');
    });

    it('should activate email group for "email" keyword', () => {
      const result = selectToolsForMessage('check my email', ALL_TOOLS);
      expect(result).toHaveProperty('gmail_list_emails');
      expect(result).toHaveProperty('gmail_send_email');
    });

    it('should activate calendar group for "meeting" keyword', () => {
      const result = selectToolsForMessage('when is my next meeting?', ALL_TOOLS);
      expect(result).toHaveProperty('gmail_list_events');
      expect(result).toHaveProperty('gmail_create_event');
    });

    it('should activate memory group for "remember" keyword', () => {
      const result = selectToolsForMessage('do you remember my name?', ALL_TOOLS);
      expect(result).toHaveProperty('memory_list_facts');
      expect(result).toHaveProperty('memory_retrieve_memories');
    });

    it('should activate files group for "file" keyword', () => {
      const result = selectToolsForMessage('save this to a file', ALL_TOOLS);
      expect(result).toHaveProperty('filer_create_file');
      expect(result).toHaveProperty('filer_read_file');
    });

    it('should activate passwords group for "password" keyword', () => {
      const result = selectToolsForMessage('find my password for github', ALL_TOOLS);
      expect(result).toHaveProperty('onepassword_get_item');
    });

    it('should activate codexec group for "code" keyword', () => {
      const result = selectToolsForMessage('run this code for me', ALL_TOOLS);
      expect(result).toHaveProperty('codexec_execute_code');
    });

    it('should activate jobs group for "remind me" keyword', () => {
      const result = selectToolsForMessage('remind me every day at 9am', ALL_TOOLS);
      expect(result).toHaveProperty('create_job');
      expect(result).toHaveProperty('list_jobs');
    });
  });

  // ─── Multi-group routes ──────────────────────────────────────
  describe('multi-group routes', () => {
    it('should activate both search and telegram for "photo" keyword', () => {
      const result = selectToolsForMessage('show me a photo of a cat', ALL_TOOLS);
      expect(result).toHaveProperty('searcher_image_search');
      expect(result).toHaveProperty('telegram_send_media');
    });

    it('should activate both browser and search for "browse" keyword', () => {
      const result = selectToolsForMessage('browse this website', ALL_TOOLS);
      expect(result).toHaveProperty('web_browser_navigate');
      expect(result).toHaveProperty('searcher_web_search');
    });

    it('should activate browser+search for URL patterns', () => {
      const result = selectToolsForMessage('go to https://example.com', ALL_TOOLS);
      expect(result).toHaveProperty('web_browser_navigate');
      expect(result).toHaveProperty('searcher_web_fetch');
    });
  });

  // ─── Default groups ──────────────────────────────────────────
  describe('default groups (no keyword match)', () => {
    it('should activate search and memory for generic messages', () => {
      const result = selectToolsForMessage('hello there', ALL_TOOLS);
      expect(result).toHaveProperty('searcher_web_search');
      expect(result).toHaveProperty('memory_list_facts');
    });

    it('should NOT activate email for generic messages', () => {
      const result = selectToolsForMessage('hello there', ALL_TOOLS);
      expect(result).not.toHaveProperty('gmail_list_emails');
    });
  });

  // ─── Glob expansion ─────────────────────────────────────────
  describe('glob expansion', () => {
    it('should expand memory_* to all memory tools', () => {
      const result = selectToolsForMessage('what do you know about me?', ALL_TOOLS);
      expect(result).toHaveProperty('memory_list_facts');
      expect(result).toHaveProperty('memory_store_fact');
      expect(result).toHaveProperty('memory_retrieve_memories');
      expect(result).toHaveProperty('memory_list_contacts');
    });

    it('should expand telegram_* to all telegram tools', () => {
      const result = selectToolsForMessage('send a telegram message', ALL_TOOLS);
      expect(result).toHaveProperty('telegram_send_message');
      expect(result).toHaveProperty('telegram_send_media');
    });

    it('should expand codexec_* to all codexec tools', () => {
      const result = selectToolsForMessage('execute this python script', ALL_TOOLS);
      expect(result).toHaveProperty('codexec_execute_code');
      expect(result).toHaveProperty('codexec_list_runtimes');
    });
  });

  // ─── Edge cases ──────────────────────────────────────────────
  describe('edge cases', () => {
    it('should only include tools that exist in the tool map', () => {
      const smallMap = buildToolMap(['send_telegram', 'store_fact', 'searcher_web_search']);
      const result = selectToolsForMessage('search for something', smallMap);
      // Should have the tools that exist
      expect(result).toHaveProperty('searcher_web_search');
      // Should NOT have tools that don't exist in the map
      expect(result).not.toHaveProperty('searcher_news_search');
    });

    it('should handle empty tool map gracefully', () => {
      const result = selectToolsForMessage('hello', {});
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should handle empty message', () => {
      const result = selectToolsForMessage('', ALL_TOOLS);
      // Empty message matches no keywords → default groups
      expect(result).toHaveProperty('searcher_web_search');
      expect(result).toHaveProperty('memory_list_facts');
    });

    it('should match core-only routes like "status"', () => {
      const result = selectToolsForMessage('what is your status?', ALL_TOOLS);
      // "status" matches core-only route AND "what is" matches search
      expect(result).toHaveProperty('get_status');
    });

    it('should match Polish keywords for memory', () => {
      const result = selectToolsForMessage('co o mnie wiesz?', ALL_TOOLS);
      expect(result).toHaveProperty('memory_list_facts');
    });
  });

  // ─── Dynamic metadata groups ──────────────────────────────────
  describe('metadata-driven dynamic groups', () => {
    const EXTENDED_TOOLS = buildToolMap([
      ...ALL_TOOL_NAMES,
      'newmcp_do_thing', 'newmcp_do_other',
    ]);

    const mcpMetadata = {
      newmcp: {
        label: 'New MCP',
        toolGroup: 'Custom',
        keywords: ['newthing', 'custom action'],
      },
    };

    it('should auto-generate group for MCP not in hardcoded map', () => {
      // "newthing" matches the metadata keyword for newmcp
      const result = selectToolsForMessage('do a newthing', EXTENDED_TOOLS, mcpMetadata);
      expect(result).toHaveProperty('newmcp_do_thing');
      expect(result).toHaveProperty('newmcp_do_other');
    });

    it('should not generate duplicate routes for MCPs already in hardcoded routes', () => {
      // "telegram" is already in KEYWORD_ROUTES → no duplicate route from metadata
      const metaWithExisting = {
        telegram: { keywords: ['telegram', 'message'] },
      };
      const result = selectToolsForMessage('send telegram', ALL_TOOLS, metaWithExisting);
      expect(result).toHaveProperty('telegram_send_message');
    });

    it('should fall back to default groups when no metadata keywords match', () => {
      const result = selectToolsForMessage('hello there', EXTENDED_TOOLS, mcpMetadata);
      // Default groups: search + memory
      expect(result).toHaveProperty('searcher_web_search');
      expect(result).toHaveProperty('memory_list_facts');
      // New MCP tools should NOT be included for generic messages
      expect(result).not.toHaveProperty('newmcp_do_thing');
    });

    it('should work with undefined mcpMetadata (backward compat)', () => {
      const result = selectToolsForMessage('search for cats', ALL_TOOLS, undefined);
      expect(result).toHaveProperty('searcher_web_search');
    });
  });
});
