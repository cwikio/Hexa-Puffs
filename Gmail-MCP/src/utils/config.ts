/**
 * Configuration utilities for Gmail MCP
 */

import { homedir } from "os";
import { join } from "path";

/**
 * Expand ~ to user's home directory in a path
 */
export function expandPath(path: string): string {
  if (path.startsWith("~")) {
    return join(homedir(), path.slice(1));
  }
  return path;
}

/**
 * Get a string value from environment variable
 */
export function getEnvString(key: string, defaultValue?: string): string | undefined {
  return process.env[key] ?? defaultValue;
}

/**
 * Get a number value from environment variable
 * Uses parseInt for whole numbers (ports, timeouts, counts)
 */
export function getEnvNumber(key: string, defaultValue?: number): number | undefined {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Get a floating point number from environment variable
 * Uses parseFloat for decimal values (thresholds, temperatures)
 */
export function getEnvFloat(key: string, defaultValue?: number): number | undefined {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Get a boolean value from environment variable
 * Recognizes 'true', 'false', '1', '0'
 */
export function getEnvBoolean(key: string, defaultValue?: boolean): boolean | undefined {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const lower = value.toLowerCase();
  if (lower === "true" || lower === "1") return true;
  if (lower === "false" || lower === "0") return false;
  return defaultValue;
}

/**
 * Get a required string value from environment variable
 * Throws if not defined
 */
export function requireEnvString(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === "") {
    throw new Error(`Required environment variable ${key} is not defined`);
  }
  return value;
}
