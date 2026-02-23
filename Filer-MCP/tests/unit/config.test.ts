import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@mcp/shared/Utils/logger.js', () => ({
  Logger: class { info = vi.fn(); warn = vi.fn(); error = vi.fn(); debug = vi.fn(); },
}));

vi.mock('@mcp/shared/Utils/config.js', () => ({
  expandPath: (p: string) => p.replace('~', '/home/test'),
  getEnvString: (key: string, def: string) => process.env[key] ?? def,
  getEnvNumber: (key: string, def: number) => {
    const v = process.env[key];
    return v !== undefined ? Number(v) : def;
  },
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(''),
  };
});

import { getConfig, resetConfig, loadConfig } from '../../src/utils/config.js';

describe('config singleton', () => {
  beforeEach(() => {
    resetConfig();
  });

  it('getConfig returns a Config object', () => {
    const config = getConfig();
    expect(config).toBeDefined();
    expect(config.workspace).toBeDefined();
    expect(config.workspace.path).toBeTruthy();
    expect(config.workspace.structure).toBeInstanceOf(Array);
    expect(config.database).toBeDefined();
    expect(config.audit).toBeDefined();
    expect(config.cleanup).toBeDefined();
  });

  it('getConfig returns the same instance on repeated calls', () => {
    const a = getConfig();
    const b = getConfig();
    expect(a).toBe(b);
  });

  it('resetConfig clears the singleton, next call creates fresh instance', () => {
    const a = getConfig();
    resetConfig();
    const b = getConfig();
    // Both are valid configs but different object references
    expect(a).not.toBe(b);
    expect(b.workspace).toBeDefined();
  });

  it('loadConfig uses default values when env vars are not set', () => {
    const config = loadConfig();
    expect(config.workspace.path).toContain('AI-Workspace');
    expect(config.cleanup.tempDays).toBe(7);
  });
});
