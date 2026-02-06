/**
 * Standardized response format used across all MCP tools
 * Matches the StandardResponse interface from the parent Shared folder
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
