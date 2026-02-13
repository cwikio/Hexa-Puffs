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
 * Post-conversation fact extraction configuration schema
 */
export const FactExtractionConfigSchema = z.object({
  enabled: z.boolean().default(true),
  idleMs: z.number().int().min(30_000).default(5 * 60 * 1000), // 5 min idle before extraction
  maxTurns: z.number().int().min(2).default(10), // max recent turns to analyze
  confidenceThreshold: z.number().min(0).max(1).default(0.7),
});

/**
 * Session persistence configuration schema
 */
export const SessionConfigSchema = z.object({
  enabled: z.boolean().default(true),
  compactionEnabled: z.boolean().default(true),
  compactionThresholdChars: z.number().int().min(5000).default(20_000), // ~5,000 tokens — compact sooner
  compactionKeepRecentTurns: z.number().int().min(2).default(5),
  compactionCooldownMs: z.number().int().min(0).default(2 * 60 * 1000), // 2 min
  compactionMinTurns: z.number().int().min(3).default(8),
  maxAgeDays: z.number().int().min(1).default(7),
});

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

  // LLM temperature (0-2). Lower = more deterministic, better tool calling.
  // 0.4 balances creativity with reliable tool calling for llama-3.3-70b
  temperature: z.number().min(0).max(2).default(0.4),

  // Orchestrator connection
  orchestratorUrl: z.string().url().default('http://localhost:8000'),
  orchestratorTimeout: z.number().int().min(1000).default(30_000),

  // Thinker HTTP server
  thinkerPort: z.number().int().min(0).max(65535).default(8006), // 0 = OS-assigned (subagents)

  // Response delivery: when false, processMessage returns result without sending to Telegram
  // (Orchestrator handles delivery in channel-polling mode)
  sendResponseDirectly: z.boolean().default(false),

  // Agent settings
  thinkerAgentId: z.string().default('thinker'),

  // Path to a file containing the system prompt (overrides built-in DEFAULT_SYSTEM_PROMPT)
  // Set by Orchestrator's AgentManager when spawning agents with custom prompts
  systemPromptPath: z.string().optional(),

  // Path to the default system prompt file (fallback when no systemPromptPath or persona is configured)
  // Defaults to the bundled prompts/default-system-prompt.md alongside the package
  defaultSystemPromptPath: z.string().optional(),

  // Directory containing per-agent persona files (~/.annabelle/agents/{agentId}/instructions.md)
  personaDir: z.string().default('~/.annabelle/agents'),

  // Directory containing file-based skills (~/.annabelle/skills/{skill-name}/SKILL.md)
  skillsDir: z.string().default('~/.annabelle/skills'),

  // Proactive tasks
  proactiveTasksEnabled: z.boolean().default(true),
  defaultNotifyChatId: z.string().optional(),

  // User context
  userTimezone: z.string().default('America/New_York'),
  userName: z.string().optional(),
  userEmail: z.string().optional(),

  // Logging
  logLevel: LogLevelSchema.default('info'),
  traceLogPath: z.string().default('~/.annabelle/logs/traces.jsonl'),

  // Session persistence
  sessionsDir: z.string().default('~/.annabelle/sessions'),
  sessionConfig: SessionConfigSchema.default({}),

  // Compaction model — dedicated cheap model for session summarization
  compactionProvider: LLMProviderSchema.default('groq'),
  compactionModel: z.string().default('llama-3.1-8b-instant'),

  // Post-conversation fact extraction
  factExtraction: FactExtractionConfigSchema.default({}),

  // Path to fact extraction prompt template file (optional, uses bundled default if not set)
  factExtractionPromptPath: z.string().optional(),

  // Embedding cache directory (for persisting tool embeddings across restarts)
  embeddingCacheDir: z.string().default('~/.annabelle/data'),

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
    temperature: parseNumber(process.env.THINKER_TEMPERATURE, 0.4),
    orchestratorUrl: process.env.ORCHESTRATOR_URL || 'http://localhost:8000',
    orchestratorTimeout: parseInteger(process.env.ORCHESTRATOR_TIMEOUT, 30000),
    thinkerPort: parseInteger(process.env.THINKER_PORT, 8006),
    sendResponseDirectly: parseBoolean(process.env.THINKER_SEND_RESPONSE_DIRECTLY, false),
    thinkerAgentId: process.env.THINKER_AGENT_ID || 'thinker',
    systemPromptPath: process.env.THINKER_SYSTEM_PROMPT_PATH || undefined,
    defaultSystemPromptPath: process.env.THINKER_DEFAULT_SYSTEM_PROMPT_PATH || undefined,
    personaDir: process.env.THINKER_PERSONA_DIR || '~/.annabelle/agents',
    skillsDir: process.env.THINKER_SKILLS_DIR || '~/.annabelle/skills',
    proactiveTasksEnabled: parseBoolean(process.env.PROACTIVE_TASKS_ENABLED, true),
    defaultNotifyChatId: process.env.DEFAULT_NOTIFY_CHAT_ID || undefined,
    userTimezone: process.env.USER_TIMEZONE || 'America/New_York',
    userName: process.env.USER_NAME || undefined,
    userEmail: process.env.USER_EMAIL || undefined,
    logLevel: process.env.LOG_LEVEL || 'info',
    traceLogPath: process.env.TRACE_LOG_PATH || '~/.annabelle/logs/traces.jsonl',

    // Session persistence
    sessionsDir: process.env.THINKER_SESSIONS_DIR || '~/.annabelle/sessions',
    sessionConfig: {
      enabled: parseBoolean(process.env.THINKER_SESSION_ENABLED, true),
      compactionEnabled: parseBoolean(process.env.THINKER_SESSION_COMPACTION_ENABLED, true),
      compactionThresholdChars: parseInteger(process.env.THINKER_SESSION_COMPACTION_THRESHOLD_CHARS, 20_000),
      compactionKeepRecentTurns: parseInteger(process.env.THINKER_SESSION_COMPACTION_KEEP_RECENT, 5),
      compactionCooldownMs: parseInteger(process.env.THINKER_SESSION_COMPACTION_COOLDOWN_MS, 2 * 60 * 1000),
      compactionMinTurns: parseInteger(process.env.THINKER_SESSION_COMPACTION_MIN_TURNS, 8),
      maxAgeDays: parseInteger(process.env.THINKER_SESSION_MAX_AGE_DAYS, 7),
    },

    // Compaction model — dedicated cheap model for session summarization
    compactionProvider: process.env.THINKER_COMPACTION_PROVIDER || 'groq',
    compactionModel: process.env.THINKER_COMPACTION_MODEL || 'llama-3.1-8b-instant',

    // Post-conversation fact extraction
    factExtraction: {
      enabled: parseBoolean(process.env.THINKER_FACT_EXTRACTION_ENABLED, true),
      idleMs: parseInteger(process.env.THINKER_FACT_EXTRACTION_IDLE_MS, 5 * 60 * 1000),
      maxTurns: parseInteger(process.env.THINKER_FACT_EXTRACTION_MAX_TURNS, 10),
      confidenceThreshold: parseNumber(process.env.THINKER_FACT_EXTRACTION_CONFIDENCE, 0.7),
    },

    // Fact extraction prompt template
    factExtractionPromptPath: process.env.THINKER_FACT_EXTRACTION_PROMPT_PATH || undefined,

    // Embedding cache directory
    embeddingCacheDir: process.env.EMBEDDING_CACHE_DIR || '~/.annabelle/data',

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
