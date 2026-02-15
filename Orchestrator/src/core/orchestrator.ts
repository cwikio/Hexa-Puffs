import { getConfig, type Config, type AgentDefinition, type ChannelBinding, type MCPMetadata, getDefaultAgent, loadAgentsFromFile } from '../config/index.js';
import { guardianConfig } from '../config/guardian.js';
import { StdioGuardianClient } from '../mcp-clients/stdio-guardian.js';
import { GuardedMCPClient } from '../mcp-clients/guarded-client.js';
import { StdioMCPClient } from '../mcp-clients/stdio-client.js';
import type { IMCPClient, ToolCallResult } from '../mcp-clients/types.js';
import { SessionManager } from '../agents/sessions.js';
import { ToolRouter } from '../routing/tool-router.js';
import { ChannelManager } from '../channels/channel-poller.js';
import { GenericChannelAdapter } from '../channels/adapters/generic-channel-adapter.js';
import { ThinkerClient } from '../agents/thinker-client.js';
import { AgentManager, type AgentStatus } from '../agents/agent-manager.js';
import { MessageRouter } from '../agents/message-router.js';
import { SlashCommandHandler } from '../commands/slash-commands.js';
import { HaltManager, getHaltManager } from './halt-manager.js';
import { loadSnapshot, saveSnapshot, computeDiff, type MCPSnapshot, type MCPDiff, type MCPSnapshotEntry } from './startup-diff.js';
import { ExternalMCPWatcher } from './external-watcher.js';
import { loadExternalMCPs, type ExternalMCPEntry } from '@mcp/shared/Discovery/external-loader.js';
import type { IncomingAgentMessage } from '../agents/agent-types.js';
import { logger, Logger } from '@mcp/shared/Utils/logger.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MCPS_ROOT = resolve(__dirname, '../../../');

export interface MCPServerStatus {
  available: boolean;
  required: boolean;
  type: 'stdio';
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

  // MCP Clients (all stdio)
  private stdioClients: Map<string, StdioMCPClient> = new Map();

  // Core components
  private sessions: SessionManager;
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
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly HEALTH_CHECK_INTERVAL_MS = 60_000; // 60 seconds

  // External MCP tracking (mutable — updated by hot-reload)
  private externalMCPNames: Set<string> = new Set();
  private externalWatcher: ExternalMCPWatcher | null = null;

