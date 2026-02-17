import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRouter } from '../../src/routing/tool-router.js';
import type { IMCPClient, MCPToolDefinition } from '../../src/mcp-clients/types.js';

describe('ToolRouter - Destructive Tool Blocking', () => {
  let router: ToolRouter;
  let mockClient: IMCPClient;

  const mockTools: MCPToolDefinition[] = [
    {
      name: 'delete_resource',
      description: 'Deletes a resource (destructive)',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_resource',
      description: 'Gets a resource (safe)',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'remove_item',
      description: 'Removes an item (destructive)',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'destroy_everything',
      description: 'Destroys everything (destructive)',
      inputSchema: { type: 'object', properties: {} },
    },
  ];

  beforeEach(() => {
    router = new ToolRouter();
    mockClient = {
      name: 'test_mcp',
      isAvailable: true,
      isRequired: false,
      isSensitive: false,
      listTools: vi.fn().mockResolvedValue(mockTools),
      callTool: vi.fn(),
      initialize: vi.fn(),
    };
  });

  it('should block destructive tools by default (undefined config)', async () => {
    router.registerMCP('test_mcp', mockClient, {}); // No allowDestructiveTools
    await router.discoverTools();

    const tools = router.getToolDefinitions();
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain('get_resource');
    expect(toolNames).not.toContain('delete_resource');
    expect(toolNames).not.toContain('remove_item');
    expect(toolNames).not.toContain('destroy_everything');

    const blocked = router.getBlockedTools();
    expect(blocked).toContain('test_mcp:delete_resource');
  });

  it('should block destructive tools when explicitly set to false', async () => {
    router.registerMCP('test_mcp', mockClient, { allowDestructiveTools: false });
    await router.discoverTools();

    const tools = router.getToolDefinitions();
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain('get_resource');
    expect(toolNames).not.toContain('delete_resource');
  });

  it('should allow destructive tools when explicitly set to true', async () => {
    router.registerMCP('test_mcp', mockClient, { allowDestructiveTools: true });
    await router.discoverTools();

    const tools = router.getToolDefinitions();
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain('get_resource');
    expect(toolNames).toContain('delete_resource');
    expect(toolNames).toContain('remove_item');
    expect(toolNames).toContain('destroy_everything');

    const blocked = router.getBlockedTools();
    expect(blocked).toHaveLength(0);
  });
  
  it('should verify prefixes are handled efficiently', async () => {
     // Test with alwaysPrefix: true to ensure logic works with prefixes (though detection is on raw name)
     router = new ToolRouter({ alwaysPrefix: true });
     router.registerMCP('test_mcp', mockClient, {});
     await router.discoverTools();
     
     const tools = router.getToolDefinitions();
     const toolNames = tools.map((t) => t.name);
     
     // Original names matched the pattern, so they should be blocked before prefixing happens
     // or during the conflict resolution loop where we check isDestructive
     expect(toolNames).not.toContain('test_mcp.delete_resource');
     expect(toolNames).toContain('test_mcp.get_resource');
  });
});
