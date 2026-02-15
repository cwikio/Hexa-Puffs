import { type AIProviderConfig } from '../config/schema.js';
import { AIProviderError } from '../utils/errors.js';
import { logger, Logger } from '@mcp/shared/Utils/logger.js';

export interface CompletionOptions {
  /** Request JSON-only output from the model (response_format: json_object) */
  jsonMode?: boolean;
  /** Override the default maxTokens for this call */
  maxTokens?: number;
}

export interface AIProvider {
  complete(prompt: string, options?: CompletionOptions): Promise<string>;
}

export interface AIProviderFactory {
  create(config: AIProviderConfig): AIProvider;
}

// Abstract base class for AI providers
export abstract class BaseAIProvider implements AIProvider {
  protected logger: Logger;

  constructor(name: string) {
    this.logger = logger.child(name);
  }

  abstract complete(prompt: string, options?: CompletionOptions): Promise<string>;
}

// Factory function to create the appropriate AI provider
export function createAIProvider(config: AIProviderConfig): AIProvider {
  switch (config.provider) {
    case 'groq':
      // Dynamic import to avoid loading unnecessary dependencies
      return new GroqProviderWrapper(config);
    case 'lmstudio':
      return new LMStudioProviderWrapper(config);
    default:
      throw new AIProviderError(
        `Unknown AI provider: ${config.provider}`,
        config.provider
      );
  }
}

// Wrapper classes that handle lazy initialization
class GroqProviderWrapper extends BaseAIProvider {
  private config: AIProviderConfig;
  private provider: AIProvider | null = null;

  constructor(config: AIProviderConfig) {
    super('groq');
    this.config = config;
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    if (!this.provider) {
      const { GroqProvider } = await import('./groq-provider.js');
      this.provider = new GroqProvider(this.config);
    }
    return this.provider.complete(prompt, options);
  }
}

class LMStudioProviderWrapper extends BaseAIProvider {
  private config: AIProviderConfig;
  private provider: AIProvider | null = null;

  constructor(config: AIProviderConfig) {
    super('lmstudio');
    this.config = config;
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    if (!this.provider) {
      const { LMStudioProvider } = await import('./lmstudio-provider.js');
      this.provider = new LMStudioProvider(this.config);
    }
    return this.provider.complete(prompt, options);
  }
}
