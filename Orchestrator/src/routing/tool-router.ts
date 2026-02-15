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
import { normalizeSkillInput, validateCronExpression } from '../utils/skill-normalizer.js';
import type { MCPMetadata } from '../config/schema.js';

export interface RoutedTool {
  name: string; // The name exposed to Claude (may be prefixed)
  originalName: string; // The original name in the MCP
  mcpName: string; // Which MCP this tool belongs to
  definition: MCPToolDefinition;
}

export interface ToolGroup {
  label: string;
  description: string;
  tools: string[]; // Tool names (original, before prefixing) that belong to this group
}

export interface ResponseHint {
  suggest: string[];    // Tool names worth calling next
  tip?: string;         // Short workflow guidance for the LLM
}

export interface ToolRouterConfig {
  // When true, always prefix tool names with MCP name (e.g., telegram.send_message)
  alwaysPrefix?: boolean;
  // Custom prefix separator (default: '.')
  separator?: string;
  // Tool groups for contextual hints in descriptions
  toolGroups?: ToolGroup[];
  // Response hints per tool (overrides defaults)
  responseHints?: Record<string, ResponseHint>;
}

export class ToolRouter {
  private routes: Map<string, { mcp: IMCPClient; originalName: string }> = new Map();
  private toolDefinitions: Map<string, MCPToolDefinition> = new Map();
  private mcpClients: Map<string, IMCPClient> = new Map();
  private mcpMetadataMap: Map<string, MCPMetadata> = new Map();
  private logger: Logger;
  private config: ToolRouterConfig;

  private static readonly DEFAULT_TOOL_GROUPS: ToolGroup[] = [
    {
      label: 'Communication',
      description: 'Send and receive messages across platforms',
      tools: [
        'send_message', 'get_messages', 'search_messages', 'delete_messages',
        'mark_read', 'get_new_messages', 'subscribe_chat', 'send_media',
        'send_email', 'reply_email', 'get_email', 'list_emails',
        'get_new_emails', 'delete_email', 'modify_labels',
      ],
    },
    {
      label: 'Contacts & Chats',
      description: 'Manage contacts, chats, and groups',
      tools: [
        'list_chats', 'get_chat', 'create_group',
        'list_contacts', 'add_contact', 'search_users', 'get_me',
      ],
    },
    {
      label: 'Drafts & Composition',
      description: 'Draft and manage email drafts before sending',
      tools: [
        'list_drafts', 'create_draft', 'update_draft', 'send_draft', 'delete_draft',
      ],
    },
    {
      label: 'Calendar',
      description: 'Schedule and manage calendar events',
      tools: [
        'list_calendars', 'list_events', 'get_event',
        'create_event', 'update_event', 'delete_event',
        'quick_add_event', 'find_free_time',
      ],
    },
    {
      label: 'Email Management',
      description: 'Organize email with labels and filters',
      tools: [
        'list_labels', 'create_label', 'delete_label',
        'list_filters', 'get_filter', 'create_filter', 'delete_filter',
        'list_attachments', 'get_attachment',
      ],
    },
    {
      label: 'Knowledge & Memory',
      description: 'Store, recall, and manage personal knowledge',
      tools: [
        'store_fact', 'list_facts', 'delete_fact', 'update_fact',
        'store_conversation', 'search_conversations',
        'get_profile', 'update_profile', 'retrieve_memories',
        'get_memory_stats', 'export_memory', 'import_memory',
        'store_skill', 'list_skills', 'get_skill', 'update_skill', 'delete_skill',
      ],
    },
    {
      label: 'File Management',
      description: 'Read, write, and organize workspace files',
      tools: [
        'create_file', 'read_file', 'list_files', 'update_file',
        'delete_file', 'move_file', 'copy_file', 'search_files',
        'check_grant', 'request_grant', 'list_grants',
        'get_workspace_info', 'get_audit_log',
      ],
    },
    {
      label: 'Web Search',
      description: 'Search the web and news',
      tools: ['web_search', 'news_search', 'web_fetch'],
    },
    {
      label: 'Security',
      description: 'Content scanning and security checks',
      tools: ['scan_content', 'get_scan_log'],
    },
    {
      label: 'Secrets',
      description: 'Read-only access to 1Password vaults and items',
      tools: ['list_vaults', 'list_items', 'get_item', 'read_secret'],
    },
    {
      label: 'Media',
      description: 'Send and download media files',
      tools: ['send_media', 'download_media'],
    },
  ];

