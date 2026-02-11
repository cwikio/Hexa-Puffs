/**
 * MCP Client Helper for Memorizer MCP Integration Tests.
 * Uses shared base client, adds Memorizer-specific convenience methods.
 */

import { MCPTestClient } from '@mcp/shared/Testing/mcp-test-client.js';

export interface ToolCallResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'success' | 'error' | 'debug';
  message: string;
  duration?: number;
}

export class McpClient {
  private client: MCPTestClient;
  private logs: LogEntry[] = [];

  constructor(baseUrl?: string) {
    const url = baseUrl ?? process.env.MEMORIZER_URL ?? 'http://localhost:8005';
    this.client = new MCPTestClient('Memorizer', url);
  }

  private log(level: LogEntry['level'], message: string, duration?: number): void {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
    const entry: LogEntry = { timestamp, level, message, duration };
    this.logs.push(entry);

    const icons = { info: 'i', success: '✓', error: '✗', debug: '...' };
    const colors = { info: '\x1b[36m', success: '\x1b[32m', error: '\x1b[31m', debug: '\x1b[90m' };
    const reset = '\x1b[0m';

    const durationStr = duration !== undefined ? ` (${duration}ms)` : '';
    console.log(`[${timestamp}] ${colors[level]}${icons[level]}${reset} ${message}${durationStr}`);
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  clearLogs(): void {
    this.logs = [];
  }

  async healthCheck(): Promise<boolean> {
    const url = this.client.getBaseUrl();
    this.log('info', `Checking health at ${url}/health`);

    const result = await this.client.healthCheck();
    if (result.healthy) {
      this.log('success', 'Health check passed', result.duration);
      return true;
    } else {
      this.log('error', `Health check failed: ${result.error || result.status}`, result.duration);
      throw new Error(`Health check failed: ${result.error || result.status}`);
    }
  }

  async callTool<T = unknown>(toolName: string, args: Record<string, unknown> = {}): Promise<ToolCallResult<T>> {
    this.log('info', `Calling ${toolName} tool`);

    const result = await this.client.callTool<ToolCallResult<T>>(toolName, args);

    // The shared client parses the MCP wrapper and returns the inner object.
    // For Memorizer, the inner object IS a ToolCallResult { success, data?, error? }.
    const mapped: ToolCallResult<T> = result.data ?? { success: false, error: result.error ?? 'Invalid response format' };

    if (mapped.success) {
      this.log('success', `${toolName} succeeded`, result.duration);
    } else {
      this.log('error', `${toolName} failed: ${mapped.error}`, result.duration);
    }

    return mapped;
  }

  // Convenience methods for each tool

  async storeFact(fact: string, category: string, agentId = 'test-agent', source?: string): Promise<ToolCallResult> {
    return this.callTool('store_fact', { fact, category, agent_id: agentId, source });
  }

  async listFacts(agentId = 'test-agent', category?: string, limit?: number): Promise<ToolCallResult> {
    const args: Record<string, unknown> = { agent_id: agentId };
    if (category) args.category = category;
    if (limit) args.limit = limit;
    return this.callTool('list_facts', args);
  }

  async deleteFact(factId: number): Promise<ToolCallResult> {
    return this.callTool('delete_fact', { fact_id: factId });
  }

  async storeConversation(
    userMessage: string,
    agentResponse: string,
    agentId = 'test-agent',
    sessionId?: string,
    tags?: string[]
  ): Promise<ToolCallResult> {
    const args: Record<string, unknown> = {
      user_message: userMessage,
      agent_response: agentResponse,
      agent_id: agentId,
    };
    if (sessionId) args.session_id = sessionId;
    if (tags) args.tags = tags;
    return this.callTool('store_conversation', args);
  }

  async searchConversations(
    query: string,
    agentId = 'test-agent',
    limit?: number,
    dateFrom?: string,
    dateTo?: string
  ): Promise<ToolCallResult> {
    const args: Record<string, unknown> = { query, agent_id: agentId };
    if (limit) args.limit = limit;
    if (dateFrom) args.date_from = dateFrom;
    if (dateTo) args.date_to = dateTo;
    return this.callTool('search_conversations', args);
  }

  async getProfile(agentId = 'test-agent'): Promise<ToolCallResult> {
    return this.callTool('get_profile', { agent_id: agentId });
  }

  async updateProfile(
    updates: Record<string, unknown>,
    agentId = 'test-agent',
    reason?: string
  ): Promise<ToolCallResult> {
    const args: Record<string, unknown> = { agent_id: agentId, updates };
    if (reason) args.reason = reason;
    return this.callTool('update_profile', args);
  }

  async retrieveMemories(
    query: string,
    agentId = 'test-agent',
    limit?: number,
    includeConversations = true
  ): Promise<ToolCallResult> {
    return this.callTool('retrieve_memories', {
      query,
      agent_id: agentId,
      limit,
      include_conversations: includeConversations,
    });
  }

  async getMemoryStats(agentId = 'test-agent'): Promise<ToolCallResult> {
    return this.callTool('get_memory_stats', { agent_id: agentId });
  }

  async exportMemory(
    agentId = 'test-agent',
    format: 'json' | 'markdown' = 'json',
    includeConversations = true
  ): Promise<ToolCallResult> {
    return this.callTool('export_memory', {
      agent_id: agentId,
      format,
      include_conversations: includeConversations,
    });
  }

  async importMemory(filePath: string, agentId = 'test-agent'): Promise<ToolCallResult> {
    return this.callTool('import_memory', { file_path: filePath, agent_id: agentId });
  }

  // Skill convenience methods

  async storeSkill(
    name: string,
    triggerType: string,
    instructions: string,
    agentId = 'test-agent',
    opts: Record<string, unknown> = {}
  ): Promise<ToolCallResult> {
    return this.callTool('store_skill', {
      agent_id: agentId,
      name,
      trigger_type: triggerType,
      instructions,
      ...opts,
    });
  }

  async listSkills(agentId = 'test-agent', opts: Record<string, unknown> = {}): Promise<ToolCallResult> {
    return this.callTool('list_skills', { agent_id: agentId, ...opts });
  }

  async getSkill(skillId: number): Promise<ToolCallResult> {
    return this.callTool('get_skill', { skill_id: skillId });
  }

  async updateSkill(skillId: number, updates: Record<string, unknown>): Promise<ToolCallResult> {
    return this.callTool('update_skill', { skill_id: skillId, ...updates });
  }

  async deleteSkill(skillId: number): Promise<ToolCallResult> {
    return this.callTool('delete_skill', { skill_id: skillId });
  }

  // Contact convenience methods

  async createContact(
    name: string,
    email: string,
    agentId = 'test-agent',
    opts: Record<string, unknown> = {}
  ): Promise<ToolCallResult> {
    return this.callTool('create_contact', {
      agent_id: agentId,
      name,
      email,
      ...opts,
    });
  }

  async listContacts(agentId = 'test-agent', opts: Record<string, unknown> = {}): Promise<ToolCallResult> {
    return this.callTool('list_contacts', { agent_id: agentId, ...opts });
  }

  async updateContact(contactId: number, updates: Record<string, unknown>): Promise<ToolCallResult> {
    return this.callTool('update_contact', { contact_id: contactId, ...updates });
  }

  // Project convenience methods

  async createProject(
    name: string,
    agentId = 'test-agent',
    opts: Record<string, unknown> = {}
  ): Promise<ToolCallResult> {
    return this.callTool('create_project', {
      agent_id: agentId,
      name,
      ...opts,
    });
  }

  async listProjects(agentId = 'test-agent', opts: Record<string, unknown> = {}): Promise<ToolCallResult> {
    return this.callTool('list_projects', { agent_id: agentId, ...opts });
  }

  async updateProject(projectId: number, updates: Record<string, unknown>): Promise<ToolCallResult> {
    return this.callTool('update_project', { project_id: projectId, ...updates });
  }
}

// Create a shared instance for tests
export const mcpClient = new McpClient();
