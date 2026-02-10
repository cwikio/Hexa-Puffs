/**
 * MCP protocol integration tests for session tools.
 *
 * Uses the MCP SDK client to connect to the CodeExec server via stdio,
 * verifying start_session, send_to_session, close_session, list_sessions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { rm, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_ENTRY = resolve(__dirname, '../../dist/index.js');

let testSandboxDir: string;
let testLogDir: string;
let client: Client;
let transport: StdioClientTransport;

beforeEach(async () => {
  const id = randomUUID().slice(0, 8);
  testSandboxDir = join(tmpdir(), `codexec-integ-sess-sandbox-${id}`);
  testLogDir = join(tmpdir(), `codexec-integ-sess-logs-${id}`);
  await mkdir(testSandboxDir, { recursive: true });
  await mkdir(testLogDir, { recursive: true });

  transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_ENTRY],
    env: {
      ...process.env,
      CODEXEC_SANDBOX_DIR: testSandboxDir,
      CODEXEC_LOG_DIR: testLogDir,
    },
  });

  client = new Client({ name: 'codexec-session-test', version: '1.0.0' });
  await client.connect(transport);
});

afterEach(async () => {
  try {
    await client.close();
  } catch {
    // Client may already be closed
  }
  await rm(testSandboxDir, { recursive: true, force: true });
  await rm(testLogDir, { recursive: true, force: true });
});

function parseToolResult(result: { content?: unknown }): Record<string, unknown> {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

describe('Session tools via MCP protocol', () => {
  it('should list session tools in tools/list', async () => {
    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain('start_session');
    expect(toolNames).toContain('send_to_session');
    expect(toolNames).toContain('close_session');
    expect(toolNames).toContain('list_sessions');
    expect(toolNames).toContain('install_package');
  });

  it('should run a full Python session lifecycle', async () => {
    // Start session
    const startResult = await client.callTool({
      name: 'start_session',
      arguments: { language: 'python', name: 'test-py' },
    });
    const start = parseToolResult(startResult);
    expect(start.success).toBe(true);
    const startData = start.data as Record<string, unknown>;
    const sessionId = startData.session_id as string;
    expect(sessionId).toMatch(/^sess_/);

    // Send code — set variable
    const send1Result = await client.callTool({
      name: 'send_to_session',
      arguments: { session_id: sessionId, code: 'x = 42' },
    });
    const send1 = parseToolResult(send1Result);
    expect(send1.success).toBe(true);

    // Send code — read variable back (state persists)
    const send2Result = await client.callTool({
      name: 'send_to_session',
      arguments: { session_id: sessionId, code: 'print(x * 2)' },
    });
    const send2 = parseToolResult(send2Result);
    expect(send2.success).toBe(true);
    const send2Data = send2.data as Record<string, unknown>;
    expect((send2Data.stdout as string).trim()).toBe('84');

    // List sessions
    const listResult = await client.callTool({
      name: 'list_sessions',
      arguments: {},
    });
    const list = parseToolResult(listResult);
    expect(list.success).toBe(true);
    const listData = list.data as Record<string, unknown>;
    const sessions = listData.sessions as Array<Record<string, unknown>>;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].session_id).toBe(sessionId);
    expect(sessions[0].executions_count).toBe(2);

    // Close session
    const closeResult = await client.callTool({
      name: 'close_session',
      arguments: { session_id: sessionId },
    });
    const close = parseToolResult(closeResult);
    expect(close.success).toBe(true);
    const closeData = close.data as Record<string, unknown>;
    expect(closeData.reason).toBe('manual');
    expect(closeData.executions_count).toBe(2);

    // List sessions — should be empty
    const list2Result = await client.callTool({
      name: 'list_sessions',
      arguments: {},
    });
    const list2 = parseToolResult(list2Result);
    const list2Data = list2.data as Record<string, unknown>;
    const sessions2 = list2Data.sessions as Array<Record<string, unknown>>;
    expect(sessions2).toHaveLength(0);
  });

  it('should run a full Node session lifecycle', async () => {
    // Start session
    const startResult = await client.callTool({
      name: 'start_session',
      arguments: { language: 'node', name: 'test-node' },
    });
    const start = parseToolResult(startResult);
    expect(start.success).toBe(true);
    const startData = start.data as Record<string, unknown>;
    const sessionId = startData.session_id as string;

    // Set and read variable
    await client.callTool({
      name: 'send_to_session',
      arguments: { session_id: sessionId, code: 'globalThis.y = 99' },
    });

    const sendResult = await client.callTool({
      name: 'send_to_session',
      arguments: { session_id: sessionId, code: 'console.log(y)' },
    });
    const send = parseToolResult(sendResult);
    expect(send.success).toBe(true);
    const sendData = send.data as Record<string, unknown>;
    expect((sendData.stdout as string).trim()).toBe('99');

    // Close
    await client.callTool({
      name: 'close_session',
      arguments: { session_id: sessionId },
    });
  });

  it('should auto-create session when session_id is omitted', async () => {
    // Send code without a session_id — should auto-create
    const sendResult = await client.callTool({
      name: 'send_to_session',
      arguments: { language: 'python', code: 'print(7 * 6)' },
    });
    const send = parseToolResult(sendResult);
    expect(send.success).toBe(true);
    const sendData = send.data as Record<string, unknown>;
    expect(sendData.session_id).toMatch(/^sess_/);
    expect((sendData.stdout as string).trim()).toBe('42');
    expect(sendData.created_session).toBeDefined();

    const created = sendData.created_session as Record<string, unknown>;
    expect(created.language).toBe('python');
    expect(created.pid).toBeGreaterThan(0);

    // Follow up — use the returned session_id (state persists)
    const sessionId = sendData.session_id as string;
    const send2Result = await client.callTool({
      name: 'send_to_session',
      arguments: { session_id: sessionId, code: 'print("still here")' },
    });
    const send2 = parseToolResult(send2Result);
    expect(send2.success).toBe(true);
    const send2Data = send2.data as Record<string, unknown>;
    expect((send2Data.stdout as string).trim()).toBe('still here');
    expect(send2Data.created_session).toBeUndefined();

    // Clean up
    await client.callTool({
      name: 'close_session',
      arguments: { session_id: sessionId },
    });
  });
});
