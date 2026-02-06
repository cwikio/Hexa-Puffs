/**
 * Shared types for standardized responses
 */
export interface StandardResponse<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}
