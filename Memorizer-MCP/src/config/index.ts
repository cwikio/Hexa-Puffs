import { loadEnvSafely } from '@mcp/shared/Utils/env.js';
loadEnvSafely(import.meta.url, 2);

import { ConfigSchema, type Config } from './schema.js';
import { ConfigurationError } from '../utils/errors.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import {
  expandPath,
  getEnvString,
  getEnvFloat,
  getEnvBoolean,
} from '@mcp/shared/Utils/config.js';

// Use getEnvFloat for decimal values (temperature, thresholds)
const getEnvNumber = getEnvFloat;

export function loadConfig(): Config {
  const rawConfig = {
    transport: getEnvString('TRANSPORT', 'stdio'),
    port: getEnvNumber('PORT', 8005),

    database: {
      path: expandPath(getEnvString('MEMORY_DB_PATH', '~/.annabelle/data/memory.db') ?? ''),
    },

    export: {
      path: expandPath(getEnvString('MEMORY_EXPORT_PATH', '~/.annabelle/memory-export/') ?? ''),
    },

    ai: {
      provider: getEnvString('AI_PROVIDER', 'groq'),
      groqApiKey: getEnvString('GROQ_API_KEY'),
      groqModel: getEnvString('GROQ_MODEL', 'llama-3.3-70b-versatile'),
      lmstudioBaseUrl: getEnvString('LMSTUDIO_BASE_URL', 'http://localhost:1234/v1'),
      lmstudioModel: getEnvString('LMSTUDIO_MODEL', 'local-model'),
      temperature: getEnvNumber('AI_TEMPERATURE', 0.3),
      maxTokens: getEnvNumber('AI_MAX_TOKENS', 500),
      synthesisMaxTokens: getEnvNumber('AI_SYNTHESIS_MAX_TOKENS', 1500),
    },

    extraction: {
      enabled: getEnvBoolean('FACT_EXTRACTION_ENABLED', true),
      confidenceThreshold: getEnvNumber('CONFIDENCE_THRESHOLD', 0.7),
      maxFactsPerConversation: getEnvNumber('MAX_FACTS_PER_CONVERSATION', 3),
      skipShortConversations: getEnvNumber('SKIP_SHORT_CONVERSATIONS', 50),
    },

    embedding: {
      provider: getEnvString('EMBEDDING_PROVIDER', 'none'),
      ollamaBaseUrl: getEnvString('OLLAMA_EMBEDDING_BASE_URL', 'http://localhost:11434'),
      ollamaModel: getEnvString('OLLAMA_EMBEDDING_MODEL', 'nomic-embed-text'),
      lmstudioBaseUrl: getEnvString('LMSTUDIO_EMBEDDING_BASE_URL', 'http://localhost:1234/v1'),
      lmstudioModel: getEnvString('LMSTUDIO_EMBEDDING_MODEL', 'text-embedding-nomic-embed-text-v1.5'),
      dimensions: getEnvNumber('EMBEDDING_DIMENSIONS', 768),
      vectorWeight: getEnvNumber('EMBEDDING_VECTOR_WEIGHT', 0.6),
      textWeight: getEnvNumber('EMBEDDING_TEXT_WEIGHT', 0.4),
    },

    logLevel: getEnvString('LOG_LEVEL', 'info'),
  };

  const result = ConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    const errors = result.error.flatten();
    logger.error('Configuration validation failed', errors);
    throw new ConfigurationError('Invalid configuration', errors);
  }

  logger.info('Configuration loaded successfully');
  return result.data;
}

// Singleton config instance
let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

export { type Config, type AIProviderConfig, type ExtractionConfig, type EmbeddingConfig } from './schema.js';
