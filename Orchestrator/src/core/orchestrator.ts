import { getConfig, type Config, type AgentDefinition, type ChannelBinding, getDefaultAgent, loadAgentsFromFile } from '../config/index.js';
import { guardianConfig } from '../config/guardian.js';
import { GuardianMCPClient } from '../mcp-clients/guardian.js';
import { StdioGuardianClient } from '../mcp-clients/stdio-guardian.js';
import { GuardedMCPClient } from '../mcp-clients/guarded-client.js';
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
import { HttpMCPClient } from '../mcp-clients/http-client.js';
import { StdioMCPClient } from '../mcp-clients/stdio-client.js';
import type { IMCPClient, ToolCallResult } from '../mcp-clients/types.js';
import { SecurityCoordinator } from './security.js';
import { SessionManager } from './sessions.js';
import { ToolExecutor, type ToolRegistry } from './tools.js';
import { ToolRouter } from './tool-router.js';
import { ChannelManager } from './channel-poller.js';
import { GenericChannelAdapter } from './adapters/generic-channel-adapter.js';
import { ThinkerClient } from './thinker-client.js';
import { AgentManager, type AgentStatus } from './agent-manager.js';
import { MessageRouter } from './message-router.js';
import { SlashCommandHandler } from './slash-commands.js';
import { HaltManager, getHaltManager } from './halt-manager.js';
import type { IncomingAgentMessage } from './agent-types.js';
import { logger, Logger } from '@mcp/shared/Utils/logger.js';

export interface MCPServerStatus {
  available: boolean;
  required: boolean;
  type: 'stdio' | 'http';
  port?: number;
}

export interface OrchestratorStatus {
  ready: boolean;
  uptime: number;
  mcpServers: Record<string, MCPServerStatus>;
  agents: AgentStatus[];
  sessions: { activeSessions: number; totalTurns: number };
  security: { blockedCount: number };
}

export class Orchestrator {
  private config: Config;
  private logger: Logger;
  private startTime: Date;

  // MCP Clients (HTTP mode — legacy)
  private guardian: GuardianMCPClient | null = null;
  private telegram: TelegramMCPClient | null = null;
  private onepassword: OnePasswordMCPClient | null = null;
  private memory: MemoryMCPClient | null = null;
  private filer: FilerMCPClient | null = null;

  // MCP Clients (stdio mode)
  private stdioClients: Map<string, StdioMCPClient> = new Map();
  // HTTP MCP clients active in stdio mode (auto-discovered)
  private httpClients: Map<string, HttpMCPClient> = new Map();

  // Core components
  private security: SecurityCoordinator | null = null;
  private sessions: SessionManager;
  private tools: ToolExecutor | null = null;
  private toolRouter: ToolRouter;

  // Channel polling & agent dispatch (multi-agent)
  private channelManager: ChannelManager | null = null;
  private agentManager: AgentManager | null = null;
  private messageRouter: MessageRouter | null = null;
  // Agent definitions (kept for tool policy lookups)
  private agentDefinitions: Map<string, AgentDefinition> = new Map();
  // Fallback single-agent client (used when no agents config is provided)
  private thinkerClient: ThinkerClient | null = null;
  // Slash command handler (intercepts /commands before LLM)
  private slashCommands: SlashCommandHandler;
  // Kill switch halt manager
  private haltManager: HaltManager;

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
    this.haltManager = getHaltManager();
    this.slashCommands = new SlashCommandHandler(this.toolRouter, this);

