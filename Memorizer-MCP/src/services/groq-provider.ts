import Groq from 'groq-sdk';
import { type AIProviderConfig } from '../config/schema.js';
import { AIProviderError } from '../utils/errors.js';
import { BaseAIProvider, type CompletionOptions } from './ai-provider.js';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const RETRYABLE_STATUS_CODES = new Set([403, 429, 500, 502, 503]);

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

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    const maxTokens = options?.maxTokens ?? this.maxTokens;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        this.logger.debug('Sending request to Groq', {
          model: this.model,
          promptLength: prompt.length,
          attempt,
          jsonMode: options?.jsonMode ?? false,
        });

        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: this.temperature,
          max_tokens: maxTokens,
          ...(options?.jsonMode && { response_format: { type: 'json_object' as const } }),
        });

        const content = response.choices[0]?.message?.content ?? '';

        this.logger.debug('Received response from Groq', {
          responseLength: content.length,
        });

        return content;
      } catch (error) {
        const statusCode = getStatusCode(error);
        const isRetryable = statusCode !== null && RETRYABLE_STATUS_CODES.has(statusCode);
        const isLastAttempt = attempt === MAX_RETRIES;

        if (!isRetryable || isLastAttempt) {
          this.logger.error('Groq API call failed', { error, attempt, statusCode });
          throw new AIProviderError(
            `Groq API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            'groq',
            { error }
          );
        }

        const retryAfter = getRetryAfterMs(error);
        const delay = retryAfter ?? BASE_DELAY_MS * Math.pow(2, attempt - 1);

        this.logger.warn('Groq API call failed, retrying', {
          attempt,
          statusCode,
          delayMs: delay,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        await sleep(delay);
      }
    }

    // Unreachable, but TypeScript needs it
    throw new AIProviderError('Groq API call failed after all retries', 'groq');
  }
}

function getStatusCode(error: unknown): number | null {
  if (error !== null && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return null;
}

function getRetryAfterMs(error: unknown): number | null {
  if (error !== null && typeof error === 'object' && 'headers' in error) {
    const headers = (error as { headers: unknown }).headers;
    if (headers !== null && typeof headers === 'object' && 'retry-after' in (headers as Record<string, unknown>)) {
      const retryAfter = (headers as Record<string, unknown>)['retry-after'];
      if (typeof retryAfter === 'string') {
        const seconds = parseFloat(retryAfter);
        if (!isNaN(seconds)) return seconds * 1000;
      }
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
