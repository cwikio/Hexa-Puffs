import { getConfig, type Config } from '../config/index.js';
import { GuardianMCPClient } from '../mcp-clients/guardian.js';
import { TelegramMCPClient } from '../mcp-clients/telegram.js';
import { OnePasswordMCPClient } from '../mcp-clients/onepassword.js';
import {
  MemoryMCPClient,
  type FactCategory,
  type StoreFactResult,
  type ListFactsResult,
  type DeleteFactResult,
  type StoreConversationResult,
  type SearchConversationsResult,
  type GetProfileResult,
  type UpdateProfileResult,
  type RetrieveMemoriesResult,
  type GetMemoryStatsResult,
  type ExportMemoryResult,
  type ImportMemoryResult,
} from '../mcp-clients/memory.js';
import { FilerMCPClient } from '../mcp-clients/filer.js';
import { SearcherMCPClient } from '../mcp-clients/searcher.js';
import { GmailMCPClient } from '../mcp-clients/gmail.js';
import { StdioMCPClient } from '../mcp-clients/stdio-client.js';
import type { IMCPClient } from '../mcp-clients/types.js';
import { SecurityCoordinator } from './security.js';
import { SessionManager } from './sessions.js';
import { ToolExecutor, type ToolRegistry } from './tools.js';
import { ToolRouter } from './tool-router.js';
import { logger, Logger } from '@mcp/shared/Utils/logger.js';

export interface OrchestratorStatus {
  ready: boolean;
  uptime: number;
  mcpServers: Record<string, { available: boolean; required: boolean }>;
  sessions: { activeSessions: number; totalTurns: number };
  security: { blockedCount: number };
}

export class Orchestrator {
  private config: Config;
  private logger: Logger;
  private startTime: Date;

  // MCP Clients (HTTP mode)
  private guardian: GuardianMCPClient | null = null;
  private telegram: TelegramMCPClient | null = null;
  private onepassword: OnePasswordMCPClient | null = null;
  private memory: MemoryMCPClient | null = null;
  private filer: FilerMCPClient | null = null;
  private searcher: SearcherMCPClient | null = null;
  private gmail: GmailMCPClient | null = null;

  // MCP Clients (stdio mode)
  private stdioClients: Map<string, StdioMCPClient> = new Map();

  // Core components
  private security: SecurityCoordinator | null = null;
  private sessions: SessionManager;
  private tools: ToolExecutor | null = null;
  private toolRouter: ToolRouter;

  private initialized: boolean = false;
  private connectionMode: 'stdio' | 'http';
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly HEALTH_CHECK_INTERVAL_MS = 60_000; // 60 seconds

  constructor() {
    this.config = getConfig();
    this.logger = logger.child('orchestrator');
    this.startTime = new Date();
    this.connectionMode = this.config.mcpConnectionMode;
    this.sessions = new SessionManager();
    this.toolRouter = new ToolRouter({ alwaysPrefix: true, separator: '_' });

    if (this.connectionMode === 'stdio') {
      this.initializeStdioClients();
    } else {
      this.initializeHttpClients();
    }
  }

