/**
 * MCP protocol integration tests.
 *
 * Uses the MCP SDK client to connect to the CodeExec server via stdio,
 * verifying the full protocol flow end-to-end.
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
  testSandboxDir = join(tmpdir(), `codexec-integ-sandbox-${id}`);
  testLogDir = join(tmpdir(), `codexec-integ-logs-${id}`);
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

  client = new Client({ name: 'codexec-test', version: '1.0.0' });
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

/** Parse the StandardResponse from MCP tool call result */
function parseToolResult(result: { content?: unknown }): Record<string, unknown> {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

describe('MCP Protocol', () => {
  it('should list execute_code in tools/list', async () => {
    const { tools } = await client.listTools();

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain('execute_code');

    const execTool = tools.find((t) => t.name === 'execute_code');
    expect(execTool).toBeDefined();
    expect(execTool!.description).toContain('sandbox');
  });

  it('should execute Python code via tools/call', async () => {
    const result = await client.callTool({
      name: 'execute_code',
      arguments: {
        language: 'python',
        code: 'print("integration test ok")',
      },
    });

    const parsed = parseToolResult(result);
    expect(parsed.success).toBe(true);

    const data = parsed.data as Record<string, unknown>;
    expect(data.stdout).toContain('integration test ok');
    expect(data.exit_code).toBe(0);
    expect(data.execution_id).toMatch(/^exec_/);
  });

  it('should execute Node.js code via tools/call', async () => {
    const result = await client.callTool({
      name: 'execute_code',
      arguments: {
        language: 'node',
        code: 'console.log("node integration ok")',
      },
    });

    const parsed = parseToolResult(result);
    expect(parsed.success).toBe(true);

    const data = parsed.data as Record<string, unknown>;
    expect(data.stdout).toContain('node integration ok');
  });

  it('should return error for forbidden working_dir', async () => {
    const result = await client.callTool({
      name: 'execute_code',
      arguments: {
        language: 'python',
        code: 'print("should not run")',
        working_dir: '~/.ssh/',
      },
    });

    const parsed = parseToolResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('forbidden');
  });

  it('should handle syntax errors gracefully', async () => {
    const result = await client.callTool({
      name: 'execute_code',
      arguments: {
        language: 'python',
        code: 'def foo(\n',
      },
    });

    const parsed = parseToolResult(result);
    expect(parsed.success).toBe(true); // Tool didn't throw — execution ran
    const data = parsed.data as Record<string, unknown>;
    expect(data.exit_code).not.toBe(0);
    expect(data.stderr).toContain('SyntaxError');
  });
});
