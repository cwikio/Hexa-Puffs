/**
 * MCP Test Client for Telegram MCP.
 * Re-exports shared base client with Telegram-specific defaults.
 */

export {
  MCPTestClient,
  checkMCPsAvailable,
  type MCPToolCallResult,
  type MCPHealthResult,
} from '@mcp/shared/Testing/mcp-test-client.js';

export {
  log,
  logSection,
  testId,
  wait,
  extractData,
} from '@mcp/shared/Testing/test-utils.js';

import { MCPTestClient } from '@mcp/shared/Testing/mcp-test-client.js';

// Default URL for Telegram MCP
const TELEGRAM_URL = process.env.TELEGRAM_URL || 'http://localhost:8002';

export function createTelegramClient(): MCPTestClient {
  return new MCPTestClient('Telegram', TELEGRAM_URL, { timeout: 15000 });
}
