import { expect } from "vitest";
import type { StandardResponse } from "@mcp/shared/Types/StandardResponse.js";

/**
 * Assert a StandardResponse is successful and return its data
 */
export function expectSuccess<T>(response: StandardResponse<T>): T {
  expect(response.success).toBe(true);
  expect(response.error).toBeUndefined();
  expect(response.data).toBeDefined();
  return response.data!;
}

/**
 * Assert a StandardResponse is an error and return the error message
 */
export function expectError(response: StandardResponse<unknown>): string {
  expect(response.success).toBe(false);
  expect(response.error).toBeDefined();
  return response.error!;
}

/**
 * Assert a StandardResponse error contains "Invalid input"
 */
export function expectValidationError(
  response: StandardResponse<unknown>
): void {
  expect(response.success).toBe(false);
  expect(response.error).toBeDefined();
  expect(response.error).toContain("Invalid input");
}
