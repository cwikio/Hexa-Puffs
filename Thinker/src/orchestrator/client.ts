import type { Config } from '../config.js';
import type { TraceContext } from '../tracing/types.js';
import { createTraceHeaders } from '../tracing/context.js';
import { Logger } from '@mcp/shared/Utils/logger.js';

const logger = new Logger('thinker:orchestrator');
import type {
  OrchestratorTool,
  ToolExecutionResponse,
  TelegramMessage,
  MemoryFact,
  AgentProfile,
  ConversationEntry,
  MCPToolCallResponse,
  MCPToolsListResponse,
  MCPMetadata,
} from './types.js';

/**
 * HTTP client for Orchestrator MCP
 */
export class OrchestratorClient {
  private baseUrl: string;
  private agentId: string;
  private timeout: number;
  private tools: Map<string, OrchestratorTool> = new Map();
  private mcpMetadata: Record<string, MCPMetadata> | undefined;
  private toolsCachedAt: number = 0;
  private static readonly TOOL_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  constructor(config: Config) {
    this.baseUrl = config.orchestratorUrl;
    this.agentId = config.thinkerAgentId;
    this.timeout = config.orchestratorTimeout;
  }

  /**
   * Make an HTTP request to the Orchestrator
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    trace?: TraceContext
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Agent-Id': this.agentId,
      ...(process.env.ANNABELLE_TOKEN ? { 'X-Annabelle-Token': process.env.ANNABELLE_TOKEN } : {}),
      ...(trace ? createTraceHeaders(trace) : {}),
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Orchestrator request failed: ${response.status} - ${error}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Check if Orchestrator is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.request<{ status: string }>('GET', '/health');
      return response.status === 'ok';
    } catch {
      return false;
    }
  }

  /**
   * Discover available tools from Orchestrator
   */
  async discoverTools(): Promise<OrchestratorTool[]> {
    try {
      const response = await this.request<MCPToolsListResponse>('GET', '/tools/list');
      const tools = response.tools;

      // Cache tools with timestamp
      this.tools.clear();
      for (const tool of tools) {
        this.tools.set(tool.name, tool);
      }
      this.mcpMetadata = response.mcpMetadata;
      this.toolsCachedAt = Date.now();

      return tools;
    } catch (error) {
      logger.error('Failed to discover tools', error);
      return [];
    }
  }

  /**
   * Get cached tools, re-discovering if the cache has expired.
   */
  async getCachedToolsOrRefresh(): Promise<OrchestratorTool[]> {
    if (this.tools.size === 0 || Date.now() - this.toolsCachedAt > OrchestratorClient.TOOL_CACHE_TTL_MS) {
      logger.debug('Tool cache expired or empty — re-discovering');
      return this.discoverTools();
    }
    return Array.from(this.tools.values());
  }

  /**
   * Get cached tools (without refresh check — use getCachedToolsOrRefresh() for TTL-aware access)
   */
  getCachedTools(): OrchestratorTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get cached MCP metadata (populated alongside tools during discovery).
   */
  getMCPMetadata(): Record<string, MCPMetadata> | undefined {
    return this.mcpMetadata;
  }

  /**
   * Get a specific tool definition
   */
  getTool(name: string): OrchestratorTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Parse MCP response format to ToolExecutionResponse
   */
  private parseMCPResponse(mcpResponse: MCPToolCallResponse): ToolExecutionResponse {
    if (!mcpResponse.content || mcpResponse.content.length === 0) {
      return { success: false, error: 'Empty response from Orchestrator' };
    }

    const textContent = mcpResponse.content[0];
    if (textContent.type !== 'text') {
      return { success: false, error: 'Unexpected response type from Orchestrator' };
    }

    try {
      const parsed = JSON.parse(textContent.text);

      // Internal MCPs return StandardResponse: { success, data?, error? }
      if ('success' in parsed) {
        return {
          success: parsed.success,
          result: parsed.data,
          error: parsed.error,
        };
      }

      // External MCPs (e.g. vercel-mcp) return raw JSON without StandardResponse wrapping.
      // The Orchestrator passes their response text through directly, so we treat
      // any valid JSON without a 'success' field as a successful result.
      return { success: true, result: parsed };
    } catch {
      // If parsing fails, treat the text as the result
      return { success: true, result: textContent.text };
    }
  }

