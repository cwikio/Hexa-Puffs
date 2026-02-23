import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mcp/shared/Utils/logger.js', () => ({
  Logger: class { info = vi.fn(); warn = vi.fn(); error = vi.fn(); debug = vi.fn(); },
}));

const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockReaddir = vi.fn().mockResolvedValue([]);
const mockStat = vi.fn();
const mockExistsSync = vi.fn().mockReturnValue(false);

vi.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}));

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

vi.mock('../../src/utils/config.js', () => ({
  getConfig: () => ({
    workspace: {
      path: '/home/test/workspace',
      structure: ['Documents/', 'Code/', 'temp/'],
    },
  }),
}));

import { initializeWorkspace, getWorkspaceStats } from '../../src/utils/workspace.js';

describe('workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  describe('initializeWorkspace', () => {
    it('creates workspace root if missing', async () => {
      await initializeWorkspace();

      expect(mockMkdir).toHaveBeenCalledWith(
        '/home/test/workspace',
        { recursive: true },
      );
    });

    it('creates all structure subdirectories', async () => {
      await initializeWorkspace();

      // Root + 3 structure dirs
      expect(mockMkdir).toHaveBeenCalledTimes(4);
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('Documents'),
        { recursive: true },
      );
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('Code'),
        { recursive: true },
      );
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('temp'),
        { recursive: true },
      );
    });

    it('is no-op when all directories exist', async () => {
      mockExistsSync.mockReturnValue(true);

      await initializeWorkspace();

      expect(mockMkdir).not.toHaveBeenCalled();
    });
  });

  describe('getWorkspaceStats', () => {
    it('returns file count and total size', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddir.mockResolvedValue([
        { name: 'file1.txt', isDirectory: () => false, isFile: () => true },
        { name: 'file2.txt', isDirectory: () => false, isFile: () => true },
      ]);
      mockStat.mockResolvedValue({ size: 100 });

      const stats = await getWorkspaceStats();

      expect(stats.workspace_path).toBe('/home/test/workspace');
      expect(stats.total_files).toBe(2);
      expect(stats.total_size_bytes).toBe(200);
    });

    it('counts temp files separately', async () => {
      mockExistsSync.mockReturnValue(true);
      // Root directory has a "temp" subdirectory
      mockReaddir.mockImplementation(async (_dir: unknown, _opts?: unknown) => {
        const dir = _dir as string;
        if (dir.endsWith('/workspace')) {
          return [
            { name: 'readme.md', isDirectory: () => false, isFile: () => true },
            { name: 'temp', isDirectory: () => true, isFile: () => false },
          ];
        }
        if (dir.endsWith('/temp')) {
          return [
            { name: 'tmp1.txt', isDirectory: () => false, isFile: () => true },
          ];
        }
        return [];
      });
      mockStat.mockResolvedValue({ size: 50 });

      const stats = await getWorkspaceStats();

      expect(stats.total_files).toBe(2);
      expect(stats.temp_files).toBe(1);
    });

    it('handles empty workspace', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddir.mockResolvedValue([]);

      const stats = await getWorkspaceStats();

      expect(stats.total_files).toBe(0);
      expect(stats.total_size_bytes).toBe(0);
      expect(stats.temp_files).toBe(0);
    });
  });
});
