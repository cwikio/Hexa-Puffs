import OpenAI from 'openai';
import { type AIProviderConfig } from '../config/schema.js';
import { AIProviderError } from '../utils/errors.js';
import { BaseAIProvider } from './ai-provider.js';

export class LMStudioProvider extends BaseAIProvider {
  private client: OpenAI;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: AIProviderConfig) {
    super('lmstudio');

    this.client = new OpenAI({
      baseURL: config.lmstudioBaseUrl,
      apiKey: 'not-needed', // LM Studio doesn't require an API key
    });
    this.model = config.lmstudioModel;
    this.temperature = config.temperature;
    this.maxTokens = config.maxTokens;

    this.logger.info('LM Studio provider initialized', {
      baseUrl: config.lmstudioBaseUrl,
      model: this.model,
    });
  }

  async complete(prompt: string): Promise<string> {
    try {
      this.logger.debug('Sending request to LM Studio', {
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

      this.logger.debug('Received response from LM Studio', {
        responseLength: content.length,
      });

      return content;
    } catch (error) {
      this.logger.error('LM Studio API call failed', { error });
      throw new AIProviderError(
        `LM Studio API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'lmstudio',
        { error }
      );
    }
  }
}
