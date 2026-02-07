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
 * Schema for a single agent definition
 */
export const AgentDefinitionSchema = z.object({
  /** Unique identifier for this agent (e.g., 'annabelle', 'work-assistant') */
  agentId: z.string().min(1),

  /** Whether this agent is active */
  enabled: z.boolean().default(true),

  /** HTTP port for this agent's Thinker instance */
  port: z.number().int().min(1).max(65535),

  /** LLM provider to use */
  llmProvider: AgentLLMProviderSchema.default('groq'),

  /** Model name (provider-specific) */
  model: z.string().min(1),

  /** System prompt for this agent */
  systemPrompt: z.string().min(1),

  /** Glob patterns for allowed tools (e.g., ['gmail_*', 'memory_*']). Empty = all tools allowed */
  allowedTools: z.array(z.string()).default([]),

  /** Glob patterns for denied tools (evaluated after allowedTools) */
  deniedTools: z.array(z.string()).default([]),

  /** Maximum ReAct steps per message */
  maxSteps: z.number().int().min(1).max(50).default(8),
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
    model: 'llama-3.3-70b-versatile',
    systemPrompt: '', // Empty means Thinker uses its built-in DEFAULT_SYSTEM_PROMPT
    allowedTools: [],
    deniedTools: [],
    maxSteps: 8,
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
