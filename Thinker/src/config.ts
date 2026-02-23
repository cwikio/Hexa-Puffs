import { z } from 'zod';
import { getEnvBoolean, getEnvNumber, getEnvFloat, getEnvString } from '@mcp/shared/Utils/config.js';

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
  minimumBaselineRate: z.number().int().min(0).default(10_000),
});

import { PathManager } from '@mcp/shared/Utils/paths.js';
const paths = PathManager.getInstance();

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

  // Directory containing per-agent persona files (~/.hexa-puffs/agents/{agentId}/instructions.md)
  personaDir: z.string().default(paths.getAgentsDir()),

  // Directory containing file-based skills (~/.hexa-puffs/skills/{skill-name}/SKILL.md)
  skillsDir: z.string().default(paths.getSkillsDir()),

  // Proactive tasks
  proactiveTasksEnabled: z.boolean().default(true),
  defaultNotifyChatId: z.string().optional(),

  // User context
  userTimezone: z.string().default('America/New_York'),
  userName: z.string().optional(),
  userEmail: z.string().optional(),

  // Logging
  logLevel: LogLevelSchema.default('info'),
  traceLogPath: z.string().default(paths.resolvePath('~/.hexa-puffs/logs/traces.jsonl')),

  // Session persistence
  sessionsDir: z.string().default(paths.getSessionsDir()),
  sessionConfig: SessionConfigSchema.default({}),

  // Compaction model — dedicated cheap model for session summarization
  compactionProvider: LLMProviderSchema.default('groq'),
  compactionModel: z.string().default('llama-3.1-8b-instant'),

  // Post-conversation fact extraction
  factExtraction: FactExtractionConfigSchema.default({}),

  // Path to fact extraction prompt template file (optional, uses bundled default if not set)
  factExtractionPromptPath: z.string().optional(),

  // Embedding cache directory (for persisting tool embeddings across restarts)
  embeddingCacheDir: z.string().default(paths.getDataDir()),

  // Cost controls (optional, configured via Orchestrator env vars)
  costControl: CostControlSchema.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Load configuration from environment variables
 */
export function loadConfig(): Config {
  const rawConfig = {
    thinkerEnabled: getEnvBoolean('THINKER_ENABLED', true),
    llmProvider: getEnvString('THINKER_LLM_PROVIDER', 'groq'),
    groqApiKey: getEnvString('GROQ_API_KEY'),
    groqModel: getEnvString('GROQ_MODEL', 'llama-3.3-70b-versatile'),
    lmstudioBaseUrl: getEnvString('LMSTUDIO_BASE_URL', 'http://localhost:1234/v1'),
    lmstudioModel: getEnvString('LMSTUDIO_MODEL'),
    ollamaBaseUrl: getEnvString('OLLAMA_BASE_URL', 'http://localhost:11434'),
    ollamaModel: getEnvString('OLLAMA_MODEL', 'llama3.2'),
    temperature: getEnvFloat('THINKER_TEMPERATURE', 0.4),
    orchestratorUrl: getEnvString('ORCHESTRATOR_URL', 'http://localhost:8000'),
    orchestratorTimeout: getEnvNumber('ORCHESTRATOR_TIMEOUT', 30000),
    thinkerPort: getEnvNumber('THINKER_PORT', 8006),
    sendResponseDirectly: getEnvBoolean('THINKER_SEND_RESPONSE_DIRECTLY', false),
    thinkerAgentId: getEnvString('THINKER_AGENT_ID', 'thinker'),
    systemPromptPath: getEnvString('THINKER_SYSTEM_PROMPT_PATH'),
    defaultSystemPromptPath: getEnvString('THINKER_DEFAULT_SYSTEM_PROMPT_PATH'),
    personaDir: getEnvString('THINKER_PERSONA_DIR', paths.getAgentsDir()),
    skillsDir: getEnvString('THINKER_SKILLS_DIR', paths.getSkillsDir()),
    proactiveTasksEnabled: getEnvBoolean('PROACTIVE_TASKS_ENABLED', true),
    defaultNotifyChatId: getEnvString('DEFAULT_NOTIFY_CHAT_ID'),
    userTimezone: getEnvString('USER_TIMEZONE', 'America/New_York'),
    userName: getEnvString('USER_NAME'),
    userEmail: getEnvString('USER_EMAIL'),
    logLevel: getEnvString('LOG_LEVEL', 'info'),
    traceLogPath: getEnvString('TRACE_LOG_PATH', paths.resolvePath('~/.hexa-puffs/logs/traces.jsonl')),

    // Session persistence
    sessionsDir: getEnvString('THINKER_SESSIONS_DIR', paths.getSessionsDir()),
    sessionConfig: {
      enabled: getEnvBoolean('THINKER_SESSION_ENABLED', true),
      compactionEnabled: getEnvBoolean('THINKER_SESSION_COMPACTION_ENABLED', true),
      compactionThresholdChars: getEnvNumber('THINKER_SESSION_COMPACTION_THRESHOLD_CHARS', 20_000),
      compactionKeepRecentTurns: getEnvNumber('THINKER_SESSION_COMPACTION_KEEP_RECENT', 5),
      compactionCooldownMs: getEnvNumber('THINKER_SESSION_COMPACTION_COOLDOWN_MS', 2 * 60 * 1000),
      compactionMinTurns: getEnvNumber('THINKER_SESSION_COMPACTION_MIN_TURNS', 8),
      maxAgeDays: getEnvNumber('THINKER_SESSION_MAX_AGE_DAYS', 7),
    },

    // Compaction model — dedicated cheap model for session summarization
    compactionProvider: getEnvString('THINKER_COMPACTION_PROVIDER', 'groq'),
    compactionModel: getEnvString('THINKER_COMPACTION_MODEL', 'llama-3.1-8b-instant'),

    // Post-conversation fact extraction
    factExtraction: {
      enabled: getEnvBoolean('THINKER_FACT_EXTRACTION_ENABLED', true),
      idleMs: getEnvNumber('THINKER_FACT_EXTRACTION_IDLE_MS', 5 * 60 * 1000),
      maxTurns: getEnvNumber('THINKER_FACT_EXTRACTION_MAX_TURNS', 10),
      confidenceThreshold: getEnvFloat('THINKER_FACT_EXTRACTION_CONFIDENCE', 0.7),
    },

    // Fact extraction prompt template
    factExtractionPromptPath: getEnvString('THINKER_FACT_EXTRACTION_PROMPT_PATH'),

    // Embedding cache directory
    embeddingCacheDir: getEnvString('EMBEDDING_CACHE_DIR', paths.getDataDir()),

    // Cost controls — only built when explicitly enabled via env var
    ...(getEnvBoolean('THINKER_COST_CONTROL_ENABLED', false) ? {
      costControl: {
        enabled: true,
        shortWindowMinutes: getEnvNumber('THINKER_COST_SHORT_WINDOW_MINUTES', 2),
        spikeMultiplier: getEnvFloat('THINKER_COST_SPIKE_MULTIPLIER', 3.0),
        hardCapTokensPerHour: getEnvNumber('THINKER_COST_HARD_CAP_PER_HOUR', 500_000),
        minimumBaselineTokens: getEnvNumber('THINKER_COST_MIN_BASELINE_TOKENS', 1000),
        minimumBaselineRate: getEnvNumber('THINKER_COST_MIN_BASELINE_RATE', 10_000),
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