    if (this.connectionMode === 'stdio') {
      this.initializeStdioClients();
    } else {
      this.initializeHttpClients();
    }
  }

  // Guardian scanner adapter (stdio mode)
  private guardianScanner: StdioGuardianClient | null = null;

  private initializeStdioClients(): void {
    this.logger.info('Initializing MCP clients in stdio mode');

    const stdioConfigs = this.config.mcpServersStdio;
    if (!stdioConfigs) {
      this.logger.warn('No stdio MCP configs found');
      return;
    }

    // Create Guardian stdio client first (needed by GuardedMCPClient wrappers)
    if (stdioConfigs.guardian) {
      const guardianClient = new StdioMCPClient('guardian', stdioConfigs.guardian);
      this.stdioClients.set('guardian', guardianClient);

      if (guardianConfig.enabled) {
        this.guardianScanner = new StdioGuardianClient(guardianClient, guardianConfig.failMode);
        this.logger.info('Guardian security scanning enabled');
      } else {
        this.logger.info('Guardian security scanning disabled (guardian-config.enabled = false)');
      }
    }

    // Register all non-guardian stdio MCPs dynamically
    for (const [name, mcpConfig] of Object.entries(stdioConfigs)) {
      if (name === 'guardian') continue; // Already handled above

      const raw = new StdioMCPClient(name, mcpConfig);
      this.stdioClients.set(name, raw);

      const client = this.maybeGuard(name, raw);
      this.toolRouter.registerMCP(name, client);
    }

    // Register HTTP-only MCPs (auto-discovered with transport: "http")
    const httpConfigs = this.config.mcpServers;
    if (httpConfigs) {
      for (const [name, httpConfig] of Object.entries(httpConfigs)) {
        // Skip if already registered as stdio
        if (this.stdioClients.has(name)) continue;

        const raw = new HttpMCPClient(name, httpConfig);
        this.httpClients.set(name, raw);

        const client = this.maybeGuard(name, raw);
        this.toolRouter.registerMCP(name, client);
      }
    }
  }

  /**
   * Wrap an MCP client with Guardian scanning if configured.
   * Returns the original client if Guardian is disabled or no scanning is configured for this MCP.
   */
  private maybeGuard(mcpName: string, client: IMCPClient): IMCPClient {
    if (!this.guardianScanner) return client;

    const scanInput = guardianConfig.input[mcpName] ?? false;
    const scanOutput = guardianConfig.output[mcpName] ?? false;

    if (!scanInput && !scanOutput) return client;

    this.logger.info(`Guardian guarding ${mcpName} (input: ${scanInput}, output: ${scanOutput})`);

    return new GuardedMCPClient(client, this.guardianScanner, {
      scanInput,
      scanOutput,
      failMode: guardianConfig.failMode,
    });
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

  /**
   * Start agents and channel polling.
   * Must be called AFTER the HTTP server is listening so that
   * spawned Thinker processes can connect back to the Orchestrator.
   */
  async startAgents(): Promise<void> {
    // Initialize agents (multi-agent or single-agent fallback)
    await this.initializeAgents();

    // Start channel polling if enabled (dispatches messages to agents)
    if (this.config.channelPolling.enabled) {
      await this.startChannelPolling();
    }
  }

  private async initializeStdioMode(): Promise<void> {
    // Initialize all stdio clients in parallel
    const initPromises: Promise<void>[] = [];
    for (const [name, client] of this.stdioClients) {
      this.logger.info(`Spawning ${name} MCP via stdio...`);
      initPromises.push(client.initialize());
    }

    // Initialize HTTP clients (auto-discovered, run as independent services)
    for (const [name, client] of this.httpClients) {
      this.logger.info(`Connecting to ${name} MCP via HTTP...`);
      initPromises.push(client.initialize());
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
    for (const [name, client] of this.httpClients) {
      const url = httpConfigs?.[name]?.url ?? 'unknown';
      this.logger.info(
        `  ${name}: ${client.isAvailable ? green + '✓ available' + reset : red + '✗ unavailable' + reset} (http: ${url})`
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
      // Guardian is health-checked but not registered with tool router
      // (it's used internally via StdioGuardianClient, not as a passthrough MCP)
      const isGuardian = name === 'guardian';

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
          // Don't re-register guardian with tool router — it's used via StdioGuardianClient
          if (!isGuardian) {
            this.toolRouter.registerMCP(name, client);
            needsRediscovery = true;
          }
        }
      }
    }

    if (needsRediscovery) {
      this.logger.info('Re-discovering tools after MCP restart...');
      await this.toolRouter.discoverTools();
    }
  }

  // ─── Agent Management ────────────────────────────────────────────

  /**
   * Initialize agents: either multi-agent via AgentManager or single-agent fallback.
   * Also sets up the MessageRouter if bindings are configured.
   */
  private async initializeAgents(): Promise<void> {
    // Try to load agents config from file
    let agentDefs: AgentDefinition[] | undefined = this.config.agents;
    let bindings: ChannelBinding[] | undefined = this.config.bindings;

    if (!agentDefs && this.config.agentsConfigPath) {
      const loaded = await loadAgentsFromFile(this.config.agentsConfigPath);
      if (loaded) {
        agentDefs = loaded.agents;
        bindings = bindings ?? loaded.bindings;
        this.logger.info(`Loaded ${agentDefs.length} agent definition(s) from ${this.config.agentsConfigPath}`);
      } else {
        this.logger.warn(`Could not load agents config from ${this.config.agentsConfigPath} — falling back to single agent`);
      }
    }

    if (agentDefs && agentDefs.length > 0) {
      // Store agent definitions for tool policy lookups
      for (const def of agentDefs) {
        this.agentDefinitions.set(def.agentId, def);
      }

      // Multi-agent mode: spawn Thinker instances via AgentManager
      this.agentManager = new AgentManager();
      await this.agentManager.initializeAll(agentDefs);
      this.logger.info(`AgentManager initialized: ${this.agentManager.getAvailableCount()} agent(s) available`);

      // Set up message router with bindings
      const defaultAgentId = this.agentManager.getDefaultAgentId() ?? agentDefs[0].agentId;
      this.messageRouter = new MessageRouter(bindings ?? [], defaultAgentId);
    } else {
      // Single-agent fallback: use thinkerUrl directly (backward compatible)
      this.thinkerClient = new ThinkerClient(this.config.thinkerUrl);
      const healthy = await this.thinkerClient.healthCheck();
      if (healthy) {
        this.logger.info(`Single-agent Thinker connected at ${this.config.thinkerUrl}`);
      } else {
        this.logger.warn(`Single-agent Thinker at ${this.config.thinkerUrl} is not responding`);
      }
    }
  }

  // ─── Channel Polling & Agent Dispatch ──────────────────────────────

  /**
   * Start polling channels and dispatching messages to agents.
   */
  private async startChannelPolling(): Promise<void> {
    this.logger.info('Starting channel polling...');

    const manager = new ChannelManager({
      intervalMs: this.config.channelPolling.intervalMs,
      maxMessagesPerCycle: this.config.channelPolling.maxMessagesPerCycle,
    });

    // Auto-register adapters for every discovered channel MCP — no special cases
    for (const entry of this.config.channelMCPs) {
      const adapterConfig = {
        botPatterns: entry.botPatterns,
        chatRefreshIntervalMs: entry.chatRefreshIntervalMs,
        maxMessageAgeMs: entry.maxMessageAgeMs,
      };
      manager.registerAdapter(new GenericChannelAdapter(entry.name, this.toolRouter, adapterConfig));
    }

    manager.onMessage = (msg: IncomingAgentMessage) => this.dispatchMessage(msg);

    await manager.initialize();
    manager.start();

    this.channelManager = manager;
    this.logger.info('Channel polling started');
  }

  /**
   * Stop channel polling.
   */
  stopChannelPolling(): void {
    if (this.channelManager) {
      this.channelManager.stop();
      this.channelManager = null;
      this.logger.info('Channel polling stopped');
    }
  }

  /**
   * Dispatch a message to the appropriate agent and relay the response back to the channel.
   * Uses MessageRouter to resolve which agent handles the message.
   */
  private async dispatchMessage(msg: IncomingAgentMessage): Promise<void> {
    // Slash command interception — handle before LLM (no tokens)
    if (msg.text.startsWith('/')) {
      const result = await this.slashCommands.tryHandle(msg);
      if (result.handled) {
        const response = result.response || result.error || 'Command processed.';
        await this.sendToChannel(msg.channel, msg.chatId, response);
        this.logger.info(`Slash command handled: ${msg.text.split(' ')[0]}`, { command: msg.text, response });
        return;
      }
    }

    // Resolve agent via MessageRouter (if available), otherwise use msg.agentId
    let targetAgentId = msg.agentId;
    if (this.messageRouter) {
      const resolved = this.messageRouter.resolveAgents(msg.channel, msg.chatId);
      if (resolved.length > 0) {
        targetAgentId = resolved[0];
      }
    }

    // Pre-dispatch: check if agent is already paused by cost controls
    if (this.agentManager?.isAgentPaused(targetAgentId)) {
      this.logger.warn(`Dropping message for cost-paused agent "${targetAgentId}"`);
      await this.sendToChannel(msg.channel, msg.chatId,
        `Agent is currently paused due to cost controls and is not processing messages.`);
      return;
    }

    // Resolve which client to use
    const client = this.resolveClient(targetAgentId);
    if (!client) {
      this.logger.error(`Cannot dispatch message — no agent available for agentId="${targetAgentId}"`);
      return;
    }

    this.logger.info(`Dispatching to agent: chat=${msg.chatId}, agent=${targetAgentId}`);

    const result = await client.processMessage(msg);

    // Handle cost-control pause signal from Thinker
    if (result.paused) {
      this.logger.warn(`Agent "${targetAgentId}" paused by cost controls: ${result.error}`);

      if (this.agentManager) {
        this.agentManager.markPaused(targetAgentId, result.error || 'Cost limit exceeded');
      }

      // Send notification to configured channel (or fall back to originating channel)
      const agentDef = this.agentDefinitions.get(targetAgentId);
      const notifyChannel = agentDef?.costControls?.notifyChannel || msg.channel;
      const notifyChatId = agentDef?.costControls?.notifyChatId || msg.chatId;
      await this.sendToChannel(notifyChannel, notifyChatId,
        `Agent "${targetAgentId}" has been paused due to unusual token consumption.\n\nReason: ${result.error}\n\nThe agent will not process messages until resumed.`);

      return;
    }

    if (result.success && result.response) {
      // Send response back to the originating channel
      await this.sendToChannel(msg.channel, msg.chatId, result.response);

      // Store conversation in memory
      await this.toolRouter.routeToolCall('memory_store_conversation', {
        agent_id: msg.agentId,
        user_message: msg.text,
        agent_response: result.response,
      });

      this.logger.info(
        `Response delivered: chat=${msg.chatId}, steps=${result.totalSteps}, tools=${result.toolsUsed.join(', ') || 'none'}`
      );
    } else {
      this.logger.error(`Agent processing failed: ${result.error}`);
      // Send brief error notification — adapter filters by botUserId + botMessagePatterns
      await this.sendToChannel(msg.channel, msg.chatId,
        `Sorry, I couldn't complete that request. Please try again.`);
    }
  }

  /**
   * Send a message to a channel via its adapter.
   * Looks up the adapter from the ChannelManager and delegates to it.
   */
  private async sendToChannel(channel: string, chatId: string, message: string): Promise<void> {
    const adapter = this.channelManager?.getAdapter(channel);
    if (adapter) {
      try {
        await adapter.sendMessage(chatId, message);
      } catch (error) {
        this.logger.error(`Failed to send to channel "${channel}"`, { error });
      }
    } else {
      this.logger.warn(`No adapter for channel "${channel}" — response dropped`);
    }
  }

  /**
   * Resolve a ThinkerClient for the given agentId.
   * In multi-agent mode: looks up via AgentManager.
   * In single-agent mode: returns the fallback thinkerClient.
   */
  private resolveClient(agentId?: string): ThinkerClient | null {
    if (this.agentManager) {
      // Try specific agent first, then fall back to default
      if (agentId) {
        const client = this.agentManager.getClient(agentId);
        if (client) return client;
      }
      return this.agentManager.getDefaultClient();
    }
    return this.thinkerClient;
  }

  /**
   * Get a Thinker client for a specific agent (for Inngest skill execution passthrough).
   * Falls back to default agent if agentId not found.
   */
  getThinkerClient(agentId?: string): ThinkerClient | null {
    return this.resolveClient(agentId);
  }

  /**
   * Get the AgentManager (for status reporting, etc.)
   */
  getAgentManager(): AgentManager | null {
    return this.agentManager;
  }

  /**
   * Get the MessageRouter (for status reporting).
   */
  getMessageRouter(): MessageRouter | null {
    return this.messageRouter;
  }

  /**
   * Get agent definition by ID (for tool policy enforcement).
   */
  getAgentDefinition(agentId: string): AgentDefinition | undefined {
    return this.agentDefinitions.get(agentId);
  }

  /**
   * Get the HaltManager (for kill switch).
   */
  getHaltManager(): HaltManager {
    return this.haltManager;
  }

  /**
   * Get the ChannelManager (for kill switch — stop/start polling).
   */
  getChannelManager(): ChannelManager | null {
    return this.channelManager;
  }

  /**
   * Restart channel polling (used by /resume telegram).
   */
  async restartChannelPolling(): Promise<void> {
    if (this.channelManager) return; // already running
    if (this.config.channelPolling.enabled) {
      await this.startChannelPolling();
    }
  }

  // ─── HTTP Mode Helpers ────────────────────────────────────────────

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

  private extractPort(url: string): number | undefined {
    try {
      return new URL(url).port ? parseInt(new URL(url).port, 10) : undefined;
    } catch {
      return undefined;
    }
  }

  getStatus(): OrchestratorStatus {
    const uptime = Date.now() - this.startTime.getTime();
    const httpConfigs = this.config.mcpServers;

    const mcpServers: Record<string, MCPServerStatus> = {};
    let blockedCount = 0;

    if (this.connectionMode === 'stdio') {
      // Stdio MCPs
      for (const [name, client] of this.stdioClients) {
        mcpServers[name] = {
          available: client.isAvailable,
          required: client.isRequired,
          type: 'stdio',
        };
      }

      // HTTP MCPs (auto-discovered) — also active in stdio mode
      for (const [name, client] of this.httpClients) {
        mcpServers[name] = {
          available: client.isAvailable,
          required: client.isRequired,
          type: 'http',
          port: httpConfigs?.[name] ? this.extractPort(httpConfigs[name].url) : undefined,
        };
      }
    } else {
      // In HTTP mode, all MCPs have ports
      mcpServers['guardian'] = {
        available: this.guardian?.isAvailable ?? false,
        required: this.guardian?.isRequired ?? false,
        type: 'http',
        port: httpConfigs?.guardian ? this.extractPort(httpConfigs.guardian.url) : undefined,
      };
      mcpServers['memory'] = {
        available: this.memory?.isAvailable ?? false,
        required: this.memory?.isRequired ?? false,
        type: 'http',
        port: httpConfigs?.memory ? this.extractPort(httpConfigs.memory.url) : undefined,
      };
      mcpServers['filer'] = {
        available: this.filer?.isAvailable ?? false,
        required: this.filer?.isRequired ?? false,
        type: 'http',
        port: httpConfigs?.filer ? this.extractPort(httpConfigs.filer.url) : undefined,
      };

      // Include tool-based status (searcher, gmail, etc.)
      const toolStatus = this.tools?.getToolStatus() ?? {};
      for (const [name, info] of Object.entries(toolStatus)) {
        const configEntry = httpConfigs?.[name as keyof typeof httpConfigs];
        mcpServers[name] = {
          ...info,
          type: 'http',
          port: configEntry ? this.extractPort(configEntry.url) : undefined,
        };
      }

      blockedCount = this.security?.getBlockedCount() ?? 0;
    }

    return {
      ready: this.initialized,
      uptime,
      mcpServers,
      agents: this.agentManager?.getStatus() ?? [],
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

  /**
   * Call a Guardian MCP tool directly (bypasses tool router).
   * Guardian is not registered with the tool router — it's used internally.
   * Returns null if Guardian is unavailable.
   */
  async callGuardianTool(toolName: string, args: Record<string, unknown>): Promise<ToolCallResult | null> {
    const guardianClient = this.stdioClients.get('guardian');
    if (!guardianClient?.isAvailable) return null;
    return guardianClient.callTool({ name: toolName, arguments: args });
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