  /**
   * Execute a tool via Orchestrator
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    trace?: TraceContext
  ): Promise<ToolExecutionResponse> {
    const request = {
      name: toolName,
      arguments: args,
    };

    try {
      const mcpResponse = await this.request<MCPToolCallResponse>(
        'POST',
        '/tools/call',
        request,
        trace
      );
      return this.parseMCPResponse(mcpResponse);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get new Telegram messages from queue
   */
  async getNewTelegramMessages(
    peek: boolean = false,
    trace?: TraceContext
  ): Promise<TelegramMessage[]> {
    const response = await this.executeTool(
      'telegram_get_new_messages',
      { peek },
      trace
    );

    if (!response.success || !response.result) {
      return [];
    }

    // Response is double-wrapped: Orchestrator wraps the Telegram MCP response
    // Need to unwrap: { content: [{ text: "{ success, data: { messages } }" }] }
    try {
      const outerResult = response.result as { content?: Array<{ type: string; text: string }> };
      if (outerResult.content && outerResult.content[0]?.type === 'text') {
        const innerJson = JSON.parse(outerResult.content[0].text) as {
          success: boolean;
          data?: { messages?: TelegramMessage[] };
        };
        if (innerJson.success && innerJson.data?.messages) {
          return innerJson.data.messages;
        }
      }
      return [];
    } catch {
      // Fallback: maybe it's already unwrapped
      const result = response.result as { messages?: TelegramMessage[] };
      return result.messages || [];
    }
  }

  /**
   * Send a Telegram message
   */
  async sendTelegramMessage(
    chatId: string,
    message: string,
    replyTo?: number,
    trace?: TraceContext
  ): Promise<boolean> {
    const args: Record<string, unknown> = {
      chat_id: chatId,
      message,
    };

    if (replyTo) {
      args.reply_to = replyTo;
    }

    const response = await this.executeTool('telegram_send_message', args, trace);
    return response.success;
  }

  /**
   * Store a fact in Memory MCP
   */
  async storeFact(
    agentId: string,
    fact: string,
    category: string,
    trace?: TraceContext
  ): Promise<boolean> {
    const response = await this.executeTool(
      'memory_store_fact',
      { agent_id: agentId, fact, category },
      trace
    );
    return response.success;
  }

  /**
   * Retrieve memories from Memory MCP
   */
  async retrieveMemories(
    agentId: string,
    query: string,
    limit: number = 5,
    trace?: TraceContext
  ): Promise<{ facts: MemoryFact[]; conversations: ConversationEntry[] }> {
    const response = await this.executeTool(
      'memory_retrieve_memories',
      { agent_id: agentId, query, limit, include_conversations: true },
      trace
    );

    if (!response.success || !response.result) {
      return { facts: [], conversations: [] };
    }

    const result = response.result as {
      facts?: MemoryFact[];
      conversations?: ConversationEntry[];
    };

    return {
      facts: result.facts || [],
      conversations: result.conversations || [],
    };
  }

  /**
   * Get agent profile from Memory MCP
   */
  async getProfile(agentId: string, trace?: TraceContext): Promise<AgentProfile | null> {
    const response = await this.executeTool(
      'memory_get_profile',
      { agent_id: agentId },
      trace
    );

    if (!response.success || !response.result) {
      return null;
    }

    return response.result as AgentProfile;
  }

  /**
   * Store a conversation in Memory MCP
   */
  async storeConversation(
    agentId: string,
    userMessage: string,
    agentResponse: string,
    sessionId?: string,
    trace?: TraceContext
  ): Promise<boolean> {
    const args: Record<string, unknown> = {
      agent_id: agentId,
      user_message: userMessage,
      agent_response: agentResponse,
    };

    if (sessionId) {
      args.session_id = sessionId;
    }

    const response = await this.executeTool('memory_store_conversation', args, trace);
    return response.success;
  }

  /**
   * List skills from Memory MCP
   */
  async listSkills(
    agentId: string,
    triggerType?: string,
    enabled?: boolean,
    trace?: TraceContext
  ): Promise<{ skills: Array<Record<string, unknown>>; total_count: number }> {
    const args: Record<string, unknown> = { agent_id: agentId };
    if (triggerType !== undefined) args.trigger_type = triggerType;
    if (enabled !== undefined) args.enabled = enabled;

    const response = await this.executeTool('memory_list_skills', args, trace);

    if (!response.success || !response.result) {
      return { skills: [], total_count: 0 };
    }

    const result = response.result as {
      skills?: Array<Record<string, unknown>>;
      total_count?: number;
    };
    return {
      skills: result.skills ?? [],
      total_count: result.total_count ?? 0,
    };
  }

  /**
   * List stored facts from Memory MCP (for dedup context in fact extraction)
   */
  async listFacts(
    agentId: string,
    limit: number = 30,
    trace?: TraceContext
  ): Promise<Array<{ fact: string; category: string }>> {
    const response = await this.executeTool(
      'memory_list_facts',
      { agent_id: agentId, limit },
      trace
    );

    if (!response.success || !response.result) {
      return [];
    }

    const result = response.result as {
      facts?: Array<{ fact: string; category: string }>;
    };
    return result.facts || [];
  }

  /**
   * Search conversations in Memory MCP
   */
  async searchConversations(
    agentId: string,
    query: string,
    limit: number = 10,
    trace?: TraceContext
  ): Promise<ConversationEntry[]> {
    const response = await this.executeTool(
      'memory_search_conversations',
      { agent_id: agentId, query, limit },
      trace
    );

    if (!response.success || !response.result) {
      return [];
    }

    const result = response.result as { conversations?: ConversationEntry[] };
    return result.conversations || [];
  }
}
