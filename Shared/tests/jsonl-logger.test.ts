import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { unlinkSync, existsSync } from 'fs';
import { JsonlLogger, createTimestamp } from '../Logging/jsonl.js';
import type { BaseAuditEntry } from '../Logging/jsonl.js';

interface TestEntry extends BaseAuditEntry {
  action: string;
  value?: number;
}

function tempPath(): string {
  return join(tmpdir(), `shared-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
}

const tempFiles: string[] = [];

function createLogger(): { logger: JsonlLogger<TestEntry>; path: string } {
  const path = tempPath();
  tempFiles.push(path);
  return { logger: new JsonlLogger<TestEntry>(path), path };
}

afterEach(() => {
  for (const f of tempFiles) {
    if (existsSync(f)) {
      try { unlinkSync(f); } catch {}
    }
  }
  tempFiles.length = 0;
});

describe('JsonlLogger', () => {
  describe('write and read', () => {
    it('should write and read back entries', async () => {
      const { logger } = createLogger();

      await logger.write({ timestamp: '2025-01-01T00:00:00Z', action: 'create' });
      await logger.write({ timestamp: '2025-01-02T00:00:00Z', action: 'delete' });

      const entries = await logger.read();
      expect(entries).toHaveLength(2);
      expect(entries.map(e => e.action)).toContain('create');
      expect(entries.map(e => e.action)).toContain('delete');
    });

    it('should return empty array for non-existent file', async () => {
      const path = tempPath();
      const logger = new JsonlLogger<TestEntry>(path);
      // Don't write anything — file doesn't exist
      const entries = await logger.read();
      expect(entries).toEqual([]);
    });
  });

  describe('sorting', () => {
    it('should sort descending by default (newest first)', async () => {
      const { logger } = createLogger();

      await logger.write({ timestamp: '2025-01-01T00:00:00Z', action: 'first' });
      await logger.write({ timestamp: '2025-01-03T00:00:00Z', action: 'third' });
      await logger.write({ timestamp: '2025-01-02T00:00:00Z', action: 'second' });

      const entries = await logger.read();
      expect(entries[0].action).toBe('third');
      expect(entries[1].action).toBe('second');
      expect(entries[2].action).toBe('first');
    });

    it('should sort ascending when sortDescending is false', async () => {
      const { logger } = createLogger();

      await logger.write({ timestamp: '2025-01-03T00:00:00Z', action: 'third' });
      await logger.write({ timestamp: '2025-01-01T00:00:00Z', action: 'first' });

      const entries = await logger.read({ sortDescending: false });
      expect(entries[0].action).toBe('first');
      expect(entries[1].action).toBe('third');
    });
  });

  describe('limit', () => {
    it('should cap results to limit', async () => {
      const { logger } = createLogger();

      for (let i = 0; i < 5; i++) {
        await logger.write({ timestamp: `2025-01-0${i + 1}T00:00:00Z`, action: `a${i}` });
      }

      const entries = await logger.read({ limit: 2 });
      expect(entries).toHaveLength(2);
    });

    it('should default limit to 100', async () => {
      const { logger } = createLogger();

      // Write fewer than 100, verify we get them all
      for (let i = 0; i < 10; i++) {
        await logger.write({ timestamp: `2025-01-01T00:0${i}:00Z`, action: `a${i}` });
      }

      const entries = await logger.read();
      expect(entries).toHaveLength(10);
    });
  });

  describe('filter', () => {
    it('should apply filter predicate', async () => {
      const { logger } = createLogger();

      await logger.write({ timestamp: '2025-01-01T00:00:00Z', action: 'read', value: 1 });
      await logger.write({ timestamp: '2025-01-02T00:00:00Z', action: 'write', value: 2 });
      await logger.write({ timestamp: '2025-01-03T00:00:00Z', action: 'read', value: 3 });

      const entries = await logger.read({ filter: (e) => e.action === 'read' });
      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.action === 'read')).toBe(true);
    });
  });

  describe('getPath', () => {
    it('should return the configured path', () => {
      const { logger, path } = createLogger();
      expect(logger.getPath()).toBe(path);
    });
  });

  describe('malformed lines', () => {
    it('should skip malformed JSON lines', async () => {
      const { logger, path } = createLogger();

      // Write a valid entry first
      await logger.write({ timestamp: '2025-01-01T00:00:00Z', action: 'good' });

      // Manually append a malformed line
      const { appendFile } = await import('node:fs/promises');
      await appendFile(path, 'not-json\n', 'utf-8');

      await logger.write({ timestamp: '2025-01-02T00:00:00Z', action: 'also-good' });

      const entries = await logger.read();
      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.action.includes('good'))).toBe(true);
    });
  });
});

describe('createTimestamp', () => {
  it('should return an ISO date string', () => {
    const ts = createTimestamp();
    expect(() => new Date(ts)).not.toThrow();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
