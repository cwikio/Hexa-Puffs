import type { LanguageModel } from 'ai';
import type { Config } from '../config.js';
import { Logger } from '@mcp/shared/Utils/logger.js';

const logger = new Logger('thinker:llm');
import {
  createGroqProvider,
  createLMStudioProvider,
  createOllamaProvider,
  createCompactionModel,
  getModelId,
  getProviderDisplayName,
} from './providers.js';

/**
 * Create a language model instance based on configuration
 */
export function createLanguageModel(config: Config): LanguageModel {
  const modelId = getModelId(config);
  const providerName = getProviderDisplayName(config.llmProvider);

  logger.info(`Initializing ${providerName} with model: ${modelId}`);

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
  private model: LanguageModel | null = null;
  private compactionModel: LanguageModel | null = null;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Get or create the language model
   */
  getModel(): LanguageModel {
    if (!this.model) {
      this.model = createLanguageModel(this.config);
    }
    return this.model;
  }

  /**
   * Get or create the compaction model (cheap summarization).
   * Uses a dedicated small model (e.g. llama-3.1-8b-instant) to minimize cost.
   * Falls back to the main agent model if compaction model is not configured.
   */
  getCompactionModel(): LanguageModel {
    if (!this.compactionModel) {
      if (this.config.compactionProvider && this.config.compactionModel) {
        this.compactionModel = createCompactionModel(this.config);
        logger.info(`Compaction model initialized: ${this.config.compactionProvider}/${this.config.compactionModel}`);
      } else {
        // Fallback to main model
        this.compactionModel = this.getModel();
      }
    }
    return this.compactionModel;
  }

  /**
   * Reset the model (useful for provider switching)
   */
  reset(): void {
    this.model = null;
    this.compactionModel = null;
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
