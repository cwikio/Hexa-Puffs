import { createOpenAI } from '@ai-sdk/openai';
import type { Config } from '../config.js';
import type { ProviderName } from './types.js';

/**
 * Create Groq provider using OpenAI-compatible API
 */
export function createGroqProvider(config: Config) {
  return createOpenAI({
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey: config.groqApiKey || '',
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