  constructor() {
    this.config = getConfig();
    this.logger = logger.child('orchestrator');
    this.startTime = new Date();
    this.sessions = new SessionManager();
    this.toolRouter = new ToolRouter({ alwaysPrefix: true, separator: '_' });
    this.haltManager = getHaltManager();
    this.slashCommands = new SlashCommandHandler(this.toolRouter, this);

    // Initialize external MCP name tracking from config
    for (const name of this.config.externalMCPNames ?? []) {
      this.externalMCPNames.add(name);
    }

    this.initializeStdioClients();
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

      const client = this.maybeGuard(name, raw, mcpConfig.metadata);
      this.toolRouter.registerMCP(name, client, mcpConfig.metadata);
    }
  }

  /**
   * Wrap an MCP client with Guardian scanning if configured.
   * Priority: manifest metadata → guardian.ts legacy maps → global defaults.
   * Returns the original client if Guardian is disabled or no scanning is configured for this MCP.
   */
  private maybeGuard(mcpName: string, client: IMCPClient, metadata?: MCPMetadata): IMCPClient {
    if (!this.guardianScanner) return client;

    const scanInput = metadata?.guardianScan?.input
      ?? guardianConfig.input[mcpName]
      ?? guardianConfig.defaultInput;
    const scanOutput = metadata?.guardianScan?.output
      ?? guardianConfig.output[mcpName]
      ?? guardianConfig.defaultOutput;

    if (!scanInput && !scanOutput) return client;

    this.logger.info(`Guardian guarding ${mcpName} (input: ${scanInput}, output: ${scanOutput})`);

    return new GuardedMCPClient(client, this.guardianScanner, {
      scanInput,
      scanOutput,
      failMode: guardianConfig.failMode,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info('Initializing Orchestrator (stdio mode)...');

    await this.initializeStdioMode();

    // Discover tools from all MCPs for passthrough routing
    await this.toolRouter.discoverTools();

    this.initialized = true;
    this.logger.info('Orchestrator initialized successfully');

    // Start health monitoring for stdio clients
    this.startHealthMonitoring();

    // Compute startup diff and send notification (best-effort, non-blocking)
    const diff = this.computeStartupDiff();
    this.sendStartupNotification(diff).catch((err) =>
      this.logger.warn('Startup notification failed', { error: err }),
    );

    // Start watching external-mcps.json for hot-reload
    this.startExternalMCPWatcher();
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

    // Lazy-spawn: ensure agent is running before dispatch
    if (this.agentManager) {
      const ready = await this.agentManager.ensureRunning(targetAgentId);
      if (!ready) {
        this.logger.error(`Cannot dispatch — agent "${targetAgentId}" failed to start`);
        await this.sendToChannel(msg.channel, msg.chatId, 'Agent is currently unavailable. Please try again in a moment.');
        return;
      }
      this.agentManager.updateActivity(targetAgentId);
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

    // Handle cost-control pause when agent was ALREADY paused (no response produced)
    if (result.paused && !result.success) {
      this.logger.warn(`Agent "${targetAgentId}" paused by cost controls: ${result.error}`);

      if (this.agentManager) {
        this.agentManager.markPaused(targetAgentId, result.error || 'Cost limit exceeded');
      }

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

      // Cost monitor tripped DURING this request — deliver response first, then notify
      if (result.paused) {
        this.logger.warn(`Agent "${targetAgentId}" paused by cost controls after delivering response`);

        if (this.agentManager) {
          this.agentManager.markPaused(targetAgentId, 'Cost limit exceeded during request');
        }

        const agentDef = this.agentDefinitions.get(targetAgentId);
        const notifyChannel = agentDef?.costControls?.notifyChannel || msg.channel;
        const notifyChatId = agentDef?.costControls?.notifyChatId || msg.chatId;
        await this.sendToChannel(notifyChannel, notifyChatId,
          `Agent "${targetAgentId}" has been paused due to unusual token consumption.\n\nThe agent will not process messages until resumed.`);
      }
    } else {
      this.logger.error(`Agent processing failed: ${result.error}`);
      // Send brief error notification — adapter filters by botUserId + botMessagePatterns
      const userMessage = this.getUserErrorMessage(result.error);
      await this.sendToChannel(msg.channel, msg.chatId, userMessage);
    }
  }

  /**
   * Map known error patterns to user-friendly messages.
   */
  private getUserErrorMessage(error?: string): string {
    if (!error) return 'Sorry, I couldn\'t complete that request. Please try again.';

    const lower = error.toLowerCase();
    if (lower.includes('forbidden') || lower.includes('403') || lower.includes('access denied')) {
      return 'Groq API error — are you on VPN? Turn it off and try again.';
    }

    return 'Sorry, I couldn\'t complete that request. Please try again.';
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
   * Register a dynamic agent definition (for subagent tool policy lookups).
   */
  registerAgentDefinition(def: AgentDefinition): void {
    this.agentDefinitions.set(def.agentId, def);
  }

  /**
   * Unregister a dynamic agent definition (cleanup after subagent killed).
   */
  unregisterAgentDefinition(agentId: string): void {
    this.agentDefinitions.delete(agentId);
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

  getStatus(): OrchestratorStatus {
    const uptime = Date.now() - this.startTime.getTime();

    const mcpServers: Record<string, MCPServerStatus> = {};

    for (const [name, client] of this.stdioClients) {
      mcpServers[name] = {
        available: client.isAvailable,
        required: client.isRequired,
        type: 'stdio',
      };
    }

    return {
      ready: this.initialized,
      uptime,
      mcpServers,
      agents: this.agentManager?.getStatus() ?? [],
      sessions: this.sessions.getStats(),
      security: {
        blockedCount: 0,
      },
    };
  }

  getAvailableTools(): string[] {
    return this.toolRouter.getToolDefinitions().map((t) => t.name);
  }

  /**
   * Get the tool router for passthrough routing
   */
  getToolRouter(): ToolRouter {
    return this.toolRouter;
  }

  /**
   * Run health checks on all stdio MCP clients.
   * Returns per-MCP status with internal/external classification.
   */
  async checkMCPHealth(scope: 'all' | 'internal' | 'external' = 'all'): Promise<
    Array<{ name: string; available: boolean; healthy: boolean; type: 'internal' | 'external' }>
  > {
    const externalNames = this.externalMCPNames;
    const results: Array<{ name: string; available: boolean; healthy: boolean; type: 'internal' | 'external' }> = [];

    for (const [name, client] of this.stdioClients) {
      const isExternal = externalNames.has(name);
      if (scope === 'internal' && isExternal) continue;
      if (scope === 'external' && !isExternal) continue;

      const healthy = await client.healthCheck();
      results.push({
        name,
        available: client.isAvailable,
        healthy,
        type: isExternal ? 'external' : 'internal',
      });
    }

    return results;
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

  // ─── Startup Diff ────────────────────────────────────────────────

  private static readonly SNAPSHOT_PATH = resolve(homedir(), '.annabelle', 'last-known-mcps.json');

  /**
   * Build a snapshot of current MCPs, compare with previous boot, save new snapshot.
   */
  private computeStartupDiff(): MCPDiff {
    const entries: MCPSnapshotEntry[] = [];
    for (const name of this.stdioClients.keys()) {
      entries.push({
        name,
        type: this.externalMCPNames.has(name) ? 'external' : 'internal',
      });
    }

    const current: MCPSnapshot = {
      timestamp: new Date().toISOString(),
      mcps: entries,
    };

    const previous = loadSnapshot(Orchestrator.SNAPSHOT_PATH);
    const diff = computeDiff(previous, current);
    saveSnapshot(Orchestrator.SNAPSHOT_PATH, current);

    if (diff.added.length > 0 || diff.removed.length > 0) {
      this.logger.info('MCP diff since last boot', { added: diff.added, removed: diff.removed });
    }

    return diff;
  }

  // ─── Startup Notification ────────────────────────────────────────

  /**
   * Send a Telegram notification summarizing the startup state.
   */
  private async sendStartupNotification(diff: MCPDiff): Promise<void> {
    const agentDef = this.getAgentDefinition('annabelle');
    const chatId = agentDef?.costControls?.notifyChatId || process.env.NOTIFY_CHAT_ID;
    if (!chatId) {
      this.logger.debug('No chat ID for startup notification — skipping');
      return;
    }

    const internalCount = [...this.stdioClients.keys()].filter(
      (n) => !this.externalMCPNames.has(n),
    ).length;
    const externalCount = this.externalMCPNames.size;
    const total = this.stdioClients.size;

    // Build tool names per MCP
    const toolsByMCP = new Map<string, string[]>();
    for (const route of this.toolRouter.getAllRoutes()) {
      const list = toolsByMCP.get(route.mcpName) ?? [];
      list.push(route.originalName);
      toolsByMCP.set(route.mcpName, list);
    }

    const lines: string[] = [
      'Orchestrator started',
      `MCPs: ${total} total (${internalCount} internal, ${externalCount} external)`,
    ];

    if (externalCount > 0) {
      lines.push('', 'External:');
      for (const name of this.externalMCPNames) {
        const tools = toolsByMCP.get(name) ?? [];
        const desc = this.config.mcpServersStdio?.[name]?.description;
        lines.push(desc ? `  ${name}: ${tools.length} tools — ${desc}` : `  ${name}: ${tools.length} tools`);
        for (const tool of tools) {
          lines.push(`    • ${tool}`);
        }
      }
    }

    if (diff.added.length > 0 || diff.removed.length > 0) {
      lines.push('', 'Changes since last boot:');
      for (const name of diff.added) lines.push(`  + ${name}`);
      for (const name of diff.removed) lines.push(`  - ${name}`);
    }

    const failed = [...this.stdioClients.entries()]
      .filter(([, client]) => !client.isAvailable)
      .map(([name]) => name);
    if (failed.length > 0) {
      lines.push('', `Failed: ${failed.join(', ')}`);
    }

    const message = lines.join('\n');

    try {
      await this.toolRouter.routeToolCall('telegram_send_message', {
        chat_id: chatId,
        message,
      });
    } catch (err) {
      this.logger.warn('Failed to send startup notification via Telegram', { error: err });
    }
  }

  // ─── External MCP Hot-Reload ─────────────────────────────────────

  /**
   * Start watching external-mcps.json for changes.
   */
  private startExternalMCPWatcher(): void {
    const configPath = resolve(MCPS_ROOT, 'external-mcps.json');

    // Build initial externals map from config
    const initialExternals: Record<string, ExternalMCPEntry> = {};
    for (const name of this.externalMCPNames) {
      const cfg = this.config.mcpServersStdio?.[name];
      if (cfg) {
        initialExternals[name] = {
          command: cfg.command,
          args: cfg.args,
          env: cfg.env,
          timeout: cfg.timeout,
          required: false,
          sensitive: cfg.sensitive,
          description: cfg.description,
        };
      }
    }

    this.externalWatcher = new ExternalMCPWatcher(
      configPath,
      async (added, removed) => {
        await this.handleExternalMCPChange(added, removed);
      },
      initialExternals,
    );

    this.externalWatcher.start();
  }

  /**
   * Stop watching external-mcps.json.
   */
  stopExternalMCPWatcher(): void {
    this.externalWatcher?.stop();
    this.externalWatcher = null;
  }

  /**
   * Handle additions and removals of external MCPs at runtime.
   */
  private async handleExternalMCPChange(
    added: Map<string, ExternalMCPEntry>,
    removed: string[],
  ): Promise<void> {
    // Remove old MCPs
    for (const name of removed) {
      const client = this.stdioClients.get(name);
      if (client) {
        this.logger.info(`Hot-reload: removing external MCP "${name}"`);
        await client.close();
        this.stdioClients.delete(name);
        this.toolRouter.unregisterMCP(name);
      }
      this.externalMCPNames.delete(name);
    }

    // Add new MCPs
    for (const [name, entry] of added) {
      // Guard against name conflicts with internal MCPs
      if (this.stdioClients.has(name) && !this.externalMCPNames.has(name)) {
        this.logger.warn(`Hot-reload: external MCP "${name}" conflicts with internal MCP — skipping`);
        continue;
      }

      this.logger.info(`Hot-reload: adding external MCP "${name}"`);
      const raw = new StdioMCPClient(name, entry);
      try {
        await raw.initialize();
      } catch (err) {
        this.logger.error(`Hot-reload: failed to initialize external MCP "${name}"`, { error: err });
        continue;
      }

      this.stdioClients.set(name, raw);
      this.externalMCPNames.add(name);

      const client = this.maybeGuard(name, raw, entry.metadata);
      this.toolRouter.registerMCP(name, client, entry.metadata);
    }

    // Rebuild routes if anything changed
    if (added.size > 0 || removed.length > 0) {
      await this.toolRouter.discoverTools();

      // Save updated snapshot
      const entries: MCPSnapshotEntry[] = [];
      for (const n of this.stdioClients.keys()) {
        entries.push({ name: n, type: this.externalMCPNames.has(n) ? 'external' : 'internal' });
      }
      saveSnapshot(Orchestrator.SNAPSHOT_PATH, {
        timestamp: new Date().toISOString(),
        mcps: entries,
      });

      // Notify via Telegram (best-effort)
      this.sendHotReloadNotification(added, removed).catch((err) =>
        this.logger.warn('Hot-reload notification failed', { error: err }),
      );
    }
  }

  /**
   * Send Telegram notification about hot-reload changes.
   */
  private async sendHotReloadNotification(
    added: Map<string, ExternalMCPEntry>,
    removed: string[],
  ): Promise<void> {
    const agentDef = this.getAgentDefinition('annabelle');
    const chatId = agentDef?.costControls?.notifyChatId || process.env.NOTIFY_CHAT_ID;
    if (!chatId) return;

    const lines: string[] = ['External MCPs changed:'];

    for (const [name, entry] of added) {
      const tools = this.toolRouter.getAllRoutes().filter((r) => r.mcpName === name);
      lines.push(entry.description
        ? `  + ${name}: ${tools.length} tools — ${entry.description}`
        : `  + ${name}: ${tools.length} tools`);
      for (const tool of tools) {
        lines.push(`    • ${tool.originalName}`);
      }
    }
    for (const name of removed) {
      lines.push(`  - ${name}`);
    }

    await this.toolRouter.routeToolCall('telegram_send_message', {
      chat_id: chatId,
      message: lines.join('\n'),
    });
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
