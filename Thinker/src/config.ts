import { z } from 'zod';

/**
 * LLM Provider types supported by Thinker
 */
export const LLMProviderSchema = z.enum(['groq', 'lmstudio', 'ollama']);
export type LLMProvider = z.infer<typeof LLMProviderSchema>;

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

  // Direct Telegram MCP connection (bypasses Orchestrator for messaging)
  telegramDirectUrl: z.string().url().optional(),
  telegramDirectEnabled: z.boolean().default(true),

  // Thinker HTTP server
  thinkerPort: z.number().int().min(1).max(65535).default(8006),

  // Polling settings
  telegramPollIntervalMs: z.number().int().min(1000).default(10000),

  // Agent settings
  thinkerAgentId: z.string().default('thinker'),

  // Proactive tasks
  proactiveTasksEnabled: z.boolean().default(true),
  defaultNotifyChatId: z.string().optional(),

  // User context
  userTimezone: z.string().default('Europe/Warsaw'),

  // Logging
  logLevel: LogLevelSchema.default('info'),
  traceLogPath: z.string().default('~/.annabelle/logs/traces.jsonl'),
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
    telegramDirectUrl: process.env.TELEGRAM_DIRECT_URL || undefined,
    telegramDirectEnabled: parseBoolean(process.env.TELEGRAM_DIRECT_ENABLED, true),
    thinkerPort: parseInteger(process.env.THINKER_PORT, 8006),
    telegramPollIntervalMs: parseInteger(process.env.TELEGRAM_POLL_INTERVAL_MS, 10000),
    thinkerAgentId: process.env.THINKER_AGENT_ID || 'thinker',
    proactiveTasksEnabled: parseBoolean(process.env.PROACTIVE_TASKS_ENABLED, true),
    defaultNotifyChatId: process.env.DEFAULT_NOTIFY_CHAT_ID || undefined,
    userTimezone: process.env.USER_TIMEZONE || 'Europe/Warsaw',
    logLevel: process.env.LOG_LEVEL || 'info',
    traceLogPath: process.env.TRACE_LOG_PATH || '~/.annabelle/logs/traces.jsonl',
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
