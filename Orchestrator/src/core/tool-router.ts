/**
 * ToolRouter - Dynamic tool discovery and routing with namespace prefixing
 *
 * This module provides:
 * 1. Auto-discovery of tools from connected MCP servers
 * 2. Automatic namespace prefixing for conflicting tool names
 * 3. Direct passthrough routing to the appropriate MCP
 */

import type { IMCPClient, MCPToolDefinition, ToolCallResult } from '../mcp-clients/types.js';
import { logger, Logger } from '@mcp/shared/Utils/logger.js';

export interface RoutedTool {
  name: string; // The name exposed to Claude (may be prefixed)
  originalName: string; // The original name in the MCP
  mcpName: string; // Which MCP this tool belongs to
  definition: MCPToolDefinition;
}

export interface ToolRouterConfig {
  // When true, always prefix tool names with MCP name (e.g., telegram.send_message)
  alwaysPrefix?: boolean;
  // Custom prefix separator (default: '.')
  separator?: string;
}

export class ToolRouter {
  private routes: Map<string, { mcp: IMCPClient; originalName: string }> = new Map();
  private toolDefinitions: Map<string, MCPToolDefinition> = new Map();
  private mcpClients: Map<string, IMCPClient> = new Map();
  private logger: Logger;
  private config: ToolRouterConfig;

  private static readonly SERVICE_LABELS: Record<string, string> = {
    telegram: 'Telegram',
    onepassword: '1Password',
    memory: 'Memory',
    filer: 'Workspace Files',
    searcher: 'Web Search',
    guardian: 'Guardian',
    gmail: 'Gmail',
  };

  private getServiceLabel(mcpName: string): string {
    return ToolRouter.SERVICE_LABELS[mcpName] ?? mcpName;
  }

  constructor(config: ToolRouterConfig = {}) {
    this.config = {
      alwaysPrefix: false,
      separator: '.',
      ...config,
    };
    this.logger = logger.child('tool-router');
  }

  /**
   * Register an MCP client for tool discovery
   */
  registerMCP(name: string, client: IMCPClient): void {
    this.mcpClients.set(name, client);
    this.logger.debug(`Registered MCP: ${name}`);
  }

  /**
   * Discover tools from all registered MCPs and build routing table
   */
  async discoverTools(): Promise<void> {
    this.logger.info('Discovering tools from MCPs...');
    this.routes.clear();
    this.toolDefinitions.clear();

    const toolsByName = new Map<string, Array<{ mcpName: string; tool: MCPToolDefinition }>>();

    // Phase 1: Collect all tools from all MCPs
    for (const [mcpName, client] of this.mcpClients) {
      if (!client.isAvailable) {
        this.logger.warn(`Skipping ${mcpName} - not available`);
        continue;
      }

      const tools = await client.listTools();
      this.logger.info(`Discovered ${tools.length} tools from ${mcpName}`);

      for (const tool of tools) {
        const existing = toolsByName.get(tool.name) || [];
        existing.push({ mcpName, tool });
        toolsByName.set(tool.name, existing);
      }
    }

    // Phase 2: Build routing table with conflict resolution
    for (const [toolName, sources] of toolsByName) {
      if (sources.length === 1 && !this.config.alwaysPrefix) {
        // No conflict - use original name
        const { mcpName, tool } = sources[0];
        const client = this.mcpClients.get(mcpName);
        if (client) {
          this.routes.set(toolName, { mcp: client, originalName: toolName });
          this.toolDefinitions.set(toolName, tool);
          this.logger.debug(`Registered tool: ${toolName} → ${mcpName}`);
        }
      } else {
        // Conflict or alwaysPrefix - prefix with MCP name
        for (const { mcpName, tool } of sources) {
          const prefixedName = `${mcpName}${this.config.separator}${toolName}`;
          const client = this.mcpClients.get(mcpName);
          if (client) {
            this.routes.set(prefixedName, { mcp: client, originalName: toolName });
            this.toolDefinitions.set(prefixedName, {
              ...tool,
              name: prefixedName,
              description: `[${this.getServiceLabel(mcpName)}] ${tool.description}`,
            });
            this.logger.debug(`Registered tool with prefix: ${prefixedName} → ${mcpName}.${toolName}`);
          }
        }
      }
    }

    this.logger.info(`Tool discovery complete: ${this.routes.size} tools registered`);
  }

  /**
   * Get all tool definitions for ListTools response
   */
  getToolDefinitions(): MCPToolDefinition[] {
    return Array.from(this.toolDefinitions.values());
  }

  /**
   * Route a tool call to the appropriate MCP
   */
  async routeToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolCallResult> {
    const route = this.routes.get(toolName);

    if (!route) {
      this.logger.warn(`Unknown tool: ${toolName}`);
      return {
        success: false,
        error: `Unknown tool: ${toolName}. Available tools: ${Array.from(this.routes.keys()).join(', ')}`,
      };
    }

    const { mcp, originalName } = route;

    this.logger.info(`Routing ${toolName} → ${mcp.name}.${originalName}`);

    return mcp.callTool({
      name: originalName,
      arguments: args,
    });
  }

  /**
   * Check if a tool exists
   */
  hasRoute(toolName: string): boolean {
    return this.routes.has(toolName);
  }

  /**
   * Get routing info for a tool
   */
  getRouteInfo(toolName: string): { mcpName: string; originalName: string } | null {
    const route = this.routes.get(toolName);
    if (!route) return null;
    return {
      mcpName: route.mcp.name,
      originalName: route.originalName,
    };
  }

  /**
   * Get all routes for debugging
   */
  getAllRoutes(): Array<{ exposedName: string; mcpName: string; originalName: string }> {
    return Array.from(this.routes.entries()).map(([exposedName, { mcp, originalName }]) => ({
      exposedName,
      mcpName: mcp.name,
      originalName,
    }));
  }
}
