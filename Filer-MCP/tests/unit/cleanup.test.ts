import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mcp/shared/Utils/logger.js', () => ({
  Logger: class { info = vi.fn(); warn = vi.fn(); error = vi.fn(); debug = vi.fn(); },
}));

const mockReaddir = vi.fn().mockResolvedValue([]);
const mockStat = vi.fn();
const mockUnlink = vi.fn().mockResolvedValue(undefined);
const mockExistsSync = vi.fn().mockReturnValue(true);

vi.mock('node:fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
}));

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

vi.mock('../../src/utils/config.js', () => ({
  getConfig: () => ({
    workspace: { path: '/home/test/workspace' },
    cleanup: { tempDays: 7 },
  }),
}));

const mockWriteAuditEntry = vi.fn().mockResolvedValue(undefined);
const mockCreateAuditEntry = vi.fn(
  (op: string, path: string, domain: string, success: boolean, opts?: Record<string, unknown>) => ({
    operation: op, path, domain, success, ...opts,
  }),
);

vi.mock('../../src/logging/audit.js', () => ({
  writeAuditEntry: (...args: unknown[]) => mockWriteAuditEntry(...args),
  createAuditEntry: (...args: unknown[]) => mockCreateAuditEntry(...args),
}));

import { cleanupTempFiles } from '../../src/services/cleanup.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

describe('cleanupTempFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  it('returns zeros when temp dir does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await cleanupTempFiles();
    expect(result).toEqual({ deleted: 0, errors: 0, skipped: 0 });
  });

  it('deletes files older than maxAgeDays', async () => {
    mockReaddir.mockResolvedValue(['old-file.txt']);
    mockStat.mockResolvedValue({
      isDirectory: () => false,
      mtimeMs: Date.now() - 10 * ONE_DAY_MS, // 10 days old
      size: 512,
    });

    const result = await cleanupTempFiles();
    expect(result.deleted).toBe(1);
    expect(mockUnlink).toHaveBeenCalledOnce();
  });

  it('skips files younger than maxAgeDays', async () => {
    mockReaddir.mockResolvedValue(['new-file.txt']);
    mockStat.mockResolvedValue({
      isDirectory: () => false,
      mtimeMs: Date.now() - 1 * ONE_DAY_MS, // 1 day old
      size: 256,
    });

    const result = await cleanupTempFiles();
    expect(result.skipped).toBe(1);
    expect(result.deleted).toBe(0);
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('skips directories', async () => {
    mockReaddir.mockResolvedValue(['subdir']);
    mockStat.mockResolvedValue({
      isDirectory: () => true,
      mtimeMs: Date.now() - 30 * ONE_DAY_MS,
    });

    const result = await cleanupTempFiles();
    expect(result.skipped).toBe(1);
    expect(result.deleted).toBe(0);
  });

  it('counts errors without throwing', async () => {
    mockReaddir.mockResolvedValue(['broken-file.txt']);
    mockStat.mockRejectedValue(new Error('EACCES'));

    const result = await cleanupTempFiles();
    expect(result.errors).toBe(1);
    expect(result.deleted).toBe(0);
  });

  it('writes audit entry for deleted files', async () => {
    mockReaddir.mockResolvedValue(['old.txt']);
    mockStat.mockResolvedValue({
      isDirectory: () => false,
      mtimeMs: Date.now() - 10 * ONE_DAY_MS,
      size: 1024,
    });

    await cleanupTempFiles();

    expect(mockCreateAuditEntry).toHaveBeenCalledWith(
      'auto_cleanup',
      expect.stringContaining('old.txt'),
      'workspace',
      true,
      { size_bytes: 1024 },
    );
    expect(mockWriteAuditEntry).toHaveBeenCalledOnce();
  });

  it('writes audit entry for failed deletions', async () => {
    mockReaddir.mockResolvedValue(['fail.txt']);
    mockStat.mockRejectedValue(new Error('stat failed'));

    await cleanupTempFiles();

    expect(mockCreateAuditEntry).toHaveBeenCalledWith(
      'auto_cleanup',
      expect.stringContaining('fail.txt'),
      'workspace',
      false,
      { error: 'stat failed' },
    );
  });
});
