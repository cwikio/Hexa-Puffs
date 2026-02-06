/**
 * MCP Test Client for Telegram MCP.
 * Re-exports shared base client with Telegram-specific defaults.
 */

export {
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

import { MCPStdioTestClient } from '@mcp/shared/Testing/mcp-stdio-test-client.js';

export function createTelegramClient(): MCPStdioTestClient {
  return new MCPStdioTestClient({
    command: 'node',
    args: ['dist/src/index.js'],
    env: { TRANSPORT: 'stdio' },
  });
}
