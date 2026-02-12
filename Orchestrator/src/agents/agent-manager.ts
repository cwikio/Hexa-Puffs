/**
 * AgentManager - Spawns and manages multiple Thinker agent instances.
 *
 * Each agent is a separate Node.js process running Thinker, configured
 * with its own port, LLM provider, model, and system prompt.
 *
 * Features:
 * - Lazy-spawn: agents register on startup but only spawn on first message
 * - Idle-kill: running agents are stopped after configurable inactivity
 * - Health monitoring: auto-restart crashed running agents
 * - Subagent spawning: dynamic temporary agents with parent-child lifecycle
 */

import { spawn, type ChildProcess } from 'child_process';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger, Logger } from '@mcp/shared/Utils/logger.js';
import { ThinkerClient } from './thinker-client.js';
import type { AgentDefinition } from '../config/agents.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Orchestrator/dist/core/ → Orchestrator/ → MCPs/
const MCPS_ROOT = resolve(__dirname, '../../../');

// ─── Types ──────────────────────────────────────────────────────

export type AgentState = 'stopped' | 'starting' | 'running' | 'stopping';

interface ManagedAgent {
  definition: AgentDefinition;
  client: ThinkerClient;
  process: ChildProcess | null;
  available: boolean;
  promptFilePath: string | null;
  restartCount: number;
  lastRestartAt: number;
  paused: boolean;
  pauseReason: string | null;
  // Lazy-spawn / idle-kill (P10)
  state: AgentState;
  lastActivityAt: number;
  spawnPromise: Promise<void> | null;
  // Subagent tracking (P7)
  parentAgentId: string | null;
  isSubagent: boolean;
  autoKillTimer: ReturnType<typeof setTimeout> | null;
}

export interface AgentStatus {
  agentId: string;
  available: boolean;
  port: number;
  restartCount: number;
  pid: number | null;
  paused: boolean;
  pauseReason: string | null;
  state: AgentState;
  lastActivityAt: number;
  parentAgentId: string | null;
  isSubagent: boolean;
}

export interface SpawnSubagentOptions {
  parentAgentId: string;
  task: string;
  allowedTools?: string[];
  deniedTools?: string[];
  timeoutMinutes?: number;
  model?: string;
}

// ─── AgentManager ───────────────────────────────────────────────

export class AgentManager {
  private agents: Map<string, ManagedAgent> = new Map();
  private logger: Logger;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private idleScanTimer: ReturnType<typeof setInterval> | null = null;
  private subagentsByParent: Map<string, Set<string>> = new Map();

  private static readonly HEALTH_CHECK_INTERVAL_MS = 30_000;
  private static readonly MAX_RESTART_ATTEMPTS = 5;
  private static readonly RESTART_COOLDOWN_MS = 10_000;
  private static readonly IDLE_SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 min
  private static readonly MAX_SUBAGENTS_PER_PARENT = 5;
  private static readonly PROMPTS_DIR = resolve(MCPS_ROOT, '.annabelle/agent-prompts');

  constructor() {
    this.logger = logger.child('agent-manager');
  }

  // ─── Initialization (Lazy-Spawn) ──────────────────────────────

  /**
   * Register all enabled agents without spawning them.
   * Agents are spawned on demand when ensureRunning() is called.
   */
  async initializeAll(definitions: AgentDefinition[]): Promise<void> {
    const enabled = definitions.filter(d => d.enabled);
    this.logger.info(`Registering ${enabled.length} agent(s) (lazy-spawn)...`);

    await mkdir(AgentManager.PROMPTS_DIR, { recursive: true });

    for (const def of enabled) {
      this.registerAgent(def);
    }

    this.startHealthMonitoring();
    this.startIdleScanner();
    this.logger.info(`Registered ${enabled.length} agent(s) — will spawn on first message`);
  }

