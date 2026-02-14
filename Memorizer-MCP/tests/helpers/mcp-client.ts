/**
 * MCP Client Helper for Memorizer MCP Integration Tests.
 * Connects via stdio transport (spawns child process) — no HTTP server needed.
 * Follows the same pattern as Guardian/tests/helpers/mcp-client.ts.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MEMORIZER_ROOT = resolve(__dirname, '../..');

// Module-level singleton — one subprocess shared across all test files
let sdkClient: Client | null = null;
let sdkTransport: StdioClientTransport | null = null;

export async function connect(): Promise<void> {
  if (sdkClient) return;

  // Filter env vars, force stdio transport
  const envVars: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'TRANSPORT') {
      envVars[key] = value;
    }
  }

  sdkTransport = new StdioClientTransport({
    command: 'node',
    args: [resolve(MEMORIZER_ROOT, 'dist/index.js')],
    cwd: MEMORIZER_ROOT,
    env: {
      ...envVars,
      TRANSPORT: 'stdio',
    },
  });

  sdkClient = new Client(
    { name: 'memorizer-test-client', version: '1.0.0' },
    { capabilities: {} },
  );

  await sdkClient.connect(sdkTransport);
}

export async function disconnect(): Promise<void> {
  if (sdkClient) {
    await sdkClient.close();
    sdkClient = null;
  }
  if (sdkTransport) {
    await sdkTransport.close();
    sdkTransport = null;
  }
}

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
  private logs: LogEntry[] = [];

  private log(level: LogEntry['level'], message: string, duration?: number): void {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
    const entry: LogEntry = { timestamp, level, message, duration };
    this.logs.push(entry);

    const icons = { info: 'i', success: '\u2713', error: '\u2717', debug: '...' };
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

  async callTool<T = unknown>(toolName: string, args: Record<string, unknown> = {}): Promise<ToolCallResult<T>> {
    this.log('info', `Calling ${toolName} tool`);

    if (!sdkClient) {
      throw new Error('MCP client not connected. Call connect() first.');
    }

    const start = Date.now();
    try {
      const response = await sdkClient.callTool({ name: toolName, arguments: args });
      const duration = Date.now() - start;

      // SDK returns { content } or legacy { toolResult } — extract text from content array
      const content = 'content' in response && Array.isArray(response.content)
        ? response.content
        : [];
      const textEntry = content.find((c: { type: string }) => c.type === 'text');
      const text = textEntry && 'text' in textEntry ? String(textEntry.text) : undefined;

      if (!text) {
        this.log('error', `${toolName} failed: no text content`, duration);
        return { success: false, error: 'No text content in response' };
      }

      const parsed: unknown = JSON.parse(text);

      // Validate the parsed response has the expected shape
      if (typeof parsed !== 'object' || parsed === null || !('success' in parsed)) {
        this.log('error', `${toolName} failed: invalid response shape`, duration);
        return { success: false, error: 'Invalid response shape' };
      }

      // Safe after shape validation above
      const result = parsed as ToolCallResult<T>;
      if (result.success) {
        this.log('success', `${toolName} succeeded`, duration);
      } else {
        this.log('error', `${toolName} failed: ${result.error}`, duration);
      }

      return result;
    } catch (err) {
      const duration = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      this.log('error', `${toolName} failed: ${message}`, duration);
      return { success: false, error: message };
    }
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
    tags?: string[],
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
    dateTo?: string,
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
    reason?: string,
  ): Promise<ToolCallResult> {
    const args: Record<string, unknown> = { agent_id: agentId, updates };
    if (reason) args.reason = reason;
    return this.callTool('update_profile', args);
  }

  async retrieveMemories(
    query: string,
    agentId = 'test-agent',
    limit?: number,
    includeConversations = true,
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
    includeConversations = true,
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
    opts: Record<string, unknown> = {},
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
    opts: Record<string, unknown> = {},
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
    opts: Record<string, unknown> = {},
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

  // Timeline convenience method

  async queryTimeline(
    dateFrom: string,
    agentId = 'test-agent',
    opts: Record<string, unknown> = {},
  ): Promise<ToolCallResult> {
    return this.callTool('query_timeline', {
      agent_id: agentId,
      date_from: dateFrom,
      ...opts,
    });
  }
}

// Create a shared instance for tests
export const mcpClient = new McpClient();
