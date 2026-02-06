/**
 * Unit tests for the CodeExec subprocess executor.
 *
 * Tests the executor directly (not through MCP server).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { executeInSubprocess } from '../../src/executor/subprocess.js';
import { handleExecuteCode } from '../../src/tools/execute-code.js';
import { resetConfig } from '../../src/config.js';

// Use a unique temp dir for each test run
let testSandboxDir: string;
let testLogDir: string;

beforeEach(async () => {
  const id = randomUUID().slice(0, 8);
  testSandboxDir = join(tmpdir(), `codexec-test-sandbox-${id}`);
  testLogDir = join(tmpdir(), `codexec-test-logs-${id}`);
  await mkdir(testSandboxDir, { recursive: true });
  await mkdir(testLogDir, { recursive: true });

  // Set env before config is read
  process.env.CODEXEC_SANDBOX_DIR = testSandboxDir;
  process.env.CODEXEC_LOG_DIR = testLogDir;
  process.env.CODEXEC_DEFAULT_TIMEOUT_MS = '30000';
  process.env.CODEXEC_MAX_TIMEOUT_MS = '300000';
  process.env.CODEXEC_MAX_OUTPUT_CHARS = '10000';
  process.env.CODEXEC_TRUNCATION_HEAD = '4000';
  process.env.CODEXEC_TRUNCATION_TAIL = '4000';

  resetConfig();
});

afterEach(async () => {
  await rm(testSandboxDir, { recursive: true, force: true });
  await rm(testLogDir, { recursive: true, force: true });
});

describe('executeInSubprocess', () => {
  it('should execute Python and capture stdout', async () => {
    const result = await executeInSubprocess({
      language: 'python',
      code: 'print("hello from python")',
      timeout_ms: 10_000,
      working_dir: '',
    });

    expect(result.stdout.trim()).toBe('hello from python');
    expect(result.stderr).toBe('');
    expect(result.exit_code).toBe(0);
    expect(result.timed_out).toBe(false);
    expect(result.execution_id).toMatch(/^exec_/);
  });

  it('should execute Node.js and capture stdout', async () => {
    const result = await executeInSubprocess({
      language: 'node',
      code: 'console.log("hello from node")',
      timeout_ms: 10_000,
      working_dir: '',
    });

    expect(result.stdout.trim()).toBe('hello from node');
    expect(result.exit_code).toBe(0);
  });

  it('should execute Bash and capture stdout', async () => {
    const result = await executeInSubprocess({
      language: 'bash',
      code: 'echo "hello from bash"',
      timeout_ms: 10_000,
      working_dir: '',
    });

    expect(result.stdout.trim()).toBe('hello from bash');
    expect(result.exit_code).toBe(0);
  });

  it('should capture stderr on syntax error', async () => {
    const result = await executeInSubprocess({
      language: 'python',
      code: 'def foo(\n',
      timeout_ms: 10_000,
      working_dir: '',
    });

    expect(result.exit_code).not.toBe(0);
    expect(result.stderr).toContain('SyntaxError');
  });

  it('should enforce timeout with SIGTERM', async () => {
    const result = await executeInSubprocess({
      language: 'python',
      code: 'import time; time.sleep(60)',
      timeout_ms: 1_000,
      working_dir: '',
    });

    expect(result.timed_out).toBe(true);
    expect(result.duration_ms).toBeGreaterThanOrEqual(900);
    expect(result.duration_ms).toBeLessThan(10_000);
  });

  it('should truncate large output', async () => {
    // Override config for smaller truncation limits
    process.env.CODEXEC_MAX_OUTPUT_CHARS = '200';
    process.env.CODEXEC_TRUNCATION_HEAD = '80';
    process.env.CODEXEC_TRUNCATION_TAIL = '80';
    resetConfig();

    const result = await executeInSubprocess({
      language: 'python',
      code: 'print("x" * 5000)',
      timeout_ms: 10_000,
      working_dir: '',
    });

    expect(result.truncated).toBe(true);
    expect(result.stdout).toContain('[... truncated');
    expect(result.stdout.length).toBeLessThan(5000);
  });

  it('should strip API keys from environment', async () => {
    // Set a fake API key
    process.env.GROQ_API_KEY = 'secret-key-12345';

    const result = await executeInSubprocess({
      language: 'python',
      code: 'import os; print(os.environ.get("GROQ_API_KEY", "NOT_FOUND"))',
      timeout_ms: 10_000,
      working_dir: '',
    });

    expect(result.stdout.trim()).toBe('NOT_FOUND');
    expect(result.exit_code).toBe(0);

    // Cleanup
    delete process.env.GROQ_API_KEY;
  });

  it('should pass HOME through to subprocess', async () => {
    const result = await executeInSubprocess({
      language: 'python',
      code: 'import os; print(os.environ.get("HOME", "MISSING"))',
      timeout_ms: 10_000,
      working_dir: '',
    });

    expect(result.stdout.trim()).not.toBe('MISSING');
    expect(result.exit_code).toBe(0);
  });

  it('should detect created artifacts', async () => {
    const result = await executeInSubprocess({
      language: 'python',
      code: 'with open("output.txt", "w") as f: f.write("hello")',
      timeout_ms: 10_000,
      working_dir: '',
    });

    expect(result.exit_code).toBe(0);
    expect(result.artifacts.created).toContain('output.txt');
  });

  it('should not include temp script in artifacts', async () => {
    const result = await executeInSubprocess({
      language: 'python',
      code: 'print("test")',
      timeout_ms: 10_000,
      working_dir: '',
    });

    expect(result.artifacts.created).not.toContain('_codexec_script.py');
    expect(result.artifacts.modified).not.toContain('_codexec_script.py');
  });
});

describe('handleExecuteCode', () => {
  it('should reject forbidden working_dir', async () => {
    await expect(
      handleExecuteCode({
        language: 'python',
        code: 'print("hi")',
        working_dir: '~/.ssh/',
      }),
    ).rejects.toThrow('forbidden path');
  });

  it('should clamp timeout to max', async () => {
    // This test verifies the function doesn't throw with large timeout
    // (it gets clamped internally to maxTimeoutMs)
    const result = await handleExecuteCode({
      language: 'python',
      code: 'print("hi")',
      timeout_ms: 999_999_999,
    });

    expect(result.exit_code).toBe(0);
  });
});