  private initializeStdioClients(): void {
    this.logger.info('Initializing MCP clients in stdio mode');

    const stdioConfigs = this.config.mcpServersStdio;
    if (!stdioConfigs) {
      this.logger.warn('No stdio MCP configs found');
      return;
    }

    // Create stdio clients for each configured MCP
    if (stdioConfigs.guardian) {
      const client = new StdioMCPClient('guardian', stdioConfigs.guardian);
      this.stdioClients.set('guardian', client);
      // Note: Guardian needs special handling for security - skip for now in stdio mode
    }

    if (stdioConfigs.telegram) {
      const client = new StdioMCPClient('telegram', stdioConfigs.telegram);
      this.stdioClients.set('telegram', client);
      this.toolRouter.registerMCP('telegram', client);
    }

    if (stdioConfigs.onepassword) {
      const client = new StdioMCPClient('onepassword', stdioConfigs.onepassword);
      this.stdioClients.set('onepassword', client);
      this.toolRouter.registerMCP('onepassword', client);
    }

    if (stdioConfigs.memory) {
      const client = new StdioMCPClient('memory', stdioConfigs.memory);
      this.stdioClients.set('memory', client);
      this.toolRouter.registerMCP('memory', client);
    }

    if (stdioConfigs.filer) {
      const client = new StdioMCPClient('filer', stdioConfigs.filer);
      this.stdioClients.set('filer', client);
      this.toolRouter.registerMCP('filer', client);
    }

    // Searcher and Gmail run as independent HTTP services (not spawned via stdio)
    const httpConfigs = this.config.mcpServers;
    if (httpConfigs?.searcher) {
      this.searcher = new SearcherMCPClient(httpConfigs.searcher);
      this.toolRouter.registerMCP('searcher', this.searcher);
    }
    if (httpConfigs?.gmail) {
      this.gmail = new GmailMCPClient(httpConfigs.gmail);
      this.toolRouter.registerMCP('gmail', this.gmail);
    }
  }

  private initializeHttpClients(): void {
    this.logger.info('Initializing MCP clients in HTTP mode');

    const httpConfigs = this.config.mcpServers;
    if (!httpConfigs) {
      this.logger.warn('No HTTP MCP configs found');
      return;
    }

    // Initialize HTTP-based MCP clients
    this.guardian = new GuardianMCPClient(httpConfigs.guardian, this.config.security);
    this.telegram = new TelegramMCPClient(httpConfigs.telegram);
    this.onepassword = new OnePasswordMCPClient(httpConfigs.onepassword);
    this.memory = new MemoryMCPClient(httpConfigs.memory);
    this.filer = new FilerMCPClient(httpConfigs.filer);

    // Initialize security coordinator (requires Guardian)
    this.security = new SecurityCoordinator(
      this.guardian,
      this.config.security.scanAllInputs,
      this.config.security.failMode
    );

    // Initialize tool executor
    const toolRegistry: ToolRegistry = {
      telegram: this.telegram,
      onepassword: this.onepassword,
      filer: this.filer,
    };
    this.tools = new ToolExecutor(
      toolRegistry,
      this.security,
      this.config.security.sensitiveTools
    );

    // Register with tool router
    this.toolRouter.registerMCP('telegram', this.telegram);
    this.toolRouter.registerMCP('memory', this.memory);
    this.toolRouter.registerMCP('filer', this.filer);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info(`Initializing Orchestrator in ${this.connectionMode} mode...`);

    if (this.connectionMode === 'stdio') {
      await this.initializeStdioMode();
    } else {
      await this.initializeHttpMode();
    }

    // Discover tools from all MCPs for passthrough routing
    await this.toolRouter.discoverTools();

    this.initialized = true;
    this.logger.info('Orchestrator initialized successfully');

    // Start health monitoring for stdio clients
    if (this.connectionMode === 'stdio') {
      this.startHealthMonitoring();
    }
  }

