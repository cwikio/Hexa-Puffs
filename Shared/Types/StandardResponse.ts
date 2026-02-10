import { BaseError } from './errors.js';

/**
 * Standardized response format used across all MCP tools
 */
export interface StandardResponse<T = unknown> {
  success: boolean;
  error?: string;
  errorCode?: string;
  errorDetails?: Record<string, unknown>;
  data?: T;
}

/**
 * Create a successful response with data
 */
export function createSuccess<T>(data: T): StandardResponse<T> {
  return { success: true, data };
}

/**
 * Create an error response, optionally with a structured error code and details.
 */
export function createError(
  error: string,
  errorCode?: string,
  errorDetails?: Record<string, unknown>,
): StandardResponse<never> {
  const response: StandardResponse<never> = { success: false, error };
  if (errorCode !== undefined) response.errorCode = errorCode;
  if (errorDetails !== undefined) response.errorDetails = errorDetails;
  return response;
}

/**
 * Create error from caught exception.
 * If the error is a BaseError subclass, the code and details are preserved.
 */
export function createErrorFromException(error: unknown): StandardResponse<never> {
  if (error instanceof BaseError) {
    return createError(
      error.message,
      error.code,
      error.details !== undefined ? error.details as Record<string, unknown> : undefined,
    );
  }
  return createError(error instanceof Error ? error.message : 'Unknown error');
}
