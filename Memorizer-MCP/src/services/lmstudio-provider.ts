import OpenAI from 'openai';
import { type AIProviderConfig } from '../config/schema.js';
import { AIProviderError } from '../utils/errors.js';
import { BaseAIProvider, type CompletionOptions } from './ai-provider.js';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);

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

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    const maxTokens = options?.maxTokens ?? this.maxTokens;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        this.logger.debug('Sending request to LM Studio', {
          model: this.model,
          promptLength: prompt.length,
          attempt,
        });

        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: this.temperature,
          max_tokens: maxTokens,
          ...(options?.jsonMode && { response_format: { type: 'json_object' as const } }),
        });

        const content = response.choices[0]?.message?.content ?? '';

        this.logger.debug('Received response from LM Studio', {
          responseLength: content.length,
        });

        return content;
      } catch (error) {
        const statusCode = getStatusCode(error);
        const isRetryable = statusCode !== null && RETRYABLE_STATUS_CODES.has(statusCode);
        const isLastAttempt = attempt === MAX_RETRIES;

        if (!isRetryable || isLastAttempt) {
          this.logger.error('LM Studio API call failed', { error, attempt, statusCode });
          throw new AIProviderError(
            `LM Studio API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            'lmstudio',
            { error }
          );
        }

        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);

        this.logger.warn('LM Studio API call failed, retrying', {
          attempt,
          statusCode,
          delayMs: delay,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        await sleep(delay);
      }
    }

    // Unreachable, but TypeScript needs it
    throw new AIProviderError('LM Studio API call failed after all retries', 'lmstudio');
  }
}

function getStatusCode(error: unknown): number | null {
  if (error !== null && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