  private async initializeStdioMode(): Promise<void> {
    // Initialize all stdio clients in parallel
    const initPromises: Promise<void>[] = [];
    for (const [name, client] of this.stdioClients) {
      this.logger.info(`Spawning ${name} MCP via stdio...`);
      initPromises.push(client.initialize());
    }

    // Initialize HTTP clients (run as independent services)
    if (this.searcher) {
      this.logger.info('Connecting to Searcher MCP via HTTP...');
      initPromises.push(this.searcher.initialize());
    }
    if (this.gmail) {
      this.logger.info('Connecting to Gmail MCP via HTTP...');
      initPromises.push(this.gmail.initialize());
    }

    await Promise.all(initPromises);

    // Log summary
    const green = '\x1b[32m';
    const red = '\x1b[31m';
    const reset = '\x1b[0m';

    this.logger.info('MCP Services Status (stdio mode):');
    for (const [name, client] of this.stdioClients) {
      this.logger.info(
        `  ${name}: ${client.isAvailable ? green + '✓ available' + reset : red + '✗ unavailable' + reset} (stdio)`
      );
    }

    // Log HTTP client status
    const httpConfigs = this.config.mcpServers;
    if (this.searcher) {
      this.logger.info(
        `  searcher: ${this.searcher.isAvailable ? green + '✓ available' + reset : red + '✗ unavailable' + reset} (http: ${httpConfigs?.searcher?.url})`
      );
    }
    if (this.gmail) {
      this.logger.info(
        `  gmail: ${this.gmail.isAvailable ? green + '✓ available' + reset : red + '✗ unavailable' + reset} (http: ${httpConfigs?.gmail?.url})`
      );
    }
  }

  private async initializeHttpMode(): Promise<void> {
    // Initialize all HTTP MCP clients
    const initPromises: Promise<void>[] = [];
    if (this.guardian) initPromises.push(this.guardian.initialize());
    if (this.telegram) initPromises.push(this.telegram.initialize());
    if (this.onepassword) initPromises.push(this.onepassword.initialize());
    if (this.memory) initPromises.push(this.memory.initialize());
    if (this.filer) initPromises.push(this.filer.initialize());
    await Promise.all(initPromises);

    // Log summary
    const green = '\x1b[32m';
    const red = '\x1b[31m';
    const reset = '\x1b[0m';
    const httpConfigs = this.config.mcpServers;

    this.logger.info('MCP Services Status (HTTP mode):');
    if (this.guardian && httpConfigs) {
      this.logger.info(
        `  Guardian:    ${this.guardian.isAvailable ? green + '✓ available' + reset : red + '✗ unavailable' + reset} (${httpConfigs.guardian.url})`
      );
    }
    if (this.telegram && httpConfigs) {
      this.logger.info(
        `  Telegram:    ${this.telegram.isAvailable ? green + '✓ available' + reset : red + '✗ unavailable' + reset} (${httpConfigs.telegram.url})`
      );
    }
    if (this.onepassword && httpConfigs) {
      this.logger.info(
        `  1Password:   ${this.onepassword.isAvailable ? green + '✓ available' + reset : red + '✗ unavailable' + reset} (${httpConfigs.onepassword.url})`
      );
    }
    if (this.memory && httpConfigs) {
      this.logger.info(
        `  Memory:      ${this.memory.isAvailable ? green + '✓ available' + reset : red + '✗ unavailable' + reset} (${httpConfigs.memory.url})`
      );
    }
    if (this.filer && httpConfigs) {
      this.logger.info(
        `  Filer:       ${this.filer.isAvailable ? green + '✓ available' + reset : red + '✗ unavailable' + reset} (${httpConfigs.filer.url})`
      );
    }
  }

  /**
   * Start periodic health monitoring for stdio MCP clients.
   * Checks every 60 seconds and auto-restarts crashed processes.
   */
  private startHealthMonitoring(): void {
    if (this.healthCheckTimer) return;

    this.logger.info(
      `Starting MCP health monitoring (every ${Orchestrator.HEALTH_CHECK_INTERVAL_MS / 1000}s)`
    );

    this.healthCheckTimer = setInterval(async () => {
      await this.runHealthChecks();
    }, Orchestrator.HEALTH_CHECK_INTERVAL_MS);

    // Don't keep the process alive just for health checks
    if (this.healthCheckTimer.unref) {
      this.healthCheckTimer.unref();
    }
  }

