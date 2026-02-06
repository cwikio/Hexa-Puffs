import { BaseError } from '@mcp/shared/Types/errors.js';

/**
 * Base error for all Memory MCP errors
 * Extends shared BaseError for consistent error handling
 */
export class MemoryError extends BaseError {
  constructor(
    message: string,
    code: string,
    details?: unknown
  ) {
    super(message, code, details);
    this.name = 'MemoryError';
  }
}

export class DatabaseError extends MemoryError {
  constructor(message: string, details?: unknown) {
    super(message, 'DATABASE_ERROR', details);
    this.name = 'DatabaseError';
  }
}

export class ConfigurationError extends MemoryError {
  constructor(message: string, details?: unknown) {
    super(message, 'CONFIGURATION_ERROR', details);
    this.name = 'ConfigurationError';
  }
}

export class ValidationError extends MemoryError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class AIProviderError extends MemoryError {
  constructor(
    message: string,
    public provider: string,
    details?: unknown
  ) {
    super(message, 'AI_PROVIDER_ERROR', details);
    this.name = 'AIProviderError';
  }
}

export class ExtractionError extends MemoryError {
  constructor(message: string, details?: unknown) {
    super(message, 'EXTRACTION_ERROR', details);
    this.name = 'ExtractionError';
  }
}

export class ExportError extends MemoryError {
  constructor(message: string, details?: unknown) {
    super(message, 'EXPORT_ERROR', details);
    this.name = 'ExportError';
  }
}
