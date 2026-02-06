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
} from './tools/execute-code.js';
import {
  startSessionSchema,
  handleStartSession,
  sendToSessionSchema,
  handleSendToSession,
  closeSessionSchema,
  handleCloseSession,
  listSessionsSchema,
  handleListSessions,
} from './tools/sessions.js';
import {
  installPackageSchema,
  handleInstallPackage,
} from './tools/packages.js';
import {
  saveScriptSchema,
  handleSaveScript,
  getScriptSchema,
  handleGetScript,
  listScriptsSchema,
  handleListScripts,
  searchScriptsSchema,
  handleSearchScripts,
  runScriptSchema,
  handleRunScript,
  saveAndRunScriptSchema,
  handleSaveAndRunScript,
  deleteScriptSchema,
  handleDeleteScript,
} from './tools/scripts.js';
import { SessionManager } from './sessions/manager.js';
import { ScriptLibrary } from './scripts/library.js';

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
      const result = await handleExecuteCode(params);
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
      const result = await handleStartSession(sessionManager)(params);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: 'send_to_session',
    description:
      'Send code to a REPL session. If session_id is omitted, a new session is created automatically.\n\n' +
      'Args:\n' +
      '  - session_id (string, optional): Session ID from start_session. Omit to auto-create a new session.\n' +
      '  - language ("python" | "node", optional): Required when session_id is omitted. Ignored otherwise.\n' +
      '  - code (string): Code to execute\n' +
      '  - timeout_ms (number, optional): Per-execution timeout\n\n' +
      'Returns: { execution_id, session_id, stdout, stderr, duration_ms, truncated, timed_out, created_session? }',
    inputSchema: sendToSessionSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async (params) => {
      const result = await handleSendToSession(sessionManager)(params);
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
      const result = await handleCloseSession(sessionManager)(params);
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
      const result = await handleListSessions(sessionManager)(params);
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
      const result = await handleInstallPackage(sessionManager)(params);
      return createSuccess(result);
    },
  });

  // ── Script Library ────────────────────────────────────────────────────

  const scriptLibrary = new ScriptLibrary();

  registerTool(server, {
    name: 'save_script',
    description:
      'Save code as a reusable named script. If a script with the same name exists, it is overwritten.\n\n' +
      'Args:\n' +
      '  - name (string): Script name (slugified for storage)\n' +
      '  - description (string): What the script does\n' +
      '  - language ("python" | "node" | "bash"): Programming language\n' +
      '  - code (string): The script code\n' +
      '  - tags (string[], optional): Tags for categorization\n' +
      '  - packages (string[], optional): Required pip/npm packages\n\n' +
      'Returns: { name, language, created }',
    inputSchema: saveScriptSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleSaveScript(scriptLibrary)(params);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: 'get_script',
    description:
      'Retrieve a saved script by name. Returns the code and metadata.\n\n' +
      'Args:\n' +
      '  - name (string): Script name\n\n' +
      'Returns: { code, metadata }',
    inputSchema: getScriptSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleGetScript(scriptLibrary)(params);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: 'list_scripts',
    description:
      'List all saved scripts. Optionally filter by language or tag.\n\n' +
      'Args:\n' +
      '  - language ("python" | "node" | "bash", optional): Filter by language\n' +
      '  - tag (string, optional): Filter by tag\n\n' +
      'Returns: { scripts: [{ name, description, language, tags, packages, run_count, last_run_at }] }',
    inputSchema: listScriptsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleListScripts(scriptLibrary)(params);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: 'search_scripts',
    description:
      'Search saved scripts by keyword. Matches against name, description, and tags.\n\n' +
      'Args:\n' +
      '  - query (string): Search query\n\n' +
      'Returns: { scripts: [...] }',
    inputSchema: searchScriptsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleSearchScripts(scriptLibrary)(params);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: 'run_script',
    description:
      'Execute a saved script. Runs in a one-shot sandbox with optional arguments.\n\n' +
      'Args:\n' +
      '  - name (string): Script name to run\n' +
      '  - args (string[], optional): Arguments passed to the script\n' +
      '  - timeout_ms (number, optional): Timeout in ms\n' +
      '  - working_dir (string, optional): Working directory\n\n' +
      'Returns: { name, execution_id, language, stdout, stderr, exit_code, duration_ms, timed_out, truncated }',
    inputSchema: runScriptSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async (params) => {
      const result = await handleRunScript(scriptLibrary)(params);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: 'save_and_run_script',
    description:
      'Save code as a reusable script AND immediately execute it in one step. ' +
      'Use this instead of calling save_script + run_script separately.\n\n' +
      'Args:\n' +
      '  - name (string): Script name (slugified for storage)\n' +
      '  - description (string): What the script does\n' +
      '  - language ("python" | "node" | "bash"): Programming language\n' +
      '  - code (string): The script code\n' +
      '  - tags (string[], optional): Tags for categorization\n' +
      '  - packages (string[], optional): Required packages\n' +
      '  - args (string[], optional): Arguments passed to the script\n' +
      '  - timeout_ms (number, optional): Timeout in ms\n' +
      '  - working_dir (string, optional): Working directory\n\n' +
      'Returns: { saved: { name, language, created }, run: { stdout, stderr, exit_code, duration_ms, ... } }',
    inputSchema: saveAndRunScriptSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async (params) => {
      const result = await handleSaveAndRunScript(scriptLibrary)(params);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: 'delete_script',
    description:
      'Delete a saved script from the library.\n\n' +
      'Args:\n' +
      '  - name (string): Script name to delete\n\n' +
      'Returns: { name, deleted }',
    inputSchema: deleteScriptSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleDeleteScript(scriptLibrary)(params);
      return createSuccess(result);
    },
  });

  return { server, sessionManager };
}
