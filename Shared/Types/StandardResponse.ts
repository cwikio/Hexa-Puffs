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
/**
 * Create error from caught exception.
 * If the error is a BaseError subclass, the code and details are preserved.
 * Handles non-Error objects gracefully.
 */
export function createErrorFromException(error: unknown, includeStack: boolean = process.env.NODE_ENV !== 'production'): StandardResponse<never> {
  const response: StandardResponse<never> = {
    success: false,
    error: 'Unknown error',
  };

  if (error instanceof BaseError) {
    response.error = error.message;
    if (error.code) response.errorCode = error.code;
    if (error.details) response.errorDetails = error.details as Record<string, unknown>;
    if (includeStack && error.stack) {
      if (!response.errorDetails) response.errorDetails = {};
      response.errorDetails.stack = error.stack;
    }
  } else if (error instanceof Error) {
    response.error = error.message;
    response.errorCode = 'INTERNAL_ERROR';
    if (includeStack && error.stack) {
      response.errorDetails = { stack: error.stack };
    }
  } else if (typeof error === 'string') {
    response.error = error;
    response.errorCode = 'UNKNOWN_ERROR';
  } else {
    response.error = String(error) || 'Unknown error occurred';
    response.errorCode = 'UNKNOWN_ERROR';
    try {
      response.errorDetails = { originalError: error };
    } catch {
      // Ignore if error object is not sealizable
    }
  }

  return response;
}
