/**
 * CodeExec MCP Server
 *
 * Registers code execution tools on an McpServer instance.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool } from '@mcp/shared/Utils/register-tool.js';
import { createSuccess } from '@mcp/shared/Types/StandardResponse.js';
import {
  executeCodeSchema,
  handleExecuteCode,
  type ExecuteCodeInput,
} from './tools/execute-code.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'codexec',
    version: '1.0.0',
  });

  registerTool(server, {
    name: 'execute_code',
    description:
      'Run code in a one-shot sandbox. Each call starts a fresh process with no state from previous calls.\n\n' +
      'Args:\n' +
      '  - language ("python" | "node" | "bash"): Programming language\n' +
      '  - code (string): Code to execute\n' +
      '  - timeout_ms (number, optional): Timeout in ms (default: 30000, max: 300000)\n' +
      '  - working_dir (string, optional): Working directory (default: sandbox temp dir)\n\n' +
      'Returns: { execution_id, language, stdout, stderr, exit_code, duration_ms, timed_out, truncated, artifacts }',
    inputSchema: executeCodeSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async (params) => {
      const result = await handleExecuteCode(params as ExecuteCodeInput);
      return createSuccess(result);
    },
  });

  return server;
}