  /**
   * Stop the health monitoring loop.
   */
  stopHealthMonitoring(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
      this.logger.info('MCP health monitoring stopped');
    }
  }

  /**
   * Run health checks on all stdio clients and restart any that have crashed.
   */
  private async runHealthChecks(): Promise<void> {
    let needsRediscovery = false;

    for (const [name, client] of this.stdioClients) {
      // Skip guardian (not registered with tool router)
      if (name === 'guardian') continue;

      const healthy = await client.healthCheck();

      if (!healthy && client.isAvailable) {
        // Was available but now failing — likely crashed
        this.logger.warn(`MCP ${name} health check failed — attempting restart...`);

        const restarted = await client.restart();
        if (restarted) {
          this.logger.info(`MCP ${name} restarted successfully`);
          needsRediscovery = true;
        } else {
          this.logger.error(`MCP ${name} restart failed — service unavailable`);
        }
      } else if (!healthy && !client.isAvailable) {
        // Was already down, try to bring it up
        this.logger.info(`MCP ${name} is down — attempting restart...`);
        const restarted = await client.restart();
        if (restarted) {
          this.logger.info(`MCP ${name} recovered`);
          this.toolRouter.registerMCP(name, client);
          needsRediscovery = true;
        }
      }
    }

    if (needsRediscovery) {
      this.logger.info('Re-discovering tools after MCP restart...');
      await this.toolRouter.discoverTools();
    }
  }

  /**
   * Helper to assert we're in HTTP mode for methods that require direct MCP client access.
   * In stdio mode, use the tool router instead.
   */
  private assertHttpMode(operation: string): void {
    if (this.connectionMode !== 'http') {
      throw new Error(
        `Operation '${operation}' requires HTTP mode. In stdio mode, use the tool router for all tool calls.`
      );
    }
  }

  async sendTelegram(message: string, chatId?: string): Promise<{ success: boolean; error?: string }> {
    this.assertHttpMode('sendTelegram');
    // Security scan
    const scanResult = await this.security!.scanInput(message);
    this.security!.assertAllowed(scanResult, 'telegram');

    return this.tools!.executeTelegram(message, chatId);
  }

  async listTelegramChats(limit?: number): Promise<{ success: boolean; chats?: unknown; error?: string }> {
    this.assertHttpMode('listTelegramChats');
    return this.tools!.listTelegramChats(limit);
  }

  async getTelegramMessages(
    chatId: string,
    limit?: number
  ): Promise<{ success: boolean; messages?: unknown; error?: string }> {
    this.assertHttpMode('getTelegramMessages');
    return this.tools!.getTelegramMessages(chatId, limit);
  }

  async getPassword(itemName: string, vault?: string): Promise<{ found: boolean; item?: unknown; error?: string }> {
    this.assertHttpMode('getPassword');
    // Security scan
    const scanResult = await this.security!.scanInput(itemName);
    this.security!.assertAllowed(scanResult, 'password');

    return this.tools!.executePassword(itemName, vault);
  }

  getStatus(): OrchestratorStatus {
    const uptime = Date.now() - this.startTime.getTime();

    // Build MCP servers status based on connection mode
    let mcpServers: Record<string, { available: boolean; required: boolean }>;
    let blockedCount = 0;

    if (this.connectionMode === 'stdio') {
      // In stdio mode, get status from stdio clients
      mcpServers = {};
      for (const [name, client] of this.stdioClients) {
        mcpServers[name] = {
          available: client.isAvailable,
          required: client.isRequired,
        };
      }
    } else {
      // In HTTP mode, use the original approach
      mcpServers = {
        guardian: {
          available: this.guardian?.isAvailable ?? false,
          required: this.guardian?.isRequired ?? false,
        },
        memory: {
          available: this.memory?.isAvailable ?? false,
          required: this.memory?.isRequired ?? false,
        },
        filer: {
          available: this.filer?.isAvailable ?? false,
          required: this.filer?.isRequired ?? false,
        },
        ...(this.tools?.getToolStatus() ?? {}),
      };
      blockedCount = this.security?.getBlockedCount() ?? 0;
    }

    return {
      ready: this.initialized,
      uptime,
      mcpServers,
      sessions: this.sessions.getStats(),
      security: {
        blockedCount,
      },
    };
  }

  getAvailableTools(): string[] {
    if (this.connectionMode === 'stdio') {
      // In stdio mode, get tools from tool router
      return this.toolRouter.getToolDefinitions().map((t) => t.name);
    }
    return this.tools?.getAvailableTools() ?? [];
  }

  /**
   * Get the tool router for passthrough routing
   */
  getToolRouter(): ToolRouter {
    return this.toolRouter;
  }

  // Memory operations - Facts
  async storeFact(
    fact: string,
    category: FactCategory,
    agentId: string = 'main',
    source?: string
  ): Promise<StoreFactResult> {
    this.assertHttpMode('storeFact');
    // Security scan input
    const scanResult = await this.security!.scanInput(fact);
    this.security!.assertAllowed(scanResult, 'store_fact');

    return this.memory!.storeFact(fact, category, agentId, source);
  }

  async listFacts(
    agentId: string = 'main',
    category?: FactCategory,
    limit: number = 50
  ): Promise<ListFactsResult> {
    this.assertHttpMode('listFacts');
    return this.memory!.listFacts(agentId, category, limit);
  }

  async deleteFact(factId: number): Promise<DeleteFactResult> {
    this.assertHttpMode('deleteFact');
    return this.memory!.deleteFact(factId);
  }

  // Memory operations - Conversations
  async storeConversation(
    userMessage: string,
    agentResponse: string,
    agentId: string = 'main',
    sessionId?: string,
    tags?: string[]
  ): Promise<StoreConversationResult> {
    this.assertHttpMode('storeConversation');
    // Security scan input
    const scanResult = await this.security!.scanInput(userMessage);
    this.security!.assertAllowed(scanResult, 'store_conversation');

    return this.memory!.storeConversation(userMessage, agentResponse, agentId, sessionId, tags);
  }

  async searchConversations(
    query: string,
    agentId: string = 'main',
    limit: number = 10,
    dateFrom?: string,
    dateTo?: string
  ): Promise<SearchConversationsResult> {
    this.assertHttpMode('searchConversations');
    return this.memory!.searchConversations(query, agentId, limit, dateFrom, dateTo);
  }

  // Memory operations - Profile
  async getProfile(agentId: string = 'main'): Promise<GetProfileResult> {
    this.assertHttpMode('getProfile');
    return this.memory!.getProfile(agentId);
  }

  async updateProfile(
    updates: Record<string, unknown>,
    agentId: string = 'main',
    reason?: string
  ): Promise<UpdateProfileResult> {
    this.assertHttpMode('updateProfile');
    // Security scan input
    const scanResult = await this.security!.scanInput(JSON.stringify(updates));
    this.security!.assertAllowed(scanResult, 'update_profile');

    return this.memory!.updateProfile(updates, agentId, reason);
  }

  // Memory operations - Retrieval
  async retrieveMemories(
    query: string,
    agentId: string = 'main',
    limit: number = 5,
    includeConversations: boolean = true
  ): Promise<RetrieveMemoriesResult> {
    this.assertHttpMode('retrieveMemories');
    return this.memory!.retrieveMemories(query, agentId, limit, includeConversations);
  }

  // Memory operations - Stats
  async getMemoryStats(agentId: string = 'main'): Promise<GetMemoryStatsResult> {
    this.assertHttpMode('getMemoryStats');
    return this.memory!.getMemoryStats(agentId);
  }

  // Memory operations - Export/Import
  async exportMemory(
    agentId: string = 'main',
    format: 'markdown' | 'json' = 'markdown',
    includeConversations: boolean = true
  ): Promise<ExportMemoryResult> {
    this.assertHttpMode('exportMemory');
    return this.memory!.exportMemory(agentId, format, includeConversations);
  }

  async importMemory(filePath: string, agentId: string = 'main'): Promise<ImportMemoryResult> {
    this.assertHttpMode('importMemory');
    return this.memory!.importMemory(filePath, agentId);
  }

  // Filer operations - File operations
  async createFile(path: string, content: string, overwrite: boolean = false): Promise<unknown> {
    this.assertHttpMode('createFile');
    // Security scan the content
    const scanResult = await this.security!.scanInput(content);
    this.security!.assertAllowed(scanResult, 'create_file');

    return this.tools!.executeFiler('create_file', { path, content, overwrite });
  }

  async readFile(path: string): Promise<unknown> {
    this.assertHttpMode('readFile');
    return this.tools!.executeFiler('read_file', { path });
  }

  async listFiles(path: string = '.', recursive: boolean = false): Promise<unknown> {
    this.assertHttpMode('listFiles');
    return this.tools!.executeFiler('list_files', { path, recursive });
  }

  async updateFile(path: string, content: string, createBackup: boolean = true): Promise<unknown> {
    this.assertHttpMode('updateFile');
    // Security scan the content
    const scanResult = await this.security!.scanInput(content);
    this.security!.assertAllowed(scanResult, 'update_file');

    return this.tools!.executeFiler('update_file', { path, content, create_backup: createBackup });
  }

  async deleteFile(path: string): Promise<unknown> {
    this.assertHttpMode('deleteFile');
    return this.tools!.executeFiler('delete_file', { path });
  }

  async moveFile(source: string, destination: string): Promise<unknown> {
    this.assertHttpMode('moveFile');
    return this.tools!.executeFiler('move_file', { source, destination });
  }

  async copyFile(source: string, destination: string): Promise<unknown> {
    this.assertHttpMode('copyFile');
    return this.tools!.executeFiler('copy_file', { source, destination });
  }

  async searchFiles(
    query: string,
    searchIn: 'workspace' | 'granted' | 'all' = 'workspace',
    searchType: 'filename' | 'content' = 'filename',
    fileTypes?: string[]
  ): Promise<unknown> {
    this.assertHttpMode('searchFiles');
    return this.tools!.executeFiler('search_files', {
      query,
      search_in: searchIn,
      search_type: searchType,
      file_types: fileTypes,
    });
  }

  // Filer operations - Grant operations
  async checkGrant(path: string): Promise<unknown> {
    this.assertHttpMode('checkGrant');
    return this.tools!.executeFiler('check_grant', { path });
  }

  async requestGrant(path: string, permission: 'read' | 'read-write' | 'write', reason: string): Promise<unknown> {
    this.assertHttpMode('requestGrant');
    return this.tools!.executeFiler('request_grant', { path, permission, reason });
  }

  async listGrants(includeExpired: boolean = false): Promise<unknown> {
    this.assertHttpMode('listGrants');
    return this.tools!.executeFiler('list_grants', { include_expired: includeExpired });
  }

  // Filer operations - Info operations
  async getWorkspaceInfo(): Promise<unknown> {
    this.assertHttpMode('getWorkspaceInfo');
    return this.tools!.executeFiler('get_workspace_info', {});
  }

  async getAuditLog(
    limit: number = 50,
    operation?: string,
    startDate?: string,
    endDate?: string
  ): Promise<unknown> {
    this.assertHttpMode('getAuditLog');
    const args: Record<string, unknown> = { limit };
    if (operation) args.operation = operation;
    if (startDate) args.start_date = startDate;
    if (endDate) args.end_date = endDate;
    return this.tools!.executeFiler('get_audit_log', args);
  }

}

// Singleton instance
let orchestratorInstance: Orchestrator | null = null;

export async function getOrchestrator(): Promise<Orchestrator> {
  if (!orchestratorInstance) {
    orchestratorInstance = new Orchestrator();
    await orchestratorInstance.initialize();
  }
  return orchestratorInstance;
}
