/**
 * Unit tests for SessionManager.
 *
 * Tests REPL session lifecycle, state persistence, idle timeout,
 * and concurrent session limits.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SessionManager } from '../../src/sessions/manager.js';
import { resetConfig } from '../../src/config.js';

let testSandboxDir: string;
let testLogDir: string;
let manager: SessionManager;

beforeEach(async () => {
  const id = randomUUID().slice(0, 8);
  testSandboxDir = join(tmpdir(), `codexec-sess-test-sandbox-${id}`);
  testLogDir = join(tmpdir(), `codexec-sess-test-logs-${id}`);
  await mkdir(testSandboxDir, { recursive: true });
  await mkdir(testLogDir, { recursive: true });

  process.env.CODEXEC_SANDBOX_DIR = testSandboxDir;
  process.env.CODEXEC_LOG_DIR = testLogDir;
  process.env.CODEXEC_DEFAULT_TIMEOUT_MS = '30000';
  process.env.CODEXEC_MAX_TIMEOUT_MS = '300000';
  process.env.CODEXEC_MAX_OUTPUT_CHARS = '10000';
  process.env.CODEXEC_TRUNCATION_HEAD = '4000';
  process.env.CODEXEC_TRUNCATION_TAIL = '4000';
  process.env.CODEXEC_SESSION_IDLE_TIMEOUT_MS = '900000';
  process.env.CODEXEC_MAX_SESSIONS = '5';

  resetConfig();
  manager = new SessionManager();
});

afterEach(async () => {
  await manager.shutdownAll();
  await rm(testSandboxDir, { recursive: true, force: true });
  await rm(testLogDir, { recursive: true, force: true });
});

describe('SessionManager - Python sessions', () => {
  it('should start a Python session and return session info', async () => {
    const result = await manager.startSession({ language: 'python' });

    expect(result.session_id).toMatch(/^sess_/);
    expect(result.language).toBe('python');
    expect(result.pid).toBeGreaterThan(0);
    expect(result.started_at).toBeTruthy();
  });

  it('should persist state across sends', async () => {
    const { session_id } = await manager.startSession({ language: 'python' });

    // Set a variable
    const r1 = await manager.sendToSession(session_id, 'x = 42');
    expect(r1.stdout).toBe('');
    expect(r1.timed_out).toBe(false);

    // Read it back
    const r2 = await manager.sendToSession(session_id, 'print(x)');
    expect(r2.stdout.trim()).toBe('42');
  });

  it('should evaluate expressions', async () => {
    const { session_id } = await manager.startSession({ language: 'python' });

    const result = await manager.sendToSession(session_id, '2 + 2');
    expect(result.stdout.trim()).toBe('4');
  });

  it('should handle syntax errors without killing session', async () => {
    const { session_id } = await manager.startSession({ language: 'python' });

    const r1 = await manager.sendToSession(session_id, 'def foo(');
    expect(r1.stderr).toContain('SyntaxError');

    // Session is still alive
    const r2 = await manager.sendToSession(session_id, 'print("still alive")');
    expect(r2.stdout.trim()).toBe('still alive');
  });

  it('should handle runtime errors without killing session', async () => {
    const { session_id } = await manager.startSession({ language: 'python' });

    const r1 = await manager.sendToSession(session_id, '1 / 0');
    expect(r1.stderr).toContain('ZeroDivisionError');

    // Session is still alive
    const r2 = await manager.sendToSession(session_id, 'print("ok")');
    expect(r2.stdout.trim()).toBe('ok');
  });

  it('should handle multiline code', async () => {
    const { session_id } = await manager.startSession({ language: 'python' });

    const code = [
      'def factorial(n):',
      '    if n <= 1:',
      '        return 1',
      '    return n * factorial(n - 1)',
      '',
      'print(factorial(5))',
    ].join('\n');
    const result = await manager.sendToSession(session_id, code);
    expect(result.stdout.trim()).toBe('120');
  });
});

describe('SessionManager - Node sessions', () => {
  it('should start a Node session and return session info', async () => {
    const result = await manager.startSession({ language: 'node' });

    expect(result.session_id).toMatch(/^sess_/);
    expect(result.language).toBe('node');
    expect(result.pid).toBeGreaterThan(0);
  });

  it('should persist state across sends', async () => {
    const { session_id } = await manager.startSession({ language: 'node' });

    await manager.sendToSession(session_id, 'globalThis.x = 42');

    const r2 = await manager.sendToSession(session_id, 'console.log(x)');
    expect(r2.stdout.trim()).toBe('42');
  });

  it('should handle errors without killing session', async () => {
    const { session_id } = await manager.startSession({ language: 'node' });

    const r1 = await manager.sendToSession(session_id, 'throw new Error("test error")');
    expect(r1.stderr).toContain('test error');

    // Session is still alive
    const r2 = await manager.sendToSession(session_id, 'console.log("ok")');
    expect(r2.stdout.trim()).toBe('ok');
  });

  it('should support top-level await', async () => {
    const { session_id } = await manager.startSession({ language: 'node' });

    const result = await manager.sendToSession(
      session_id,
      'const val = await Promise.resolve(99); console.log(val)',
    );
    expect(result.stdout.trim()).toBe('99');
  });
});

describe('SessionManager - lifecycle', () => {
  it('should close a session', async () => {
    const { session_id } = await manager.startSession({ language: 'python' });

    const result = await manager.closeSession(session_id);
    expect(result.session_id).toBe(session_id);
    expect(result.reason).toBe('manual');
    expect(result.executions_count).toBe(0);
  });

  it('should throw on close of non-existent session', async () => {
    await expect(manager.closeSession('sess_nonexistent')).rejects.toThrow(
      'not found',
    );
  });

  it('should throw on send to non-existent session', async () => {
    await expect(
      manager.sendToSession('sess_nonexistent', 'print("hi")'),
    ).rejects.toThrow('not found');
  });

  it('should list active sessions', async () => {
    await manager.startSession({ language: 'python', name: 'test-py' });
    await manager.startSession({ language: 'node', name: 'test-node' });

    const sessions = await manager.listSessions();
    expect(sessions).toHaveLength(2);

    const names = sessions.map((s) => s.name);
    expect(names).toContain('test-py');
    expect(names).toContain('test-node');
  });

  it('should enforce max sessions limit', async () => {
    process.env.CODEXEC_MAX_SESSIONS = '2';
    resetConfig();

    await manager.startSession({ language: 'python' });
    await manager.startSession({ language: 'python' });

    await expect(manager.startSession({ language: 'python' })).rejects.toThrow(
      'Maximum 2 concurrent sessions reached',
    );
  });

  it('should validate forbidden working_dir', async () => {
    await expect(
      manager.startSession({ language: 'python', working_dir: '~/.ssh' }),
    ).rejects.toThrow('forbidden path');
  });

  it('should track execution count', async () => {
    const { session_id } = await manager.startSession({ language: 'python' });

    await manager.sendToSession(session_id, 'print(1)');
    await manager.sendToSession(session_id, 'print(2)');
    await manager.sendToSession(session_id, 'print(3)');

    const sessions = await manager.listSessions();
    const session = sessions.find((s) => s.session_id === session_id);
    expect(session?.executions_count).toBe(3);
  });

  it('should auto-close on idle timeout', async () => {
    vi.useFakeTimers();

    process.env.CODEXEC_SESSION_IDLE_TIMEOUT_MS = '1000';
    resetConfig();

    const { session_id } = await manager.startSession({ language: 'python' });

    // Advance past idle timeout
    await vi.advanceTimersByTimeAsync(1500);

    // Session should be gone
    const sessions = await manager.listSessions();
    expect(sessions.find((s) => s.session_id === session_id)).toBeUndefined();

    vi.useRealTimers();
  });

  it('should shutdown all sessions', async () => {
    await manager.startSession({ language: 'python' });
    await manager.startSession({ language: 'node' });

    expect((await manager.listSessions()).length).toBe(2);

    await manager.shutdownAll();

    expect((await manager.listSessions()).length).toBe(0);
  });
});

describe('SessionManager - auto-create session', () => {
  it('should auto-create a Python session when session_id is omitted', async () => {
    const result = await manager.sendToSession({
      language: 'python',
      code: 'print(2 + 2)',
    });

    expect(result.success !== undefined || result.session_id).toBeTruthy();
    expect(result.session_id).toMatch(/^sess_/);
    expect(result.stdout.trim()).toBe('4');
    expect(result.created_session).toBeDefined();
    expect(result.created_session?.language).toBe('python');
    expect(result.created_session?.pid).toBeGreaterThan(0);
  });

  it('should auto-create a Node session when session_id is omitted', async () => {
    const result = await manager.sendToSession({
      language: 'node',
      code: 'console.log(3 * 7)',
    });

    expect(result.session_id).toMatch(/^sess_/);
    expect(result.stdout.trim()).toBe('21');
    expect(result.created_session).toBeDefined();
    expect(result.created_session?.language).toBe('node');
  });

  it('should leave the auto-created session open for follow-up sends', async () => {
    const r1 = await manager.sendToSession({
      language: 'python',
      code: 'x = 100',
    });
    const sessionId = r1.session_id;
    expect(r1.created_session).toBeDefined();

    // Send follow-up to the same session (state persists)
    const r2 = await manager.sendToSession(sessionId, 'print(x + 1)');
    expect(r2.stdout.trim()).toBe('101');
    expect(r2.created_session).toBeUndefined();
  });

  it('should throw when session_id and language are both omitted', async () => {
    await expect(
      manager.sendToSession({ code: 'print("hi")' }),
    ).rejects.toThrow('language is required');
  });

  it('should not include created_session when using existing session_id', async () => {
    const { session_id } = await manager.startSession({ language: 'python' });

    const result = await manager.sendToSession(session_id, 'print("hello")');
    expect(result.stdout.trim()).toBe('hello');
    expect(result.created_session).toBeUndefined();
  });

  it('should auto-create when session_id is a placeholder string and language is provided', async () => {
    // LLMs sometimes pass hallucinated session IDs like "generated_session_id"
    const result = await manager.sendToSession({
      sessionId: 'generated_session_id',
      language: 'python',
      code: 'print(99)',
    });

    expect(result.session_id).toMatch(/^sess_/);
    expect(result.stdout.trim()).toBe('99');
    expect(result.created_session).toBeDefined();
  });

  it('should throw not found when session_id is invalid and no language provided', async () => {
    await expect(
      manager.sendToSession('fake_session_id', 'print("hi")'),
    ).rejects.toThrow('not found');
  });
});
