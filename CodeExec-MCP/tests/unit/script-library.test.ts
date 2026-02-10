/**
 * Unit tests for the ScriptLibrary.
 *
 * Tests save/get/list/search/delete/run and index management.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ScriptLibrary } from '../../src/scripts/library.js';
import { resetConfig } from '../../src/config.js';

let testDir: string;
let testSandboxDir: string;
let testLogDir: string;
let library: ScriptLibrary;

beforeEach(async () => {
  const id = randomUUID().slice(0, 8);
  testDir = join(tmpdir(), `codexec-scripts-test-${id}`);
  testSandboxDir = join(tmpdir(), `codexec-test-sandbox-${id}`);
  testLogDir = join(tmpdir(), `codexec-test-logs-${id}`);
  await mkdir(testDir, { recursive: true });
  await mkdir(testSandboxDir, { recursive: true });
  await mkdir(testLogDir, { recursive: true });

  process.env.CODEXEC_SANDBOX_DIR = testSandboxDir;
  process.env.CODEXEC_LOG_DIR = testLogDir;
  process.env.CODEXEC_SCRIPTS_DIR = testDir;
  resetConfig();

  library = new ScriptLibrary(testDir);
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
  await rm(testSandboxDir, { recursive: true, force: true });
  await rm(testLogDir, { recursive: true, force: true });
});

// ── Slugify ───────────────────────────────────────────────────────────────────

describe('ScriptLibrary - slugify', () => {
  it('should lowercase and hyphenate', () => {
    expect(library.slugify('Hello World')).toBe('hello-world');
  });

  it('should strip special characters', () => {
    expect(library.slugify('My Script!@#$%')).toBe('my-script');
  });

  it('should trim leading/trailing hyphens', () => {
    expect(library.slugify('---test---')).toBe('test');
  });

  it('should collapse multiple separators', () => {
    expect(library.slugify('a   b   c')).toBe('a-b-c');
  });

  it('should return empty for non-alphanumeric input', () => {
    expect(library.slugify('!@#$%')).toBe('');
  });
});

// ── Save + Get ────────────────────────────────────────────────────────────────

describe('ScriptLibrary - save and get', () => {
  it('should save and retrieve a Python script', async () => {
    const saveResult = await library.save({
      name: 'Hello Python',
      description: 'A simple Python script',
      language: 'python',
      code: 'print("hello")',
      tags: ['demo'],
      packages: ['requests'],
    });

    expect(saveResult.name).toBe('hello-python');
    expect(saveResult.language).toBe('python');
    expect(saveResult.created).toBe(true);

    const getResult = await library.get('hello-python');
    expect(getResult.code).toBe('print("hello")');
    expect(getResult.metadata.description).toBe('A simple Python script');
    expect(getResult.metadata.language).toBe('python');
    expect(getResult.metadata.tags).toEqual(['demo']);
    expect(getResult.metadata.packages).toEqual(['requests']);
    expect(getResult.metadata.run_count).toBe(0);
    expect(getResult.metadata.last_run_at).toBeNull();
  });

  it('should save and retrieve a Node script', async () => {
    await library.save({
      name: 'node test',
      description: 'Node script',
      language: 'node',
      code: 'console.log("hi")',
    });

    const result = await library.get('node-test');
    expect(result.code).toBe('console.log("hi")');
    expect(result.metadata.language).toBe('node');
  });

  it('should save and retrieve a Bash script', async () => {
    await library.save({
      name: 'bash test',
      description: 'Bash script',
      language: 'bash',
      code: 'echo "hello"',
    });

    const result = await library.get('bash-test');
    expect(result.code).toBe('echo "hello"');
    expect(result.metadata.language).toBe('bash');
  });

  it('should overwrite existing script and preserve created_at', async () => {
    await library.save({
      name: 'updatable',
      description: 'Version 1',
      language: 'python',
      code: 'v1',
    });

    const first = await library.get('updatable');
    const createdAt = first.metadata.created_at;

    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 10));

    const saveResult = await library.save({
      name: 'updatable',
      description: 'Version 2',
      language: 'python',
      code: 'v2',
    });

    expect(saveResult.created).toBe(false);

    const updated = await library.get('updatable');
    expect(updated.code).toBe('v2');
    expect(updated.metadata.description).toBe('Version 2');
    expect(updated.metadata.created_at).toBe(createdAt);
    expect(updated.metadata.updated_at).not.toBe(createdAt);
  });

  it('should remove old code file when language changes', async () => {
    await library.save({
      name: 'lang-change',
      description: 'Python version',
      language: 'python',
      code: 'print("py")',
    });

    await library.save({
      name: 'lang-change',
      description: 'Node version',
      language: 'node',
      code: 'console.log("js")',
    });

    const result = await library.get('lang-change');
    expect(result.metadata.language).toBe('node');
    expect(result.code).toBe('console.log("js")');

    // Old Python file should be gone
    const { existsSync } = await import('node:fs');
    const oldFile = join(testDir, 'lang-change', 'script.py');
    expect(existsSync(oldFile)).toBe(false);
  });

  it('should throw when getting non-existent script', async () => {
    await expect(library.get('nonexistent')).rejects.toThrow('not found');
  });

  it('should reject empty slug name', async () => {
    await expect(
      library.save({
        name: '!!!',
        description: 'Bad name',
        language: 'python',
        code: 'x',
      }),
    ).rejects.toThrow('alphanumeric');
  });
});

// ── List ──────────────────────────────────────────────────────────────────────

describe('ScriptLibrary - list', () => {
  beforeEach(async () => {
    await library.save({
      name: 'py-data',
      description: 'Python data script',
      language: 'python',
      code: 'x',
      tags: ['data', 'csv'],
    });
    await library.save({
      name: 'node-api',
      description: 'Node API script',
      language: 'node',
      code: 'y',
      tags: ['api'],
    });
    await library.save({
      name: 'bash-backup',
      description: 'Bash backup',
      language: 'bash',
      code: 'z',
      tags: ['data', 'backup'],
    });
  });

  it('should list all scripts', async () => {
    const scripts = await library.list();
    expect(scripts).toHaveLength(3);
  });

  it('should filter by language', async () => {
    const pyScripts = await library.list({ language: 'python' });
    expect(pyScripts).toHaveLength(1);
    expect(pyScripts[0].name).toBe('py-data');
  });

  it('should filter by tag', async () => {
    const dataScripts = await library.list({ tag: 'data' });
    expect(dataScripts).toHaveLength(2);
    const names = dataScripts.map((s) => s.name).sort();
    expect(names).toEqual(['bash-backup', 'py-data']);
  });

  it('should filter by language and tag', async () => {
    const results = await library.list({ language: 'python', tag: 'csv' });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('py-data');
  });

  it('should return empty for no matches', async () => {
    const results = await library.list({ tag: 'nonexistent' });
    expect(results).toHaveLength(0);
  });
});

// ── Search ────────────────────────────────────────────────────────────────────

describe('ScriptLibrary - search', () => {
  beforeEach(async () => {
    await library.save({
      name: 'parse excel report',
      description: 'Reads .xlsx files and extracts data',
      language: 'python',
      code: 'x',
      tags: ['excel', 'data'],
    });
    await library.save({
      name: 'clean csv',
      description: 'Removes duplicates from CSV data',
      language: 'python',
      code: 'y',
      tags: ['csv', 'data'],
    });
    await library.save({
      name: 'deploy app',
      description: 'Deploys the application to production',
      language: 'bash',
      code: 'z',
      tags: ['deploy'],
    });
  });

  it('should find by name', async () => {
    const results = await library.search('excel');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('parse-excel-report');
  });

  it('should find by description', async () => {
    const results = await library.search('duplicates');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('clean-csv');
  });

  it('should find by tag', async () => {
    const results = await library.search('deploy');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('deploy-app');
  });

  it('should match multiple terms (AND)', async () => {
    const results = await library.search('data csv');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('clean-csv');
  });

  it('should return all for empty query', async () => {
    const results = await library.search('');
    expect(results).toHaveLength(3);
  });

  it('should be case insensitive', async () => {
    const results = await library.search('EXCEL');
    expect(results).toHaveLength(1);
  });
});

// ── Delete ────────────────────────────────────────────────────────────────────

describe('ScriptLibrary - delete', () => {
  it('should delete a script', async () => {
    await library.save({
      name: 'to-delete',
      description: 'Will be deleted',
      language: 'python',
      code: 'x',
    });

    const deleteResult = await library.delete('to-delete');
    expect(deleteResult.name).toBe('to-delete');
    expect(deleteResult.deleted).toBe(true);

    await expect(library.get('to-delete')).rejects.toThrow('not found');

    const list = await library.list();
    expect(list).toHaveLength(0);
  });

  it('should throw when deleting non-existent script', async () => {
    await expect(library.delete('nonexistent')).rejects.toThrow('not found');
  });
});

// ── Run ───────────────────────────────────────────────────────────────────────

describe('ScriptLibrary - run', () => {
  it('should run a Python script', async () => {
    await library.save({
      name: 'py-run',
      description: 'Runnable Python',
      language: 'python',
      code: 'print("executed")',
    });

    const result = await library.run({ name: 'py-run' });
    expect(result.stdout.trim()).toBe('executed');
    expect(result.exit_code).toBe(0);
    expect(result.name).toBe('py-run');
    expect(result.language).toBe('python');
    expect(result.execution_id).toMatch(/^exec_/);
  });

  it('should run a Node script', async () => {
    await library.save({
      name: 'node-run',
      description: 'Runnable Node',
      language: 'node',
      code: 'console.log("node executed")',
    });

    const result = await library.run({ name: 'node-run' });
    expect(result.stdout.trim()).toBe('node executed');
    expect(result.exit_code).toBe(0);
  });

  it('should run a Bash script', async () => {
    await library.save({
      name: 'bash-run',
      description: 'Runnable Bash',
      language: 'bash',
      code: 'echo "bash executed"',
    });

    const result = await library.run({ name: 'bash-run' });
    expect(result.stdout.trim()).toBe('bash executed');
    expect(result.exit_code).toBe(0);
  });

  it('should pass args to Python script', async () => {
    await library.save({
      name: 'py-args',
      description: 'Args test',
      language: 'python',
      code: 'import sys\nprint(" ".join(sys.argv[1:]))',
    });

    const result = await library.run({
      name: 'py-args',
      args: ['hello', 'world'],
    });
    expect(result.stdout.trim()).toBe('hello world');
  });

  it('should pass args to Node script', async () => {
    await library.save({
      name: 'node-args',
      description: 'Args test',
      language: 'node',
      code: 'console.log(process.argv.slice(2).join(" "))',
    });

    const result = await library.run({
      name: 'node-args',
      args: ['foo', 'bar'],
    });
    expect(result.stdout.trim()).toBe('foo bar');
  });

  it('should pass args to Bash script', async () => {
    await library.save({
      name: 'bash-args',
      description: 'Args test',
      language: 'bash',
      code: 'echo "$1 $2"',
    });

    const result = await library.run({
      name: 'bash-args',
      args: ['alpha', 'beta'],
    });
    expect(result.stdout.trim()).toBe('alpha beta');
  });

  it('should update run stats after execution', async () => {
    await library.save({
      name: 'stats-test',
      description: 'Stats',
      language: 'python',
      code: 'print("ok")',
    });

    await library.run({ name: 'stats-test' });
    await library.run({ name: 'stats-test' });

    const { metadata } = await library.get('stats-test');
    expect(metadata.run_count).toBe(2);
    expect(metadata.last_run_at).not.toBeNull();
    expect(metadata.last_run_success).toBe(true);
  });

  it('should track failed runs', async () => {
    await library.save({
      name: 'fail-test',
      description: 'Will fail',
      language: 'python',
      code: 'raise Exception("oops")',
    });

    const result = await library.run({ name: 'fail-test' });
    expect(result.exit_code).not.toBe(0);

    const { metadata } = await library.get('fail-test');
    expect(metadata.run_count).toBe(1);
    expect(metadata.last_run_success).toBe(false);
  });

  it('should reject forbidden working_dir', async () => {
    await library.save({
      name: 'forbidden',
      description: 'Forbidden path test',
      language: 'python',
      code: 'print("hi")',
    });

    await expect(
      library.run({ name: 'forbidden', working_dir: '~/.ssh/' }),
    ).rejects.toThrow('forbidden path');
  });
});

// ── Save and Run (atomic) ─────────────────────────────────────────────────────

describe('ScriptLibrary - save and run atomic', () => {
  it('should save and run in one call', async () => {
    const saved = await library.save({
      name: 'atomic-test',
      description: 'Atomic save+run',
      language: 'python',
      code: 'print("atomic ok")',
    });

    const run = await library.run({ name: saved.name });

    expect(saved.name).toBe('atomic-test');
    expect(saved.created).toBe(true);
    expect(run.stdout.trim()).toBe('atomic ok');
    expect(run.exit_code).toBe(0);

    // Script should be persisted
    const { metadata } = await library.get('atomic-test');
    expect(metadata.run_count).toBe(1);
  });

  it('should save and run with args', async () => {
    const saved = await library.save({
      name: 'atomic-args',
      description: 'Args test',
      language: 'python',
      code: 'import sys\nprint(sys.argv[1])',
    });

    const run = await library.run({ name: saved.name, args: ['hello'] });
    expect(run.stdout.trim()).toBe('hello');
  });
});

// ── Index Rebuild ─────────────────────────────────────────────────────────────

describe('ScriptLibrary - index rebuild', () => {
  it('should rebuild index from disk when index.json is missing', async () => {
    await library.save({
      name: 'indexed',
      description: 'Indexed script',
      language: 'python',
      code: 'x',
    });

    // Delete the index
    const indexPath = join(testDir, 'index.json');
    await rm(indexPath);

    // Create a fresh library instance (won't have cached index)
    const freshLibrary = new ScriptLibrary(testDir);
    const scripts = await freshLibrary.list();
    expect(scripts).toHaveLength(1);
    expect(scripts[0].name).toBe('indexed');
  });

  it('should rebuild index when index.json is corrupt', async () => {
    await library.save({
      name: 'survive-corruption',
      description: 'Survives',
      language: 'node',
      code: 'y',
    });

    // Corrupt the index
    const indexPath = join(testDir, 'index.json');
    await writeFile(indexPath, 'NOT VALID JSON{{{', 'utf-8');

    const freshLibrary = new ScriptLibrary(testDir);
    const scripts = await freshLibrary.list();
    expect(scripts).toHaveLength(1);
    expect(scripts[0].name).toBe('survive-corruption');
  });

  it('should return empty index for empty base directory', async () => {
    const emptyDir = join(tmpdir(), `codexec-empty-${randomUUID().slice(0, 8)}`);
    await mkdir(emptyDir, { recursive: true });

    try {
      const emptyLibrary = new ScriptLibrary(emptyDir);
      const scripts = await emptyLibrary.list();
      expect(scripts).toHaveLength(0);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});
