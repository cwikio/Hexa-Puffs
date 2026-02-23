import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mcp/shared/Utils/logger.js', () => ({
  Logger: class { info = vi.fn(); warn = vi.fn(); error = vi.fn(); debug = vi.fn(); },
}));

const mockAppendFile = vi.fn().mockResolvedValue(undefined);
const mockReadFile = vi.fn().mockResolvedValue('');
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockExistsSync = vi.fn().mockReturnValue(true);

vi.mock('node:fs/promises', () => ({
  appendFile: (...args: unknown[]) => mockAppendFile(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

vi.mock('../../src/utils/config.js', () => ({
  getConfig: () => ({
    audit: { path: '/home/test/.hexa-puffs/logs/fileops-audit.log' },
  }),
}));

import {
  createAuditEntry,
  writeAuditEntry,
  readAuditLog,
} from '../../src/logging/audit.js';

describe('audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  describe('createAuditEntry', () => {
    it('returns complete entry with all required fields', () => {
      const entry = createAuditEntry('file_read', '/workspace/doc.txt', 'workspace', true);

      expect(entry.operation).toBe('file_read');
      expect(entry.path).toBe('/workspace/doc.txt');
      expect(entry.domain).toBe('workspace');
      expect(entry.success).toBe(true);
      expect(entry.timestamp).toBeTruthy();
      expect(entry.agent_id).toBeTruthy();
      expect(entry.session_id).toBeTruthy();
      expect(entry.grant_id).toBeNull();
    });

    it('uses AGENT_ID and SESSION_ID from env when set', () => {
      const origAgent = process.env.AGENT_ID;
      const origSession = process.env.SESSION_ID;
      process.env.AGENT_ID = 'test-agent';
      process.env.SESSION_ID = 'test-session';

      try {
        const entry = createAuditEntry('file_write', '/path', 'granted', true);
        expect(entry.agent_id).toBe('test-agent');
        expect(entry.session_id).toBe('test-session');
      } finally {
        if (origAgent !== undefined) process.env.AGENT_ID = origAgent;
        else delete process.env.AGENT_ID;
        if (origSession !== undefined) process.env.SESSION_ID = origSession;
        else delete process.env.SESSION_ID;
      }
    });

    it('includes optional grant_id, size_bytes, and error', () => {
      const entry = createAuditEntry('file_read', '/path', 'granted', false, {
        grant_id: 'grant_123',
        size_bytes: 1024,
        error: 'Permission denied',
      });

      expect(entry.grant_id).toBe('grant_123');
      expect(entry.size_bytes).toBe(1024);
      expect(entry.error).toBe('Permission denied');
    });
  });

  describe('writeAuditEntry', () => {
    it('appends JSONL line to log file', async () => {
      const entry = createAuditEntry('file_read', '/path', 'workspace', true);
      await writeAuditEntry(entry);

      expect(mockAppendFile).toHaveBeenCalledWith(
        expect.stringContaining('fileops-audit.log'),
        expect.stringContaining('"operation":"file_read"'),
        'utf-8',
      );
      // Line ends with newline
      const written = mockAppendFile.mock.calls[0][1] as string;
      expect(written.endsWith('\n')).toBe(true);
    });

    it('creates log directory if missing', async () => {
      mockExistsSync.mockReturnValue(false);
      const entry = createAuditEntry('file_write', '/path', 'workspace', true);
      await writeAuditEntry(entry);

      expect(mockMkdir).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true },
      );
    });
  });

  describe('readAuditLog', () => {
    it('returns empty array when no log file exists', async () => {
      mockExistsSync.mockImplementation((p: unknown) => {
        if (typeof p === 'string' && p.endsWith('fileops-audit.log')) return false;
        return true;
      });

      const result = await readAuditLog({});
      expect(result).toEqual([]);
    });

    it('parses JSONL entries', async () => {
      const entries = [
        { timestamp: '2026-01-01T00:00:00Z', operation: 'file_read', path: '/a', domain: 'workspace', grant_id: null, agent_id: 'main', session_id: 's1', success: true },
        { timestamp: '2026-01-02T00:00:00Z', operation: 'file_write', path: '/b', domain: 'granted', grant_id: 'g1', agent_id: 'main', session_id: 's1', success: true },
      ];
      mockReadFile.mockResolvedValue(entries.map(e => JSON.stringify(e)).join('\n'));

      const result = await readAuditLog({});
      expect(result).toHaveLength(2);
    });

    it('filters by path_filter', async () => {
      const entries = [
        { timestamp: '2026-01-01T00:00:00Z', operation: 'file_read', path: '/workspace/docs/a.txt', domain: 'workspace', grant_id: null, agent_id: 'main', session_id: 's1', success: true },
        { timestamp: '2026-01-02T00:00:00Z', operation: 'file_read', path: '/tmp/b.txt', domain: 'granted', grant_id: null, agent_id: 'main', session_id: 's1', success: true },
      ];
      mockReadFile.mockResolvedValue(entries.map(e => JSON.stringify(e)).join('\n'));

      const result = await readAuditLog({ path_filter: '/workspace' });
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('/workspace/docs/a.txt');
    });

    it('filters by operation_filter', async () => {
      const entries = [
        { timestamp: '2026-01-01T00:00:00Z', operation: 'file_read', path: '/a', domain: 'workspace', grant_id: null, agent_id: 'main', session_id: 's1', success: true },
        { timestamp: '2026-01-02T00:00:00Z', operation: 'file_write', path: '/b', domain: 'workspace', grant_id: null, agent_id: 'main', session_id: 's1', success: true },
      ];
      mockReadFile.mockResolvedValue(entries.map(e => JSON.stringify(e)).join('\n'));

      const result = await readAuditLog({ operation_filter: 'file_write' });
      expect(result).toHaveLength(1);
      expect(result[0].operation).toBe('file_write');
    });

    it('filters by date_from', async () => {
      const entries = [
        { timestamp: '2026-01-01T00:00:00Z', operation: 'file_read', path: '/a', domain: 'workspace', grant_id: null, agent_id: 'main', session_id: 's1', success: true },
        { timestamp: '2026-06-15T00:00:00Z', operation: 'file_read', path: '/b', domain: 'workspace', grant_id: null, agent_id: 'main', session_id: 's1', success: true },
      ];
      mockReadFile.mockResolvedValue(entries.map(e => JSON.stringify(e)).join('\n'));

      const result = await readAuditLog({ date_from: '2026-03-01T00:00:00Z' });
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('/b');
    });

    it('sorts descending by timestamp', async () => {
      const entries = [
        { timestamp: '2026-01-01T00:00:00Z', operation: 'file_read', path: '/old', domain: 'workspace', grant_id: null, agent_id: 'main', session_id: 's1', success: true },
        { timestamp: '2026-06-01T00:00:00Z', operation: 'file_read', path: '/new', domain: 'workspace', grant_id: null, agent_id: 'main', session_id: 's1', success: true },
      ];
      mockReadFile.mockResolvedValue(entries.map(e => JSON.stringify(e)).join('\n'));

      const result = await readAuditLog({});
      expect(result[0].path).toBe('/new');
      expect(result[1].path).toBe('/old');
    });

    it('applies limit', async () => {
      const entries = Array.from({ length: 10 }, (_, i) => ({
        timestamp: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
        operation: 'file_read', path: `/file${i}`, domain: 'workspace',
        grant_id: null, agent_id: 'main', session_id: 's1', success: true,
      }));
      mockReadFile.mockResolvedValue(entries.map(e => JSON.stringify(e)).join('\n'));

      const result = await readAuditLog({ limit: 3 });
      expect(result).toHaveLength(3);
    });

    it('skips malformed JSON lines', async () => {
      const content = [
        JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', operation: 'file_read', path: '/a', domain: 'workspace', grant_id: null, agent_id: 'main', session_id: 's1', success: true }),
        'not valid json {{{',
        JSON.stringify({ timestamp: '2026-01-02T00:00:00Z', operation: 'file_write', path: '/b', domain: 'workspace', grant_id: null, agent_id: 'main', session_id: 's1', success: true }),
      ].join('\n');
      mockReadFile.mockResolvedValue(content);

      const result = await readAuditLog({});
      expect(result).toHaveLength(2);
    });
  });
});
