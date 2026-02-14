import { createOpenAI } from '@ai-sdk/openai';
import { createGroq } from '@ai-sdk/groq';
import type { LanguageModel } from 'ai';
import type { Config } from '../config.js';
import type { ProviderName } from './types.js';
import { Logger } from '@mcp/shared/Utils/logger.js';

const logger = new Logger('thinker:groq-debug');

/**
 * Create Groq provider using the dedicated @ai-sdk/groq package.
 * This handles tool calling properly for Groq-hosted models (Llama, etc.)
 * instead of the generic OpenAI-compatible provider which can misformat tool calls.
 */
export function createGroqProvider(config: Config) {
  const isDebug = (process.env.LOG_LEVEL || 'info') === 'debug';

  return createGroq({
    apiKey: config.groqApiKey || '',
    // Only inject debug fetch wrapper when LOG_LEVEL=debug
    ...(isDebug ? {
      fetch: async (url: string | URL | globalThis.Request, init?: RequestInit) => {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
        if (body?.tools) {
          logger.debug(`[GROQ] Request: ${body.tools.length} tools, tool_choice=${JSON.stringify(body.tool_choice)}`);
        }
        const response = await globalThis.fetch(url, init);
        const cloned = response.clone();
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const json: any = await cloned.json();
          if (json?.error) {
            logger.debug(`[GROQ] Error: ${json.error.code || json.error.type} — ${json.error.message}`);
          }
          const choice = json?.choices?.[0];
          if (choice) {
            logger.debug(`[GROQ] Response: finish_reason=${choice.finish_reason}, tool_calls=${!!choice.message?.tool_calls}, content_len=${choice.message?.content?.length ?? 0}`);
          }
        } catch { /* streaming or parse error, ignore */ }
        return response;
      },
    } : {}),
  });
}

/**
 * Create LM Studio provider using OpenAI-compatible API
 */
export function createLMStudioProvider(config: Config) {
  return createOpenAI({
    baseURL: config.lmstudioBaseUrl,
    apiKey: 'lm-studio', // LM Studio ignores API key
  });
}

/**
 * Create Ollama provider using OpenAI-compatible API
 */
export function createOllamaProvider(config: Config) {
  // Ollama's OpenAI-compatible endpoint is at /v1
  const baseUrl = config.ollamaBaseUrl.endsWith('/v1')
    ? config.ollamaBaseUrl
    : `${config.ollamaBaseUrl}/v1`;

  return createOpenAI({
    baseURL: baseUrl,
    apiKey: 'ollama', // Ollama ignores API key
  });
}

/**
 * Get the model ID for the selected provider
 */
export function getModelId(config: Config): string {
  switch (config.llmProvider) {
    case 'groq':
      return config.groqModel;
    case 'lmstudio':
      return config.lmstudioModel || 'local-model';
    case 'ollama':
      return config.ollamaModel;
    default:
      return config.groqModel;
  }
}

/**
 * Create a language model for session compaction (cheap summarization).
 * Uses a dedicated provider/model configured via compactionProvider + compactionModel.
 */
export function createCompactionModel(config: Config): LanguageModel {
  const provider = config.compactionProvider;
  const modelId = config.compactionModel;

  switch (provider) {
    case 'groq': {
      const groq = createGroqProvider(config);
      return groq(modelId);
    }
    case 'lmstudio': {
      const lmstudio = createLMStudioProvider(config);
      return lmstudio(modelId);
    }
    case 'ollama': {
      const ollama = createOllamaProvider(config);
      return ollama(modelId);
    }
    default: {
      const groq = createGroqProvider(config);
      return groq(modelId);
    }
  }
}

/**
 * Get provider name for logging
 */
export function getProviderDisplayName(provider: ProviderName): string {
  switch (provider) {
    case 'groq':
      return 'Groq';
    case 'lmstudio':
      return 'LM Studio';
    case 'ollama':
      return 'Ollama';
    default:
      return provider;
  }
}
