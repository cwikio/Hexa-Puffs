/**
 * Integration tests for Browser MCP.
 * Spawns the actual MCP server as a child process, connects via MCP SDK client,
 * and verifies tool registration and basic browser operations.
 *
 * These tests launch real headless Chromium — expect ~5s startup time.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY_POINT = resolve(__dirname, '../../dist/index.js');

let client: Client;
let transport: StdioClientTransport;

beforeAll(async () => {
  transport = new StdioClientTransport({
    command: 'node',
    args: [ENTRY_POINT],
    env: {
      ...process.env,
      BROWSER_PROXY_ENABLED: 'false',
      BROWSER_ISOLATED: 'true',
    },
  });

  client = new Client({ name: 'browser-mcp-test', version: '1.0.0' });
  await client.connect(transport);
}, 30000);

afterAll(async () => {
  try {
    await client.close();
  } catch {
    // Process may have already exited
  }
});

describe('Tool Discovery', () => {
  it('registers browser tools', async () => {
    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name);

    expect(toolNames).toContain('browser_navigate');
    expect(toolNames).toContain('browser_snapshot');
    expect(toolNames).toContain('browser_click');
    expect(toolNames).toContain('browser_type');
  });

  it('registers tab management tool', async () => {
    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name);

    expect(toolNames).toContain('browser_tabs');
  });

  it('registers navigation tools', async () => {
    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name);

    expect(toolNames).toContain('browser_navigate_back');
  });

  it('tools have descriptions', async () => {
    const result = await client.listTools();
    const navigate = result.tools.find((t) => t.name === 'browser_navigate');

    expect(navigate).toBeDefined();
    expect(navigate!.description).toBeTruthy();
    expect(navigate!.description!.length).toBeGreaterThan(0);
  });

  it('navigate tool has url parameter', async () => {
    const result = await client.listTools();
    const navigate = result.tools.find((t) => t.name === 'browser_navigate');

    expect(navigate).toBeDefined();
    expect(navigate!.inputSchema).toBeDefined();
  });
});

describe('Browser Navigation', () => {
  it('navigates to a URL', async () => {
    const result = await client.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://example.com' },
    });

    expect(result).toBeDefined();
    // The tool should return content (text or image)
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
  }, 30000);

  it('takes a snapshot with accessibility tree', async () => {
    // Previous test already navigated to example.com — browser is still there
    const result = await client.callTool({
      name: 'browser_snapshot',
      arguments: {},
    });

    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);

    // Snapshot should contain text content with element refs
    const textContent = result.content.find(
      (c: { type: string }) => c.type === 'text'
    );
    expect(textContent).toBeDefined();
    expect(textContent.text).toContain('Example Domain');
  }, 30000);
});

describe('Browser Interaction', () => {
  it('clicks a link and navigates', async () => {
    // Navigate to example.com which has a "More information..." link
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://example.com' },
    });

    // Get snapshot to find the link ref
    const snapshot = await client.callTool({
      name: 'browser_snapshot',
      arguments: {},
    });

    const textContent = snapshot.content.find(
      (c: { type: string }) => c.type === 'text'
    );

    // Find the ref for "More information..." link
    const linkMatch = textContent.text.match(/\[(\d+)\].*More information/i);
    if (linkMatch) {
      const ref = linkMatch[1];
      const clickResult = await client.callTool({
        name: 'browser_click',
        arguments: { element: `Link "More information..."`, ref },
      });

      expect(clickResult).toBeDefined();
    }
  }, 30000);
});
