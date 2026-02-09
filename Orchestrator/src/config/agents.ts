/**
 * Agent definitions - configuration for each Thinker agent instance
 * that the Orchestrator spawns and manages.
 */

import { z } from 'zod';

/**
 * LLM provider options for agents
 */
export const AgentLLMProviderSchema = z.enum(['groq', 'lmstudio', 'ollama']);

/**
 * Cost controls for an agent — anomaly-based rate limiting that detects
 * abnormal token consumption spikes and pauses the agent.
 */
export const CostControlsSchema = z.object({
  /** Enable cost controls for this agent */
  enabled: z.boolean().default(false),

  /** Short window size for spike detection (minutes) */
  shortWindowMinutes: z.number().int().min(1).max(30).default(2),

  /** Spike threshold: short-window rate must exceed baseline × this multiplier */
  spikeMultiplier: z.number().min(1.5).max(10).default(3.0),

  /** Absolute safety cap: max tokens in any 60-minute window */
  hardCapTokensPerHour: z.number().int().min(10000).default(500_000),

  /** Minimum baseline tokens before spike detection activates (prevents cold-start false positives) */
  minimumBaselineTokens: z.number().int().min(100).default(1000),

  /** Channel to send cost alert notifications to (falls back to originating channel) */
  notifyChannel: z.string().optional(),

  /** Chat ID to send cost alert notifications to (falls back to message sender) */
  notifyChatId: z.string().optional(),
});

export type CostControls = z.infer<typeof CostControlsSchema>;

/**
 * Schema for a single agent definition
 */
export const AgentDefinitionSchema = z.object({
  /** Unique identifier for this agent (e.g., 'annabelle', 'work-assistant') */
  agentId: z.string().min(1),

  /** Whether this agent is active */
  enabled: z.boolean().default(true),

  /** HTTP port for this agent's Thinker instance (0 = OS-assigned, used by subagents) */
  port: z.number().int().min(0).max(65535),

  /** LLM provider to use */
  llmProvider: AgentLLMProviderSchema.default('groq'),

  /** Model name (provider-specific) */
  model: z.string().min(1),

  /** System prompt for this agent (empty = Thinker uses its built-in default) */
  systemPrompt: z.string(),

  /** Glob patterns for allowed tools (e.g., ['gmail_*', 'memory_*']). Empty = all tools allowed */
  allowedTools: z.array(z.string()).default([]),

  /** Glob patterns for denied tools (evaluated after allowedTools) */
  deniedTools: z.array(z.string()).default([]),

  /** LLM temperature (0-2). Lower = more deterministic, better tool calling. */
  temperature: z.number().min(0).max(2).optional(),

  /** Maximum ReAct steps per message */
  maxSteps: z.number().int().min(1).max(50).default(8),

  /** Minutes of inactivity before the agent is idle-killed (lazy-spawn restarts on next message) */
  idleTimeoutMinutes: z.number().int().min(1).default(30),

  /** LLM cost controls — anomaly-based spike detection with pause/resume */
  costControls: CostControlsSchema.optional(),
});

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

/**
 * Schema for the full agents config file
 */
export const AgentsConfigSchema = z.object({
  agents: z.array(AgentDefinitionSchema).min(1),
});

export type AgentsConfig = z.infer<typeof AgentsConfigSchema>;

/**
 * Channel binding — maps a (channel, chatId) pair to an agent.
 * Wildcard "*" for chatId matches any chat on that channel.
 * Order matters: first match wins. Put specific chatId bindings before wildcards.
 */
export const ChannelBindingSchema = z.object({
  channel: z.string().min(1),
  chatId: z.string().min(1),
  agentId: z.string().min(1),
});

export type ChannelBinding = z.infer<typeof ChannelBindingSchema>;

/**
 * Extended agents config: agents + optional channel bindings.
 */
export const FullAgentsConfigSchema = z.object({
  agents: z.array(AgentDefinitionSchema).min(1),
  bindings: z.array(ChannelBindingSchema).optional(),
});

export type FullAgentsConfig = z.infer<typeof FullAgentsConfigSchema>;

/**
 * Default agent definition — backward compatible with current single-agent setup
 */
export function getDefaultAgent(): AgentDefinition {
  return {
    agentId: 'annabelle',
    enabled: true,
    port: 8006,
    llmProvider: 'groq',
    model: 'qwen/qwen3-32b',
    systemPrompt: '', // Empty means Thinker uses its built-in DEFAULT_SYSTEM_PROMPT
    allowedTools: [],
    deniedTools: [],
    maxSteps: 8,
    idleTimeoutMinutes: 30,
  };
}

/**
 * Load agents config from a JSON file path.
 * Supports both simple { agents: [...] } and full { agents: [...], bindings: [...] } formats.
 * Returns null if the file cannot be read.
 */
export async function loadAgentsFromFile(filePath: string): Promise<FullAgentsConfig | null> {
  try {
    const { readFile } = await import('fs/promises');
    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    const result = FullAgentsConfigSchema.safeParse(parsed);

    if (!result.success) {
      const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      throw new Error(`Agent config validation failed: ${errors}`);
    }

    return result.data;
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
