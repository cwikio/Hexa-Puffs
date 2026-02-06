import type { LanguageModelV1 } from 'ai';
import type { Config } from '../config.js';
import {
  createGroqProvider,
  createLMStudioProvider,
  createOllamaProvider,
  getModelId,
  getProviderDisplayName,
} from './providers.js';

/**
 * Create a language model instance based on configuration
 */
export function createLanguageModel(config: Config): LanguageModelV1 {
  const modelId = getModelId(config);
  const providerName = getProviderDisplayName(config.llmProvider);

  console.log(`Initializing ${providerName} with model: ${modelId}`);

  switch (config.llmProvider) {
    case 'groq': {
      const provider = createGroqProvider(config);
      return provider(modelId);
    }
    case 'lmstudio': {
      const provider = createLMStudioProvider(config);
      return provider(modelId);
    }
    case 'ollama': {
      const provider = createOllamaProvider(config);
      return provider(modelId);
    }
    default: {
      // Default to Groq
      const provider = createGroqProvider(config);
      return provider(modelId);
    }
  }
}

/**
 * Model factory that caches the model instance
 */
export class ModelFactory {
  private model: LanguageModelV1 | null = null;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Get or create the language model
   */
  getModel(): LanguageModelV1 {
    if (!this.model) {
      this.model = createLanguageModel(this.config);
    }
    return this.model;
  }

  /**
   * Reset the model (useful for provider switching)
   */
  reset(): void {
    this.model = null;
  }

  /**
   * Get current provider info
   */
  getProviderInfo(): { provider: string; model: string } {
    return {
      provider: getProviderDisplayName(this.config.llmProvider),
      model: getModelId(this.config),
    };
  }
}
