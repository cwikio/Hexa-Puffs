/**
 * CodeExec MCP Server
 *
 * Registers code execution and session tools on an McpServer instance.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool } from '@mcp/shared/Utils/register-tool.js';
import { createSuccess } from '@mcp/shared/Types/StandardResponse.js';
import {
  executeCodeSchema,
  handleExecuteCode,
  type ExecuteCodeInput,
} from './tools/execute-code.js';
import {
  startSessionSchema,
  handleStartSession,
  type StartSessionInput,
  sendToSessionSchema,
  handleSendToSession,
  type SendToSessionInput,
  closeSessionSchema,
  handleCloseSession,
  type CloseSessionInput,
  listSessionsSchema,
  handleListSessions,
  type ListSessionsInput,
} from './tools/sessions.js';
import {
  installPackageSchema,
  handleInstallPackage,
  type InstallPackageInput,
} from './tools/packages.js';
import { SessionManager } from './sessions/manager.js';

export function createServer(): { server: McpServer; sessionManager: SessionManager } {
  const server = new McpServer({
    name: 'codexec',
    version: '1.0.0',
  });

  const sessionManager = new SessionManager();

  // ── One-Shot Execution ──────────────────────────────────────────────────

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

  // ── Sessions ────────────────────────────────────────────────────────────

  registerTool(server, {
    name: 'start_session',
    description:
      'Create a persistent REPL session. State (variables, imports, data) persists across send_to_session calls.\n\n' +
      'Args:\n' +
      '  - language ("python" | "node"): REPL language\n' +
      '  - name (string, optional): Human-readable session name\n' +
      '  - working_dir (string, optional): Working directory\n\n' +
      'Returns: { session_id, language, name, pid, started_at }',
    inputSchema: startSessionSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async (params) => {
      const result = await handleStartSession(sessionManager)(params as StartSessionInput);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: 'send_to_session',
    description:
      'Send code to a running REPL session. Output reflects cumulative state from all previous sends.\n\n' +
      'Args:\n' +
      '  - session_id (string): Session ID from start_session\n' +
      '  - code (string): Code to execute\n' +
      '  - timeout_ms (number, optional): Per-execution timeout\n\n' +
      'Returns: { execution_id, session_id, stdout, stderr, duration_ms, truncated, timed_out }',
    inputSchema: sendToSessionSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async (params) => {
      const result = await handleSendToSession(sessionManager)(params as SendToSessionInput);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: 'close_session',
    description:
      'Kill a REPL session and clean up resources.\n\n' +
      'Args:\n' +
      '  - session_id (string): Session ID to close\n\n' +
      'Returns: { session_id, duration_total_ms, executions_count, reason }',
    inputSchema: closeSessionSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleCloseSession(sessionManager)(params as CloseSessionInput);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: 'list_sessions',
    description:
      'List all active REPL sessions with language, age, memory usage, and execution count.\n\n' +
      'Returns: { sessions: [{ session_id, language, name, pid, started_at, last_activity_at, executions_count, memory_mb, packages_installed }] }',
    inputSchema: listSessionsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleListSessions(sessionManager)(params as ListSessionsInput);
      return createSuccess(result);
    },
  });

  // ── Package Management ──────────────────────────────────────────────────

  registerTool(server, {
    name: 'install_package',
    description:
      'Install a pip (Python) or npm (Node) package. If session_id is provided, installs into that session and makes it importable. Otherwise installs globally.\n\n' +
      'Args:\n' +
      '  - language ("python" | "node"): Package manager to use\n' +
      '  - package (string): Package name (e.g., "pandas", "lodash")\n' +
      '  - session_id (string, optional): Target session for install\n\n' +
      'Returns: { package_name, version, install_output, success }',
    inputSchema: installPackageSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (params) => {
      const result = await handleInstallPackage(sessionManager)(params as InstallPackageInput);
      return createSuccess(result);
    },
  });

  return { server, sessionManager };
}
