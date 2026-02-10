/**
 * MCP integration tests for Script Library tools.
 *
 * Uses the MCP SDK client to test save/get/list/search/run/delete scripts
 * through the full MCP protocol.
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
let testScriptsDir: string;
let client: Client;
let transport: StdioClientTransport;

beforeEach(async () => {
  const id = randomUUID().slice(0, 8);
  testSandboxDir = join(tmpdir(), `codexec-integ-sandbox-${id}`);
  testLogDir = join(tmpdir(), `codexec-integ-logs-${id}`);
  testScriptsDir = join(tmpdir(), `codexec-integ-scripts-${id}`);
  await mkdir(testSandboxDir, { recursive: true });
  await mkdir(testLogDir, { recursive: true });
  await mkdir(testScriptsDir, { recursive: true });

  transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_ENTRY],
    env: {
      ...process.env,
      CODEXEC_SANDBOX_DIR: testSandboxDir,
      CODEXEC_LOG_DIR: testLogDir,
      CODEXEC_SCRIPTS_DIR: testScriptsDir,
    },
  });

  client = new Client({ name: 'codexec-scripts-test', version: '1.0.0' });
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
  await rm(testScriptsDir, { recursive: true, force: true });
});

/** Parse the StandardResponse from MCP tool call result */
function parseToolResult(result: { content?: unknown }): Record<string, unknown> {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

describe('Script Library - MCP Protocol', () => {
  it('should list all 7 script tools', async () => {
    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain('save_script');
    expect(toolNames).toContain('get_script');
    expect(toolNames).toContain('list_scripts');
    expect(toolNames).toContain('search_scripts');
    expect(toolNames).toContain('run_script');
    expect(toolNames).toContain('save_and_run_script');
    expect(toolNames).toContain('delete_script');
  });

  it('should save, get, run, list, and delete a script', async () => {
    // Save
    const saveResult = await client.callTool({
      name: 'save_script',
      arguments: {
        name: 'integration test',
        description: 'A test script',
        language: 'python',
        code: 'print("integration ok")',
        tags: ['test'],
      },
    });

    const saveParsed = parseToolResult(saveResult);
    expect(saveParsed.success).toBe(true);
    const saveData = saveParsed.data as Record<string, unknown>;
    expect(saveData.name).toBe('integration-test');
    expect(saveData.created).toBe(true);

    // Get
    const getResult = await client.callTool({
      name: 'get_script',
      arguments: { name: 'integration-test' },
    });

    const getParsed = parseToolResult(getResult);
    expect(getParsed.success).toBe(true);
    const getData = getParsed.data as Record<string, unknown>;
    expect(getData.code).toBe('print("integration ok")');

    // Run
    const runResult = await client.callTool({
      name: 'run_script',
      arguments: { name: 'integration-test' },
    });

    const runParsed = parseToolResult(runResult);
    expect(runParsed.success).toBe(true);
    const runData = runParsed.data as Record<string, unknown>;
    expect((runData.stdout as string).trim()).toBe('integration ok');
    expect(runData.exit_code).toBe(0);

    // List
    const listResult = await client.callTool({
      name: 'list_scripts',
      arguments: {},
    });

    const listParsed = parseToolResult(listResult);
    expect(listParsed.success).toBe(true);
    const listData = listParsed.data as Record<string, unknown>;
    const scripts = listData.scripts as Array<Record<string, unknown>>;
    expect(scripts).toHaveLength(1);
    expect(scripts[0].run_count).toBe(1);

    // Delete
    const deleteResult = await client.callTool({
      name: 'delete_script',
      arguments: { name: 'integration-test' },
    });

    const deleteParsed = parseToolResult(deleteResult);
    expect(deleteParsed.success).toBe(true);
    const deleteData = deleteParsed.data as Record<string, unknown>;
    expect(deleteData.deleted).toBe(true);

    // Verify deleted
    const listAfter = await client.callTool({
      name: 'list_scripts',
      arguments: {},
    });
    const listAfterParsed = parseToolResult(listAfter);
    const listAfterData = listAfterParsed.data as Record<string, unknown>;
    expect((listAfterData.scripts as unknown[]).length).toBe(0);
  });

  it('should search scripts by keyword', async () => {
    // Save two scripts
    await client.callTool({
      name: 'save_script',
      arguments: {
        name: 'data parser',
        description: 'Parses CSV data files',
        language: 'python',
        code: 'import csv',
        tags: ['data', 'csv'],
      },
    });

    await client.callTool({
      name: 'save_script',
      arguments: {
        name: 'deploy script',
        description: 'Deploys the app',
        language: 'bash',
        code: 'echo deploy',
        tags: ['deploy'],
      },
    });

    // Search for data-related scripts
    const searchResult = await client.callTool({
      name: 'search_scripts',
      arguments: { query: 'csv' },
    });

    const searchParsed = parseToolResult(searchResult);
    expect(searchParsed.success).toBe(true);
    const searchData = searchParsed.data as Record<string, unknown>;
    const results = searchData.scripts as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('data-parser');
  });

  it('should run a script with arguments', async () => {
    await client.callTool({
      name: 'save_script',
      arguments: {
        name: 'greeter',
        description: 'Greets someone',
        language: 'python',
        code: 'import sys\nprint(f"Hello {sys.argv[1]}!")',
      },
    });

    const runResult = await client.callTool({
      name: 'run_script',
      arguments: {
        name: 'greeter',
        args: ['World'],
      },
    });

    const runParsed = parseToolResult(runResult);
    expect(runParsed.success).toBe(true);
    const runData = runParsed.data as Record<string, unknown>;
    expect((runData.stdout as string).trim()).toBe('Hello World!');
  });

  it('should save and run a script atomically', async () => {
    const result = await client.callTool({
      name: 'save_and_run_script',
      arguments: {
        name: 'atomic test',
        description: 'Atomic save and run',
        language: 'python',
        code: 'print("atomic works")',
        tags: ['test'],
      },
    });

    const parsed = parseToolResult(result);
    expect(parsed.success).toBe(true);
    const data = parsed.data as Record<string, unknown>;

    const saved = data.saved as Record<string, unknown>;
    expect(saved.name).toBe('atomic-test');
    expect(saved.created).toBe(true);

    const run = data.run as Record<string, unknown>;
    expect((run.stdout as string).trim()).toBe('atomic works');
    expect(run.exit_code).toBe(0);

    // Verify it's persisted
    const listResult = await client.callTool({
      name: 'list_scripts',
      arguments: {},
    });
    const listParsed = parseToolResult(listResult);
    const listData = listParsed.data as Record<string, unknown>;
    const scripts = listData.scripts as Array<Record<string, unknown>>;
    expect(scripts).toHaveLength(1);
    expect(scripts[0].run_count).toBe(1);
  });

  it('should filter scripts by language', async () => {
    await client.callTool({
      name: 'save_script',
      arguments: {
        name: 'py-script',
        description: 'Python',
        language: 'python',
        code: 'pass',
      },
    });

    await client.callTool({
      name: 'save_script',
      arguments: {
        name: 'bash-script',
        description: 'Bash',
        language: 'bash',
        code: 'true',
      },
    });

    const listResult = await client.callTool({
      name: 'list_scripts',
      arguments: { language: 'python' },
    });

    const parsed = parseToolResult(listResult);
    const data = parsed.data as Record<string, unknown>;
    const scripts = data.scripts as Array<Record<string, unknown>>;
    expect(scripts).toHaveLength(1);
    expect(scripts[0].name).toBe('py-script');
  });
});
