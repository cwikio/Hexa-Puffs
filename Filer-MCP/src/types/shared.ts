/**
 * Shared types for standardized responses
 * Matches the StandardResponse interface from the parent Shared folder
 */
export interface StandardResponse<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}