  /**
   * Register an agent definition without spawning its process.
   */
  private registerAgent(definition: AgentDefinition): void {
    const { agentId, port } = definition;
    const client = new ThinkerClient(`http://localhost:${port}`);
    const managed: ManagedAgent = {
      definition,
      client,
      process: null,
      available: false,
      promptFilePath: null,
      restartCount: 0,
      lastRestartAt: 0,
      paused: false,
      pauseReason: null,
      state: 'stopped',
      lastActivityAt: 0,
      spawnPromise: null,
      parentAgentId: null,
      isSubagent: false,
      autoKillTimer: null,
    };
    this.agents.set(agentId, managed);
    this.logger.debug(`Registered agent "${agentId}" (port ${port}, idle timeout ${definition.idleTimeoutMinutes}m)`);
  }

  /**
   * Ensure an agent is running. Spawns on demand if stopped.
   * Deduplicates concurrent calls — multiple callers wait for a single spawn.
   */
  async ensureRunning(agentId: string): Promise<boolean> {
    const managed = this.agents.get(agentId);
    if (!managed) return false;

    if (managed.state === 'running' && managed.available) return true;

    // If already starting, wait for the existing spawn
    if (managed.state === 'starting' && managed.spawnPromise) {
      await managed.spawnPromise;
      return managed.available;
    }

    // Spawn
    this.logger.info(`Lazy-spawning agent "${agentId}"...`);
    managed.state = 'starting';
    managed.spawnPromise = this.spawnAgent(managed.definition);
    try {
      await managed.spawnPromise;
      managed.state = managed.available ? 'running' : 'stopped';
    } catch (error) {
      this.logger.error(`Failed to spawn agent "${agentId}"`, { error });
      managed.state = 'stopped';
    } finally {
      managed.spawnPromise = null;
    }
    return managed.available;
  }

  /**
   * Update last activity timestamp for an agent (called on every message dispatch).
   */
  updateActivity(agentId: string): void {
    const managed = this.agents.get(agentId);
    if (managed) managed.lastActivityAt = Date.now();
  }

  // ─── Spawn / Stop ─────────────────────────────────────────────

