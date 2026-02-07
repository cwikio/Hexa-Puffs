/**
 * AgentManager - Spawns and manages multiple Thinker agent instances.
 *
 * Each agent is a separate Node.js process running Thinker, configured
 * with its own port, LLM provider, model, and system prompt.
 * The manager handles lifecycle (spawn, health check, auto-restart).
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

interface ManagedAgent {
  definition: AgentDefinition;
  client: ThinkerClient;
  process: ChildProcess | null;
  available: boolean;
  promptFilePath: string | null;
  restartCount: number;
  lastRestartAt: number;
}

export interface AgentStatus {
  agentId: string;
  available: boolean;
  port: number;
  restartCount: number;
  pid: number | null;
}

export class AgentManager {
  private agents: Map<string, ManagedAgent> = new Map();
  private logger: Logger;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly HEALTH_CHECK_INTERVAL_MS = 30_000;
  private static readonly MAX_RESTART_ATTEMPTS = 5;
  private static readonly RESTART_COOLDOWN_MS = 10_000;
  private static readonly PROMPTS_DIR = resolve(MCPS_ROOT, '.annabelle/agent-prompts');

  constructor() {
    this.logger = logger.child('agent-manager');
  }

  /**
   * Initialize and spawn all enabled agents.
   */
  async initializeAll(definitions: AgentDefinition[]): Promise<void> {
    const enabled = definitions.filter(d => d.enabled);
    this.logger.info(`Initializing ${enabled.length} agent(s)...`);

    // Ensure prompts directory exists
    await mkdir(AgentManager.PROMPTS_DIR, { recursive: true });

    // Spawn all agents in parallel
    await Promise.all(enabled.map(def => this.spawnAgent(def)));

    // Start health monitoring
    this.startHealthMonitoring();

    this.logger.info(`Agent initialization complete: ${this.getAvailableCount()}/${enabled.length} available`);
  }

  /**
   * Spawn a single Thinker agent process.
   */
  private async spawnAgent(definition: AgentDefinition): Promise<void> {
    const { agentId, port } = definition;
    this.logger.info(`Spawning agent "${agentId}" on port ${port}...`);

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

    // Pipe stdout/stderr with agent prefix
    const prefix = `[agent:${agentId}]`;
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

    // Create ThinkerClient for this agent
    const baseUrl = `http://localhost:${port}`;
    const client = new ThinkerClient(baseUrl);

    const managed: ManagedAgent = {
      definition,
      client,
      process: child,
      available: false,
      promptFilePath,
      restartCount: 0,
      lastRestartAt: Date.now(),
    };

    this.agents.set(agentId, managed);

    // Handle process exit
    child.on('exit', (code, signal) => {
      this.logger.warn(`Agent "${agentId}" exited (code=${code}, signal=${signal})`);
      managed.available = false;
      managed.process = null;
    });

    // Wait for the agent to become healthy
    const healthy = await this.waitForHealth(client, agentId, 15_000);
    managed.available = healthy;

    if (healthy) {
      this.logger.info(`Agent "${agentId}" is ready on port ${port}`);
    } else {
      this.logger.warn(`Agent "${agentId}" did not become healthy within timeout`);
    }
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

    // Disable self-polling and direct response — Orchestrator handles these
    env.THINKER_POLLING_ENABLED = 'false';
    env.THINKER_SEND_RESPONSE_DIRECTLY = 'false';

    // System prompt file
    if (promptFilePath) {
      env.THINKER_SYSTEM_PROMPT_PATH = promptFilePath;
    }

    // Ensure Orchestrator URL is set (so agent can discover tools)
    if (!env.ORCHESTRATOR_URL) {
      env.ORCHESTRATOR_URL = 'http://localhost:8000';
    }

    return env;
  }

  /**
   * Get a ThinkerClient for a specific agent.
   */
  getClient(agentId: string): ThinkerClient | null {
    return this.agents.get(agentId)?.client ?? null;
  }

  /**
   * Get the default (first enabled) agent's client.
   */
  getDefaultClient(): ThinkerClient | null {
    for (const managed of this.agents.values()) {
      if (managed.available) {
        return managed.client;
      }
    }
    return null;
  }

  /**
   * Get the default agent's ID.
   */
  getDefaultAgentId(): string | null {
    for (const [agentId, managed] of this.agents) {
      if (managed.available) {
        return agentId;
      }
    }
    return null;
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
    }));
  }

  /**
   * Get count of available agents.
   */
  getAvailableCount(): number {
    let count = 0;
    for (const managed of this.agents.values()) {
      if (managed.available) count++;
    }
    return count;
  }

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
   * Run health checks on all agents, auto-restart crashed ones.
   */
  private async runHealthChecks(): Promise<void> {
    for (const [agentId, managed] of this.agents) {
      if (!managed.definition.enabled) continue;

      const healthy = await managed.client.healthCheck();

      if (healthy && !managed.available) {
        // Recovered
        managed.available = true;
        this.logger.info(`Agent "${agentId}" recovered`);
      } else if (!healthy && managed.available) {
        // Was healthy, now failing
        managed.available = false;
        this.logger.warn(`Agent "${agentId}" health check failed`);
        await this.tryRestart(agentId, managed);
      } else if (!healthy && !managed.available) {
        // Still down — try restart if cooldown has passed
        await this.tryRestart(agentId, managed);
      }
    }
  }

  /**
   * Attempt to restart a failed agent with cooldown and max attempts.
   */
  private async tryRestart(agentId: string, managed: ManagedAgent): Promise<void> {
    // Respect cooldown
    if (Date.now() - managed.lastRestartAt < AgentManager.RESTART_COOLDOWN_MS) {
      return;
    }

    // Respect max attempts
    if (managed.restartCount >= AgentManager.MAX_RESTART_ATTEMPTS) {
      this.logger.error(`Agent "${agentId}" exceeded max restart attempts (${AgentManager.MAX_RESTART_ATTEMPTS})`);
      return;
    }

    this.logger.info(`Restarting agent "${agentId}" (attempt ${managed.restartCount + 1})...`);

    // Kill existing process if still alive
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

    // Re-spawn
    try {
      await this.spawnAgent(managed.definition);
      // spawnAgent updates the agents map, so refresh our reference
      const refreshed = this.agents.get(agentId);
      if (refreshed?.available) {
        this.logger.info(`Agent "${agentId}" restarted successfully`);
        // Reset restart count on successful recovery
        refreshed.restartCount = managed.restartCount;
      }
    } catch (error) {
      this.logger.error(`Failed to restart agent "${agentId}"`, { error });
    }
  }

  /**
   * Gracefully shut down all agents.
   */
  async shutdownAll(): Promise<void> {
    this.stopHealthMonitoring();

    for (const [agentId, managed] of this.agents) {
      this.logger.info(`Shutting down agent "${agentId}"...`);

      if (managed.process) {
        managed.process.kill('SIGTERM');
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
    }

    this.agents.clear();
    this.logger.info('All agents shut down');
  }
}
