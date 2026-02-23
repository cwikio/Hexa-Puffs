import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mcp/shared/Utils/logger.js', () => ({
  Logger: class { info = vi.fn(); warn = vi.fn(); error = vi.fn(); debug = vi.fn(); },
}));

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockExistsSync = vi.fn().mockReturnValue(false);

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

vi.mock('../../src/utils/config.js', () => ({
  getConfig: () => ({
    database: { path: '/home/test/.hexa-puffs/data/grants.db' },
  }),
}));

// We need to reset the module-level singleton between tests
// Use dynamic import after resetModules

describe('db/index', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    // Reset module state so loadGrants starts fresh
    vi.resetModules();
  });

  it('loadGrants creates empty grants when file does not exist', async () => {
    const { loadGrants } = await import('../../src/db/index.js');
    const data = await loadGrants();
    expect(data.grants).toEqual([]);
  });

  it('loadGrants reads from JSON file when it exists', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(JSON.stringify({
      grants: [{ id: 'g1', path: '/tmp' }],
    }));

    const { loadGrants } = await import('../../src/db/index.js');
    const data = await loadGrants();
    expect(data.grants).toHaveLength(1);
    expect(data.grants[0].id).toBe('g1');
  });

  it('loadGrants returns cached data on second call', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(JSON.stringify({ grants: [{ id: 'cached' }] }));

    const { loadGrants } = await import('../../src/db/index.js');
    await loadGrants();
    await loadGrants();

    // readFile should only be called once due to caching
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it('loadGrants creates empty grants when file is corrupt', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue('not json at all');

    const { loadGrants } = await import('../../src/db/index.js');
    const data = await loadGrants();
    expect(data.grants).toEqual([]);
  });

  it('loadGrants creates directory if missing', async () => {
    // existsSync: false for dir check, false for file check
    mockExistsSync.mockReturnValue(false);

    const { loadGrants } = await import('../../src/db/index.js');
    await loadGrants();

    expect(mockMkdir).toHaveBeenCalledWith(
      expect.any(String),
      { recursive: true },
    );
  });

  it('saveGrants writes JSON to disk', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(JSON.stringify({ grants: [{ id: 'g1' }] }));

    const { loadGrants, saveGrants } = await import('../../src/db/index.js');
    await loadGrants();
    await saveGrants();

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('.json'),
      expect.stringContaining('"grants"'),
      'utf-8',
    );
  });

  it('generateGrantId returns string starting with grant_', async () => {
    const { generateGrantId } = await import('../../src/db/index.js');
    const id = generateGrantId();
    expect(id).toMatch(/^grant_/);
  });
});
