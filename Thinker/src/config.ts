import { z } from 'zod';
import type { CostControlConfig } from './cost/types.js';

/**
 * LLM Provider types supported by Thinker
 */
export const LLMProviderSchema = z.enum(['groq', 'lmstudio', 'ollama']);
export type LLMProvider = z.infer<typeof LLMProviderSchema>;

/**
 * Cost control configuration schema (parsed from env vars set by Orchestrator)
 */
export const CostControlSchema = z.object({
  enabled: z.boolean(),
  shortWindowMinutes: z.number().int().min(1).max(30).default(2),
  spikeMultiplier: z.number().min(1.5).max(10).default(3.0),
  hardCapTokensPerHour: z.number().int().min(10000).default(500_000),
  minimumBaselineTokens: z.number().int().min(100).default(1000),
});

/**
 * Log level options
 */
export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

/**
 * Configuration schema with Zod validation
 */
export const ConfigSchema = z.object({
  // Master switch
  thinkerEnabled: z.boolean().default(true),

  // LLM Provider settings
  llmProvider: LLMProviderSchema.default('groq'),

  // Groq settings
  groqApiKey: z.string().optional(),
  groqModel: z.string().default('llama-3.3-70b-versatile'),

  // LM Studio settings
  lmstudioBaseUrl: z.string().url().default('http://localhost:1234/v1'),
  lmstudioModel: z.string().optional(),

  // Ollama settings
  ollamaBaseUrl: z.string().url().default('http://localhost:11434'),
  ollamaModel: z.string().default('llama3.2'),

  // Orchestrator connection
  orchestratorUrl: z.string().url().default('http://localhost:8000'),
  orchestratorTimeout: z.number().int().min(1000).default(30_000),

  // Thinker HTTP server
  thinkerPort: z.number().int().min(1).max(65535).default(8006),

  // Response delivery: when false, processMessage returns result without sending to Telegram
  // (Orchestrator handles delivery in channel-polling mode)
  sendResponseDirectly: z.boolean().default(false),

  // Agent settings
  thinkerAgentId: z.string().default('thinker'),

  // Path to a file containing the system prompt (overrides built-in DEFAULT_SYSTEM_PROMPT)
  // Set by Orchestrator's AgentManager when spawning agents with custom prompts
  systemPromptPath: z.string().optional(),

  // Proactive tasks
  proactiveTasksEnabled: z.boolean().default(true),
  defaultNotifyChatId: z.string().optional(),

  // User context
  userTimezone: z.string().default('Europe/Warsaw'),

  // Logging
  logLevel: LogLevelSchema.default('info'),
  traceLogPath: z.string().default('~/.annabelle/logs/traces.jsonl'),

  // Cost controls (optional, configured via Orchestrator env vars)
  costControl: CostControlSchema.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Parse boolean from environment variable
 */
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Parse integer from environment variable
 */
function parseInteger(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse float from environment variable
 */
function parseNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): Config {
  const rawConfig = {
    thinkerEnabled: parseBoolean(process.env.THINKER_ENABLED, true),
    llmProvider: process.env.THINKER_LLM_PROVIDER || 'groq',
    groqApiKey: process.env.GROQ_API_KEY,
    groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    lmstudioBaseUrl: process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1',
    lmstudioModel: process.env.LMSTUDIO_MODEL || undefined,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'llama3.2',
    orchestratorUrl: process.env.ORCHESTRATOR_URL || 'http://localhost:8000',
    orchestratorTimeout: parseInteger(process.env.ORCHESTRATOR_TIMEOUT, 30000),
    thinkerPort: parseInteger(process.env.THINKER_PORT, 8006),
    sendResponseDirectly: parseBoolean(process.env.THINKER_SEND_RESPONSE_DIRECTLY, false),
    thinkerAgentId: process.env.THINKER_AGENT_ID || 'thinker',
    systemPromptPath: process.env.THINKER_SYSTEM_PROMPT_PATH || undefined,
    proactiveTasksEnabled: parseBoolean(process.env.PROACTIVE_TASKS_ENABLED, true),
    defaultNotifyChatId: process.env.DEFAULT_NOTIFY_CHAT_ID || undefined,
    userTimezone: process.env.USER_TIMEZONE || 'Europe/Warsaw',
    logLevel: process.env.LOG_LEVEL || 'info',
    traceLogPath: process.env.TRACE_LOG_PATH || '~/.annabelle/logs/traces.jsonl',

    // Cost controls — only built when explicitly enabled via env var
    ...(parseBoolean(process.env.THINKER_COST_CONTROL_ENABLED, false) ? {
      costControl: {
        enabled: true,
        shortWindowMinutes: parseInteger(process.env.THINKER_COST_SHORT_WINDOW_MINUTES, 2),
        spikeMultiplier: parseNumber(process.env.THINKER_COST_SPIKE_MULTIPLIER, 3.0),
        hardCapTokensPerHour: parseInteger(process.env.THINKER_COST_HARD_CAP_PER_HOUR, 500_000),
        minimumBaselineTokens: parseInteger(process.env.THINKER_COST_MIN_BASELINE_TOKENS, 1000),
      },
    } : {}),
  };

  const result = ConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('\n');
    throw new Error(`Configuration validation failed:\n${errors}`);
  }

  return result.data;
}

/**
 * Validate that required config for selected provider is present
 */
export function validateProviderConfig(config: Config): void {
  if (config.llmProvider === 'groq' && !config.groqApiKey) {
    throw new Error('GROQ_API_KEY is required when using Groq provider');
  }
}