  /**
   * Spawn a single Thinker agent process.
   */
  private async spawnAgent(definition: AgentDefinition): Promise<void> {
    const { agentId, port } = definition;
    this.logger.info(`Spawning agent "${agentId}" on port ${port === 0 ? 'dynamic' : port}...`);

    // Write system prompt to file if provided
    let promptFilePath: string | null = null;
    if (definition.systemPrompt) {
      promptFilePath = resolve(AgentManager.PROMPTS_DIR, `${agentId}.txt`);
      await writeFile(promptFilePath, definition.systemPrompt, 'utf-8');
      this.logger.debug(`Wrote system prompt for "${agentId}" to ${promptFilePath}`);
    }

    // Build environment variables for the Thinker process
    const env = this.buildAgentEnv(definition, promptFilePath);

    // Spawn the Thinker process
    const thinkerEntrypoint = resolve(MCPS_ROOT, 'Thinker/dist/index.js');
    const child = spawn('node', [thinkerEntrypoint], {
      env,
      cwd: resolve(MCPS_ROOT, 'Thinker'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Pipe stdout/stderr with thinker prefix (agentId identifies which agent instance)
    const prefix = `[thinker:${agentId}]`;
    child.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        this.logger.info(`${prefix} ${line}`);
      }
    });
    child.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        this.logger.error(`${prefix} ${line}`);
      }
    });

    // For dynamic port (port=0), parse actual port from Thinker stdout
    let actualPort = port;
    if (port === 0) {
      const announced = await this.waitForPortAnnouncement(child, agentId, 15_000);
      if (!announced) {
        this.logger.error(`Agent "${agentId}" did not announce its port — killing`);
        child.kill('SIGTERM');
        return;
      }
      actualPort = announced;
      this.logger.info(`Agent "${agentId}" got dynamic port ${actualPort}`);
    }

    // Create or update ThinkerClient for this agent
    const baseUrl = `http://localhost:${actualPort}`;
    const client = new ThinkerClient(baseUrl);

    // Get or create the managed entry
    let managed = this.agents.get(agentId);
    if (managed) {
      // Update existing entry (re-spawn or restart)
      managed.client = client;
      managed.process = child;
      managed.available = false;
      managed.promptFilePath = promptFilePath;
      managed.definition = port === 0 ? { ...definition, port: actualPort } : definition;
    } else {
      // New entry (subagent)
      managed = {
        definition: port === 0 ? { ...definition, port: actualPort } : definition,
        client,
        process: child,
        available: false,
        promptFilePath,
        restartCount: 0,
        lastRestartAt: Date.now(),
        paused: false,
        pauseReason: null,
        state: 'starting',
        lastActivityAt: Date.now(),
        spawnPromise: null,
        parentAgentId: null,
        isSubagent: false,
        autoKillTimer: null,
      };
      this.agents.set(agentId, managed);
    }

    // Handle process exit
    child.on('exit', (code, signal) => {
      this.logger.warn(`Agent "${agentId}" exited (code=${code}, signal=${signal})`);
      managed.available = false;
      managed.process = null;
      if (managed.state === 'running') {
        managed.state = 'stopped';
      }
    });

    // Wait for the agent to become healthy
    const healthy = await this.waitForHealth(client, agentId, 15_000);
    managed.available = healthy;

    if (healthy) {
      managed.state = 'running';
      managed.lastActivityAt = Date.now();
      this.logger.info(`Agent "${agentId}" is ready on port ${actualPort}`);
    } else {
      managed.state = 'stopped';
      this.logger.warn(`Agent "${agentId}" did not become healthy within timeout`);
    }
  }

  /**
   * Gracefully stop a single agent.
   */
  async stopAgent(agentId: string): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed || managed.state === 'stopped') return;

    this.logger.info(`Stopping agent "${agentId}"...`);
    managed.state = 'stopping';

    // Cascade: kill all child subagents first
    const children = this.subagentsByParent.get(agentId);
    if (children) {
      for (const childId of [...children]) {
        await this.killSubagent(childId);
      }
      this.subagentsByParent.delete(agentId);
    }

    // Kill process
    if (managed.process) {
      try {
        managed.process.kill('SIGTERM');
      } catch {
        // Process may already be dead
      }
      managed.process = null;
    }

    // Clean up prompt file
    if (managed.promptFilePath) {
      try {
        await unlink(managed.promptFilePath);
      } catch {
        // Ignore cleanup errors
      }
    }

    managed.available = false;
    managed.state = 'stopped';
    managed.restartCount = 0;
    this.logger.info(`Agent "${agentId}" stopped`);
  }

  /**
   * Wait for LISTENING_PORT=XXXXX on stdout (for dynamic port allocation).
   */
  private waitForPortAnnouncement(
    child: ChildProcess,
    agentId: string,
    timeoutMs: number
  ): Promise<number | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.stdout?.off('data', handler);
        this.logger.warn(`Port announcement timeout for agent "${agentId}" after ${timeoutMs}ms`);
        resolve(null);
      }, timeoutMs);

      const handler = (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          const match = line.match(/LISTENING_PORT=(\d+)/);
          if (match) {
            clearTimeout(timer);
            child.stdout?.off('data', handler);
            resolve(parseInt(match[1], 10));
            return;
          }
        }
      };
      child.stdout?.on('data', handler);
    });
  }

  /**
   * Wait for an agent to become healthy (polls /health endpoint).
   */
  private async waitForHealth(
    client: ThinkerClient,
    agentId: string,
    timeoutMs: number
  ): Promise<boolean> {
    const start = Date.now();
    const interval = 1000;

    while (Date.now() - start < timeoutMs) {
      const healthy = await client.healthCheck();
      if (healthy) return true;
      await new Promise(r => setTimeout(r, interval));
    }

    this.logger.warn(`Health check timeout for agent "${agentId}" after ${timeoutMs}ms`);
    return false;
  }

  /**
   * Build environment variables for a Thinker process.
   */
  private buildAgentEnv(
    definition: AgentDefinition,
    promptFilePath: string | null
  ): Record<string, string> {
    // Start with current process env (inherits GROQ_API_KEY, etc.)
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }

    // Override with agent-specific settings
    env.THINKER_PORT = String(definition.port);
    env.THINKER_AGENT_ID = definition.agentId;
    env.THINKER_LLM_PROVIDER = definition.llmProvider;

    // Set model based on provider
    switch (definition.llmProvider) {
      case 'groq':
        env.GROQ_MODEL = definition.model;
        break;
      case 'ollama':
        env.OLLAMA_MODEL = definition.model;
        break;
      case 'lmstudio':
        env.LMSTUDIO_MODEL = definition.model;
        break;
    }

    // Temperature
    if (definition.temperature !== undefined) {
      env.THINKER_TEMPERATURE = String(definition.temperature);
    }

    // Disable self-polling and direct response — Orchestrator handles these
    env.THINKER_POLLING_ENABLED = 'false';
    env.THINKER_SEND_RESPONSE_DIRECTLY = 'false';

    // System prompt file
    if (promptFilePath) {
      env.THINKER_SYSTEM_PROMPT_PATH = promptFilePath;
    }

    // Ensure Orchestrator URL is set (so agent can discover tools)
    if (!env.ORCHESTRATOR_URL) {
      env.ORCHESTRATOR_URL = `http://localhost:${process.env.PORT || '8010'}`;
    }

    // Cost control settings
    if (definition.costControls?.enabled) {
      env.THINKER_COST_CONTROL_ENABLED = 'true';
      env.THINKER_COST_SHORT_WINDOW_MINUTES = String(definition.costControls.shortWindowMinutes);
      env.THINKER_COST_SPIKE_MULTIPLIER = String(definition.costControls.spikeMultiplier);
      env.THINKER_COST_HARD_CAP_PER_HOUR = String(definition.costControls.hardCapTokensPerHour);
      env.THINKER_COST_MIN_BASELINE_TOKENS = String(definition.costControls.minimumBaselineTokens);
    }

    return env;
  }

  // ─── Subagent Spawning (P7) ───────────────────────────────────

  /**
   * Spawn a temporary subagent. Inherits parent's LLM config with optional overrides.
   * Subagents use dynamic port allocation (port 0).
   * Returns the subagent ID and client for dispatching the task.
   */
  async spawnSubagent(opts: SpawnSubagentOptions): Promise<{ agentId: string; client: ThinkerClient }> {
    const parent = this.agents.get(opts.parentAgentId);
    if (!parent) throw new Error(`Parent agent "${opts.parentAgentId}" not found`);
    if (parent.isSubagent) throw new Error('Subagents cannot spawn subagents (single-level only)');
    if (parent.state !== 'running') throw new Error(`Parent agent "${opts.parentAgentId}" is not running`);

    // Check concurrency limit
    const existing = this.subagentsByParent.get(opts.parentAgentId);
    if (existing && existing.size >= AgentManager.MAX_SUBAGENTS_PER_PARENT) {
      throw new Error(
        `Max ${AgentManager.MAX_SUBAGENTS_PER_PARENT} concurrent subagents per parent (current: ${existing.size})`
      );
    }

    // Build subagent definition (inherits parent's config)
    const subId = `${opts.parentAgentId}-sub-${Date.now()}`;
    const parentDef = parent.definition;
    const subDef: AgentDefinition = {
      ...parentDef,
      agentId: subId,
      port: 0, // dynamic port
      model: opts.model || parentDef.model,
      systemPrompt: 'You are a focused subagent. Complete the task described in the user message. Use your available tools. Be concise.',
      // Merge tool policies: subagent is a subset of parent
      allowedTools: opts.allowedTools?.length
        ? opts.allowedTools.filter(t => !parentDef.deniedTools.includes(t))
        : parentDef.allowedTools,
      deniedTools: [
        ...new Set([
          ...parentDef.deniedTools,
          ...(opts.deniedTools || []),
          'spawn_subagent', // subagents cannot spawn
        ]),
      ],
      maxSteps: parentDef.maxSteps,
      idleTimeoutMinutes: parentDef.idleTimeoutMinutes,
    };

    this.logger.info(`Spawning subagent "${subId}" for parent "${opts.parentAgentId}"...`);

    // Spawn the process
    await this.spawnAgent(subDef);
    const managed = this.agents.get(subId);
    if (!managed || !managed.available) {
      // Clean up failed spawn
      if (managed) this.agents.delete(subId);
      throw new Error(`Subagent "${subId}" failed to start`);
    }

    managed.parentAgentId = opts.parentAgentId;
    managed.isSubagent = true;
    managed.lastActivityAt = Date.now();

    // Track parent-child relationship
    if (!this.subagentsByParent.has(opts.parentAgentId)) {
      this.subagentsByParent.set(opts.parentAgentId, new Set());
    }
    this.subagentsByParent.get(opts.parentAgentId)!.add(subId);

    // Auto-kill timer
    const timeoutMs = (opts.timeoutMinutes || 5) * 60 * 1000;
    managed.autoKillTimer = setTimeout(async () => {
      this.logger.warn(`Subagent "${subId}" auto-killed after ${opts.timeoutMinutes || 5}m timeout`);
      await this.killSubagent(subId);
    }, timeoutMs);

    this.logger.info(
      `Subagent "${subId}" ready on port ${managed.definition.port} (timeout: ${opts.timeoutMinutes || 5}m)`
    );

    return { agentId: subId, client: managed.client };
  }

  /**
   * Kill a subagent — stop process, clean up tracking, remove from agents map.
   */
  async killSubagent(agentId: string): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) return;

    this.logger.info(`Killing subagent "${agentId}"...`);

    // Clear auto-kill timer
    if (managed.autoKillTimer) {
      clearTimeout(managed.autoKillTimer);
      managed.autoKillTimer = null;
    }

    // Remove from parent tracking
    if (managed.parentAgentId) {
      this.subagentsByParent.get(managed.parentAgentId)?.delete(agentId);
    }

    await this.stopAgent(agentId);
    this.agents.delete(agentId); // fully remove (unlike persistent agents which stay registered)
  }

  /**
   * Get the number of active subagents for a parent agent.
   */
  getSubagentCount(parentAgentId: string): number {
    return this.subagentsByParent.get(parentAgentId)?.size ?? 0;
  }

  // ─── Health Monitoring ────────────────────────────────────────

  /**
   * Start periodic health monitoring with auto-restart.
   */
  private startHealthMonitoring(): void {
    if (this.healthCheckTimer) return;

    this.logger.info(`Starting agent health monitoring (every ${AgentManager.HEALTH_CHECK_INTERVAL_MS / 1000}s)`);

    this.healthCheckTimer = setInterval(async () => {
      await this.runHealthChecks();
    }, AgentManager.HEALTH_CHECK_INTERVAL_MS);

    if (this.healthCheckTimer.unref) {
      this.healthCheckTimer.unref();
    }
  }

  /**
   * Stop health monitoring.
   */
  stopHealthMonitoring(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Run health checks on running agents, auto-restart crashed ones.
   */
  private async runHealthChecks(): Promise<void> {
    for (const [agentId, managed] of this.agents) {
      // Only check running agents
      if (managed.state !== 'running') continue;
      if (!managed.definition.enabled) continue;

      const healthy = await managed.client.healthCheck();

      if (healthy && !managed.available) {
        managed.available = true;
        this.logger.info(`Agent "${agentId}" recovered`);
      } else if (!healthy && managed.available) {
        managed.available = false;
        this.logger.warn(`Agent "${agentId}" health check failed`);
        // Don't auto-restart subagents — they have auto-kill timers
        if (!managed.isSubagent) {
          await this.tryRestart(agentId, managed);
        }
      } else if (!healthy && !managed.available) {
        if (!managed.isSubagent) {
          await this.tryRestart(agentId, managed);
        }
      }
    }
  }

  /**
   * Attempt to restart a failed agent with exponential backoff and max attempts.
   */
  private async tryRestart(agentId: string, managed: ManagedAgent): Promise<void> {
    // Exponential backoff: 10s, 20s, 40s, 80s, 160s
    const cooldown = AgentManager.RESTART_COOLDOWN_MS * Math.pow(2, managed.restartCount);
    if (Date.now() - managed.lastRestartAt < cooldown) {
      return;
    }

    if (managed.restartCount >= AgentManager.MAX_RESTART_ATTEMPTS) {
      this.logger.error(`Agent "${agentId}" exceeded max restart attempts (${AgentManager.MAX_RESTART_ATTEMPTS})`);
      return;
    }

    this.logger.info(`Restarting agent "${agentId}" (attempt ${managed.restartCount + 1}, next cooldown ${cooldown * 2 / 1000}s)...`);

    if (managed.process) {
      try {
        managed.process.kill('SIGTERM');
      } catch {
        // Process may already be dead
      }
      managed.process = null;
    }

    managed.restartCount++;
    managed.lastRestartAt = Date.now();

    try {
      await this.spawnAgent(managed.definition);
      const refreshed = this.agents.get(agentId);
      if (refreshed?.available) {
        this.logger.info(`Agent "${agentId}" restarted successfully`);
        refreshed.restartCount = managed.restartCount;
      }
    } catch (error) {
      this.logger.error(`Failed to restart agent "${agentId}"`, { error });
    }
  }

  // ─── Idle Scanner ─────────────────────────────────────────────

  /**
   * Start periodic idle checks to kill inactive agents.
   */
  private startIdleScanner(): void {
    if (this.idleScanTimer) return;

    this.logger.info(`Starting idle scanner (every ${AgentManager.IDLE_SCAN_INTERVAL_MS / 60000}m)`);

    this.idleScanTimer = setInterval(async () => {
      await this.runIdleChecks();
    }, AgentManager.IDLE_SCAN_INTERVAL_MS);

    if (this.idleScanTimer.unref) {
      this.idleScanTimer.unref();
    }
  }

  /**
   * Stop the idle scanner.
   */
  private stopIdleScanner(): void {
    if (this.idleScanTimer) {
      clearInterval(this.idleScanTimer);
      this.idleScanTimer = null;
    }
  }

  /**
   * Check all running agents for idle timeout and stop inactive ones.
   */
  private async runIdleChecks(): Promise<void> {
    const now = Date.now();
    for (const [agentId, managed] of this.agents) {
      if (managed.state !== 'running') continue;
      if (managed.isSubagent) continue; // subagents have auto-kill timers

      const timeoutMs = managed.definition.idleTimeoutMinutes * 60 * 1000;
      if (managed.lastActivityAt > 0 && now - managed.lastActivityAt > timeoutMs) {
        const idleMinutes = Math.floor((now - managed.lastActivityAt) / 60000);
        this.logger.info(`Idle-killing agent "${agentId}" (no activity for ${idleMinutes}m)`);
        await this.stopAgent(agentId);
      }
    }
  }

  // ─── Cost Control Pause / Resume ──────────────────────────────

  /**
   * Mark an agent as paused (called when Thinker reports cost-control pause).
   */
  markPaused(agentId: string, reason: string): void {
    const managed = this.agents.get(agentId);
    if (managed) {
      managed.paused = true;
      managed.pauseReason = reason;
      this.logger.warn(`Agent "${agentId}" marked as paused: ${reason}`);
    }
  }

  /**
   * Check if an agent is paused by cost controls.
   */
  isAgentPaused(agentId: string): boolean {
    return this.agents.get(agentId)?.paused ?? false;
  }

  /**
   * Resume a paused agent by calling its /cost-resume endpoint.
   */
  async resumeAgent(agentId: string, resetWindow = false): Promise<{ success: boolean; message: string }> {
    const managed = this.agents.get(agentId);
    if (!managed) {
      return { success: false, message: `Agent "${agentId}" not found` };
    }
    if (!managed.paused) {
      return { success: false, message: `Agent "${agentId}" is not paused` };
    }

    const resumed = await managed.client.resumeCostPause(resetWindow);
    if (resumed) {
      managed.paused = false;
      managed.pauseReason = null;
      this.logger.info(`Agent "${agentId}" resumed from cost pause`);
      return { success: true, message: `Agent "${agentId}" resumed` };
    }

    this.logger.error(`Failed to resume agent "${agentId}" — Thinker did not acknowledge`);
    return { success: false, message: `Failed to resume agent "${agentId}"` };
  }

  // ─── Accessors ────────────────────────────────────────────────

  /**
   * Get a ThinkerClient for a specific agent.
   */
  getClient(agentId: string): ThinkerClient | null {
    return this.agents.get(agentId)?.client ?? null;
  }

  /**
   * Get the default (first registered) agent's client.
   * Prefers running agents, falls back to first registered.
   */
  getDefaultClient(): ThinkerClient | null {
    for (const managed of this.agents.values()) {
      if (managed.available) {
        return managed.client;
      }
    }
    // Fall back to first registered (will be lazy-spawned on use)
    const first = this.agents.values().next().value;
    return first?.client ?? null;
  }

  /**
   * Get the default agent's ID.
   * Prefers running agents, falls back to first registered.
   */
  getDefaultAgentId(): string | null {
    for (const [agentId, managed] of this.agents) {
      if (managed.available) {
        return agentId;
      }
    }
    // Fall back to first registered (will be lazy-spawned on use)
    const first = this.agents.keys().next().value;
    return first ?? null;
  }

  /**
   * Check if an agent is registered (regardless of state).
   */
  hasAgent(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /**
   * Get the agent definition (for registering with Orchestrator's tool policy map).
   */
  getAgentDefinition(agentId: string): AgentDefinition | null {
    return this.agents.get(agentId)?.definition ?? null;
  }

  /**
   * Get the state of a specific agent.
   */
  getAgentState(agentId: string): AgentState | null {
    return this.agents.get(agentId)?.state ?? null;
  }

  /**
   * Get status of all managed agents.
   */
  getStatus(): AgentStatus[] {
    return Array.from(this.agents.entries()).map(([agentId, managed]) => ({
      agentId,
      available: managed.available,
      port: managed.definition.port,
      restartCount: managed.restartCount,
      pid: managed.process?.pid ?? null,
      paused: managed.paused,
      pauseReason: managed.pauseReason,
      state: managed.state,
      lastActivityAt: managed.lastActivityAt,
      parentAgentId: managed.parentAgentId,
      isSubagent: managed.isSubagent,
    }));
  }

  /**
   * Get count of available (running) agents.
   */
  getAvailableCount(): number {
    let count = 0;
    for (const managed of this.agents.values()) {
      if (managed.available) count++;
    }
    return count;
  }

  // ─── Shutdown ─────────────────────────────────────────────────

  /**
   * Gracefully shut down all agents and clean up timers.
   */
  async shutdownAll(): Promise<void> {
    this.stopHealthMonitoring();
    this.stopIdleScanner();

    // Stop all agents (stopAgent handles cascade kill of subagents)
    const agentIds = [...this.agents.keys()];
    for (const agentId of agentIds) {
      await this.stopAgent(agentId);
    }

    this.agents.clear();
    this.subagentsByParent.clear();
    this.logger.info('All agents shut down');
  }
}
