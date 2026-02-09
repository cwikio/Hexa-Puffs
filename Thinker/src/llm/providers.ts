import { createOpenAI } from '@ai-sdk/openai';
import { createGroq } from '@ai-sdk/groq';
import type { LanguageModel } from 'ai';
import type { Config } from '../config.js';
import type { ProviderName } from './types.js';

/**
 * Create Groq provider using the dedicated @ai-sdk/groq package.
 * This handles tool calling properly for Groq-hosted models (Llama 4, etc.)
 * instead of the generic OpenAI-compatible provider which can misformat tool calls.
 */
export function createGroqProvider(config: Config) {
  return createGroq({
    apiKey: config.groqApiKey || '',
    // DEBUG: log raw request/response to diagnose tool calling
    fetch: async (url, init) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      if (body?.tools) {
        console.log(`[GROQ-DEBUG] Request has ${body.tools.length} tools, tool_choice=${JSON.stringify(body.tool_choice)}`);
        console.log(`[GROQ-DEBUG] First tool: ${JSON.stringify(body.tools[0]?.function?.name)}`);
        // Dump image_search tool definition to see exact schema
        const imgTool = body.tools.find((t: { function?: { name?: string } }) => t.function?.name === 'searcher_image_search');
        if (imgTool) {
          console.log(`[GROQ-DEBUG] image_search tool: ${JSON.stringify(imgTool)}`);
        }
        // Dump first tool to see format
        console.log(`[GROQ-DEBUG] First tool full: ${JSON.stringify(body.tools[0])}`);
      }
      const response = await globalThis.fetch(url, init);
      // Clone to read body without consuming it
      const cloned = response.clone();
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const json: any = await cloned.json();
        const choice = json?.choices?.[0];
        if (choice) {
          console.log(`[GROQ-DEBUG] Response finish_reason=${choice.finish_reason}, has_tool_calls=${!!choice.message?.tool_calls}, content_length=${choice.message?.content?.length ?? 0}`);
          if (choice.message?.content && !choice.message?.tool_calls) {
            console.log(`[GROQ-DEBUG] Content preview: ${choice.message.content.substring(0, 200)}`);
          }
        }
      } catch { /* streaming or parse error, ignore */ }
      return response;
    },
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
