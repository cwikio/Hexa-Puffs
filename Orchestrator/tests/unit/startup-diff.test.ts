import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { loadSnapshot, saveSnapshot, computeDiff, type MCPSnapshot, type MCPDiff } from '../../src/core/startup-diff.js';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('@mcp/shared/Utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockMkdirSync = vi.mocked(mkdirSync);

describe('startup-diff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadSnapshot', () => {
    it('should return null when file does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      const result = loadSnapshot('/fake/path.json');
      expect(result).toBeNull();
    });

    it('should parse valid snapshot file', () => {
      const snapshot: MCPSnapshot = {
        timestamp: '2025-01-01T00:00:00Z',
        mcps: [
          { name: 'guardian', type: 'internal' },
          { name: 'posthog', type: 'external' },
        ],
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(snapshot));

      const result = loadSnapshot('/fake/path.json');
      expect(result).toEqual(snapshot);
    });

    it('should return null for invalid JSON', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('not json');

      const result = loadSnapshot('/fake/path.json');
      expect(result).toBeNull();
    });

    it('should return null when mcps field is missing', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ timestamp: '2025' }));

      const result = loadSnapshot('/fake/path.json');
      expect(result).toBeNull();
    });
  });

  describe('saveSnapshot', () => {
    it('should create directory if missing and write file', () => {
      mockExistsSync.mockReturnValue(false);
      const snapshot: MCPSnapshot = {
        timestamp: '2025-01-01T00:00:00Z',
        mcps: [{ name: 'test', type: 'internal' }],
      };

      saveSnapshot('/fake/dir/snapshot.json', snapshot);

      expect(mockMkdirSync).toHaveBeenCalledWith('/fake/dir', { recursive: true });
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        '/fake/dir/snapshot.json',
        JSON.stringify(snapshot, null, 2),
        'utf-8',
      );
    });

    it('should skip mkdir if directory exists', () => {
      mockExistsSync.mockReturnValue(true);
      const snapshot: MCPSnapshot = {
        timestamp: '2025-01-01T00:00:00Z',
        mcps: [],
      };

      saveSnapshot('/fake/dir/snapshot.json', snapshot);

      expect(mockMkdirSync).not.toHaveBeenCalled();
      expect(mockWriteFileSync).toHaveBeenCalled();
    });
  });

  describe('computeDiff', () => {
    it('should return empty diff when no previous snapshot', () => {
      const current: MCPSnapshot = {
        timestamp: '2025-01-01',
        mcps: [
          { name: 'guardian', type: 'internal' },
          { name: 'posthog', type: 'external' },
        ],
      };

      const diff = computeDiff(null, current);
      expect(diff.added).toEqual([]);
      expect(diff.removed).toEqual([]);
    });

    it('should detect added MCPs', () => {
      const previous: MCPSnapshot = {
        timestamp: '2025-01-01',
        mcps: [{ name: 'guardian', type: 'internal' }],
      };
      const current: MCPSnapshot = {
        timestamp: '2025-01-02',
        mcps: [
          { name: 'guardian', type: 'internal' },
          { name: 'posthog', type: 'external' },
        ],
      };

      const diff = computeDiff(previous, current);
      expect(diff.added).toEqual(['posthog']);
      expect(diff.removed).toEqual([]);
    });

    it('should detect removed MCPs', () => {
      const previous: MCPSnapshot = {
        timestamp: '2025-01-01',
        mcps: [
          { name: 'guardian', type: 'internal' },
          { name: 'neon', type: 'external' },
        ],
      };
      const current: MCPSnapshot = {
        timestamp: '2025-01-02',
        mcps: [{ name: 'guardian', type: 'internal' }],
      };

      const diff = computeDiff(previous, current);
      expect(diff.added).toEqual([]);
      expect(diff.removed).toEqual(['neon']);
    });

    it('should detect both added and removed MCPs', () => {
      const previous: MCPSnapshot = {
        timestamp: '2025-01-01',
        mcps: [
          { name: 'guardian', type: 'internal' },
          { name: 'neon', type: 'external' },
        ],
      };
      const current: MCPSnapshot = {
        timestamp: '2025-01-02',
        mcps: [
          { name: 'guardian', type: 'internal' },
          { name: 'posthog', type: 'external' },
        ],
      };

      const diff = computeDiff(previous, current);
      expect(diff.added).toEqual(['posthog']);
      expect(diff.removed).toEqual(['neon']);
    });

    it('should return empty diff when no changes', () => {
      const previous: MCPSnapshot = {
        timestamp: '2025-01-01',
        mcps: [
          { name: 'guardian', type: 'internal' },
          { name: 'memory', type: 'internal' },
        ],
      };
      const current: MCPSnapshot = {
        timestamp: '2025-01-02',
        mcps: [
          { name: 'guardian', type: 'internal' },
          { name: 'memory', type: 'internal' },
        ],
      };

      const diff = computeDiff(previous, current);
      expect(diff.added).toEqual([]);
      expect(diff.removed).toEqual([]);
    });
  });
});
