/**
 * Standardized response format used across all MCP tools
 */
export interface StandardResponse<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

/**
 * Create a successful response with data
 */
export function createSuccess<T>(data: T): StandardResponse<T> {
  return { success: true, data };
}

/**
 * Create an error response
 */
export function createError(error: string): StandardResponse<never> {
  return { success: false, error };
}

/**
 * Create error from caught exception
 */
export function createErrorFromException(error: unknown): StandardResponse<never> {
  return createError(error instanceof Error ? error.message : 'Unknown error');
}