  /** Workflow hints: after calling tool X, suggest tools Y and Z */
  private static readonly DEFAULT_RESPONSE_HINTS: Record<string, ResponseHint> = {
    // Communication — after sending, consider logging
    send_message:     { suggest: ['store_conversation'], tip: 'Consider logging this exchange to memory' },
    send_email:       { suggest: ['store_conversation'], tip: 'Consider logging this exchange to memory' },
    reply_email:      { suggest: ['store_conversation'] },

    // Reading messages — after reading, consider replying or saving
    get_messages:     { suggest: ['send_message', 'store_fact'], tip: 'Reply or save key info to memory' },
    get_new_messages: { suggest: ['send_message', 'store_fact'], tip: 'Reply or save key info to memory' },
    get_email:        { suggest: ['reply_email', 'store_fact'], tip: 'Reply or save key info to memory' },
    list_emails:      { suggest: ['get_email'] },
    get_new_emails:   { suggest: ['get_email', 'reply_email'] },

    // Search — after finding info, share or store it
    web_search:       { suggest: ['store_fact', 'send_message', 'send_email'], tip: 'Save findings or share them' },
    news_search:      { suggest: ['store_fact', 'send_message'] },
    web_fetch:        { suggest: ['store_fact', 'send_message', 'send_email'], tip: 'Save extracted content or share it' },
    search_messages:  { suggest: ['send_message', 'store_fact'] },

    // Memory — after recalling, act on it
    retrieve_memories: { suggest: ['send_message', 'send_email', 'web_search'], tip: 'Use recalled info to take action' },
    search_conversations: { suggest: ['retrieve_memories', 'send_message'] },

    // Files — suggest related file ops
    read_file:        { suggest: ['update_file', 'store_fact'] },
    list_files:       { suggest: ['read_file'] },
    search_files:     { suggest: ['read_file'] },
    create_file:      { suggest: ['read_file'] },

    // Calendar — after checking schedule, communicate
    list_events:      { suggest: ['create_event', 'send_message'], tip: 'Create event or notify someone' },
    find_free_time:   { suggest: ['create_event', 'send_message'] },
    create_event:     { suggest: ['send_message', 'send_email'], tip: 'Notify attendees' },

    // Drafts — natural flow
    create_draft:     { suggest: ['send_draft'] },
    update_draft:     { suggest: ['send_draft'] },

    // Secrets — after reading a secret, use it
    read_secret:      { suggest: ['store_fact'], tip: 'Never send secrets via message — store reference only' },

  };

  private getServiceLabel(mcpName: string): string {
    const meta = this.mcpMetadataMap.get(mcpName);
    if (meta?.label) return meta.label;
    // Tier 3 fallback: capitalize first letter
    return mcpName.charAt(0).toUpperCase() + mcpName.slice(1);
  }

