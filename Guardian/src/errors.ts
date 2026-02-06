import { BaseError } from '@mcp/shared/Types/errors.js';

/**
 * Base error for all Guardian errors.
 * Extends shared BaseError for consistent error handling across the stack.
 */
export class GuardianError extends BaseError {
  constructor(message: string, code: string, details?: unknown) {
    super(message, code, details);
    this.name = 'GuardianError';
  }
}

/**
 * Groq API client errors (auth failures, rate limits, HTTP errors)
 */
export class GroqClientError extends GuardianError {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message, 'GROQ_CLIENT_ERROR', statusCode ? { statusCode } : undefined);
    this.name = 'GroqClientError';
    this.statusCode = statusCode;
  }
}

/**
 * Ollama client errors (connection failures, missing models, HTTP errors)
 */
export class OllamaClientError extends GuardianError {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message, 'OLLAMA_CLIENT_ERROR', statusCode ? { statusCode } : undefined);
    this.name = 'OllamaClientError';
    this.statusCode = statusCode;
  }
}
