import Groq from 'groq-sdk';
import { type AIProviderConfig } from '../config/schema.js';
import { AIProviderError } from '../utils/errors.js';
import { BaseAIProvider } from './ai-provider.js';

export class GroqProvider extends BaseAIProvider {
  private client: Groq;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: AIProviderConfig) {
    super('groq');

    if (!config.groqApiKey) {
      throw new AIProviderError(
        'GROQ_API_KEY is required when using Groq provider',
        'groq'
      );
    }

    this.client = new Groq({ apiKey: config.groqApiKey });
    this.model = config.groqModel;
    this.temperature = config.temperature;
    this.maxTokens = config.maxTokens;

    this.logger.info('Groq provider initialized', { model: this.model });
  }

  async complete(prompt: string): Promise<string> {
    try {
      this.logger.debug('Sending request to Groq', {
        model: this.model,
        promptLength: prompt.length,
      });

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: this.temperature,
        max_tokens: this.maxTokens,
      });

      const content = response.choices[0]?.message?.content ?? '';

      this.logger.debug('Received response from Groq', {
        responseLength: content.length,
      });

      return content;
    } catch (error) {
      this.logger.error('Groq API call failed', { error });
      throw new AIProviderError(
        `Groq API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'groq',
        { error }
      );
    }
  }
}