  /**
   * Build a lookup from original tool name → group label
   */
  private buildGroupIndex(): Map<string, string> {
    const groups = this.config.toolGroups ?? ToolRouter.DEFAULT_TOOL_GROUPS;
    const index = new Map<string, string>();
    for (const group of groups) {
      for (const toolName of group.tools) {
        // First match wins — a tool belongs to one primary group
        if (!index.has(toolName)) {
          index.set(toolName, group.label);
        }
      }
    }
    return index;
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
   * Register an MCP client for tool discovery, with optional manifest metadata.
   */
  registerMCP(name: string, client: IMCPClient, metadata?: MCPMetadata): void {
    this.mcpClients.set(name, client);
    if (metadata) {
      this.mcpMetadataMap.set(name, metadata);
    }
    this.logger.debug(`Registered MCP: ${name}`);
  }

  /**
   * Unregister an MCP client (used by hot-reload to remove external MCPs).
   * Call discoverTools() afterwards to rebuild routes.
   */
  unregisterMCP(name: string): void {
    this.mcpClients.delete(name);
    this.mcpMetadataMap.delete(name);
    this.logger.debug(`Unregistered MCP: ${name}`);
  }

  /**
   * Discover tools from all registered MCPs and build routing table
   */
  async discoverTools(): Promise<void> {
    this.logger.info('Discovering tools from MCPs...');
    this.routes.clear();
    this.toolDefinitions.clear();

    const groupIndex = this.buildGroupIndex();
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

    // Phase 2: Build routing table with conflict resolution + group tagging
    for (const [toolName, sources] of toolsByName) {
      if (sources.length === 1 && !this.config.alwaysPrefix) {
        // No conflict - use original name
        const { mcpName, tool } = sources[0];
        // Group: hardcoded index first, then metadata toolGroup fallback
        const groupLabel = groupIndex.get(toolName)
          ?? this.mcpMetadataMap.get(mcpName)?.toolGroup;
        const client = this.mcpClients.get(mcpName);
        if (client) {
          this.routes.set(toolName, { mcp: client, originalName: toolName });
          this.toolDefinitions.set(toolName, {
            ...tool,
            description: this.tagDescription(tool.description, this.getServiceLabel(mcpName), groupLabel),
          });
          this.logger.debug(`Registered tool: ${toolName} → ${mcpName}`);
        }
      } else {
        // Conflict or alwaysPrefix - prefix with MCP name
        for (const { mcpName, tool } of sources) {
          // Group: hardcoded index first, then metadata toolGroup fallback
          const groupLabel = groupIndex.get(toolName)
            ?? this.mcpMetadataMap.get(mcpName)?.toolGroup;
          const prefixedName = `${mcpName}${this.config.separator}${toolName}`;
          const client = this.mcpClients.get(mcpName);
          if (client) {
            this.routes.set(prefixedName, { mcp: client, originalName: toolName });
            this.toolDefinitions.set(prefixedName, {
              ...tool,
              name: prefixedName,
              description: this.tagDescription(tool.description, this.getServiceLabel(mcpName), groupLabel),
            });
            this.logger.debug(`Registered tool with prefix: ${prefixedName} → ${mcpName}.${toolName}`);
          }
        }
      }
    }

    this.logger.info(`Tool discovery complete: ${this.routes.size} tools registered`);
  }

  /**
   * Build a tagged description: [Service | Group] original description
   */
  private tagDescription(
    original: string | undefined,
    serviceLabel: string,
    groupLabel: string | undefined
  ): string {
    const tag = groupLabel
      ? `[${serviceLabel} | ${groupLabel}]`
      : `[${serviceLabel}]`;
    return original ? `${tag} ${original}` : tag;
  }

  /**
   * Get workflow hints for a tool (uses original name for lookup, resolves suggestions to exposed names)
   */
  getResponseHints(exposedToolName: string): ResponseHint | null {
    const route = this.routes.get(exposedToolName);
    if (!route) return null;

    const hints = this.config.responseHints ?? ToolRouter.DEFAULT_RESPONSE_HINTS;
    const hint = hints[route.originalName];
    if (!hint) return null;

    // Resolve suggested tool names to exposed names (they may be prefixed)
    const resolvedSuggest = hint.suggest
      .filter((name) => this.routes.has(name) || this.findExposedName(name) !== null)
      .map((name) => this.routes.has(name) ? name : this.findExposedName(name)!);

    if (resolvedSuggest.length === 0 && !hint.tip) return null;

    return {
      suggest: resolvedSuggest,
      ...(hint.tip ? { tip: hint.tip } : {}),
    };
  }

  /**
   * Find the exposed name for an original tool name (handles prefixed names)
   */
  private findExposedName(originalName: string): string | null {
    for (const [exposed, route] of this.routes) {
      if (route.originalName === originalName) return exposed;
    }
    return null;
  }

  /**
   * Get all stored MCP metadata (for embedding in /tools/list response).
   */
  getMCPMetadata(): Record<string, MCPMetadata> {
    const result: Record<string, MCPMetadata> = {};
    for (const [name, meta] of this.mcpMetadataMap) {
      result[name] = meta;
    }
    return result;
  }

  /**
   * Get all tool definitions for ListTools response
   */
  getToolDefinitions(): MCPToolDefinition[] {
    return Array.from(this.toolDefinitions.values());
  }

  /**
   * Get tool definitions filtered by allow/deny glob patterns.
   * - If allowedTools is empty, all tools are allowed.
   * - deniedTools is evaluated after allowedTools.
   */
  getFilteredToolDefinitions(
    allowedTools: string[] = [],
    deniedTools: string[] = [],
  ): MCPToolDefinition[] {
    if (allowedTools.length === 0 && deniedTools.length === 0) {
      return this.getToolDefinitions();
    }

    return this.getToolDefinitions().filter((tool) => {
      // Check allow list (empty = all allowed)
      if (allowedTools.length > 0 && !matchesAnyGlob(tool.name, allowedTools)) {
        return false;
      }
      // Check deny list
      if (deniedTools.length > 0 && matchesAnyGlob(tool.name, deniedTools)) {
        return false;
      }
      return true;
    });
  }

  /**
   * Check whether a tool call is permitted for the given allow/deny lists.
   */
  isToolAllowed(
    toolName: string,
    allowedTools: string[] = [],
    deniedTools: string[] = [],
  ): boolean {
    if (allowedTools.length > 0 && !matchesAnyGlob(toolName, allowedTools)) {
      return false;
    }
    if (deniedTools.length > 0 && matchesAnyGlob(toolName, deniedTools)) {
      return false;
    }
    return true;
  }

  /**
   * Route a tool call to the appropriate MCP
   */
  async routeToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolCallResult> {
    // Normalize skill inputs before routing (fixes LLM mistakes regardless of caller)
    if (toolName === 'memory_store_skill' || toolName === 'memory_update_skill') {
      const normalized = normalizeSkillInput(args);
      Object.assign(args, normalized);

      // Validate cron expression before storage
      const tc = args.trigger_config as Record<string, unknown> | undefined;
      if (tc?.schedule && typeof tc.schedule === 'string') {
        const cronCheck = validateCronExpression(tc.schedule);
        if (!cronCheck.valid) {
          return {
            success: false,
            error: `Invalid cron expression "${tc.schedule}": ${cronCheck.error}`,
            content: { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Invalid cron expression "${tc.schedule}": ${cronCheck.error}` }) }] },
          };
        }
      }

      // Safety net: multi-step execution_plan → force Agent tier
      // Direct tier has no result piping between steps, so >1 step plans would
      // send literal template strings like {{step1.result}} instead of actual data.
      const plan = args.execution_plan;
      if (Array.isArray(plan) && plan.length > 1) {
        this.logger.warn('Multi-step execution_plan auto-converted to Agent tier', {
          name: args.name, steps: plan.length,
        });
        if (!args.required_tools || (Array.isArray(args.required_tools) && args.required_tools.length === 0)) {
          args.required_tools = [...new Set(
            plan
              .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
              .map(s => s.toolName)
              .filter((t): t is string => typeof t === 'string')
          )];
        }
        delete args.execution_plan;
      }
    }

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

/**
 * Simple glob matching for tool name patterns.
 * Supports `*` as a wildcard that matches any sequence of characters.
 * Examples: "telegram_*" matches "telegram_send_message", "*_search" matches "web_search".
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexStr = escaped.replace(/\*/g, '.*');
  return new RegExp(`^${regexStr}$`);
}

function matchesAnyGlob(name: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegex(pattern).test(name));
}
