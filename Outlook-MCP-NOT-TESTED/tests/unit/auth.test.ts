/**
 * Unit tests for Outlook auth module.
 * Tests credential loading and token cache validation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/config/index.js', () => ({
  getConfig: vi.fn(() => ({
    transport: 'stdio',
    port: 8012,
    outlook: {
      credentialsPath: '/home/test/.hexa-puffs/outlook/credentials.json',
      tokenCachePath: '/home/test/.hexa-puffs/outlook/token-cache.json',
    },
  })),
}));

// Must import after mocks
import { loadCredentials, hasValidToken } from '../../src/outlook/auth.js';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadCredentials', () => {
  it('should load valid credentials', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ clientId: 'test-client-id', tenantId: 'test-tenant-id' })
    );

    const creds = loadCredentials();
    expect(creds.clientId).toBe('test-client-id');
    expect(creds.tenantId).toBe('test-tenant-id');
  });

  it('should throw if credentials file is missing', () => {
    mockExistsSync.mockReturnValue(false);

    expect(() => loadCredentials()).toThrow('credentials file not found');
  });

  it('should throw if clientId is missing', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ tenantId: 'test-tenant-id' })
    );

    expect(() => loadCredentials()).toThrow('must contain clientId and tenantId');
  });

  it('should throw if tenantId is missing', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ clientId: 'test-client-id' })
    );

    expect(() => loadCredentials()).toThrow('must contain clientId and tenantId');
  });
});

describe('hasValidToken', () => {
  it('should return false if cache file does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    expect(hasValidToken()).toBe(false);
  });

  it('should return true if cache has accounts', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        Account: {
          'test-account': { homeAccountId: 'test' },
        },
      })
    );

    expect(hasValidToken()).toBe(true);
  });

  it('should return false if cache has empty Account section', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ Account: {} })
    );

    expect(hasValidToken()).toBe(false);
  });

  it('should return false if cache file is invalid JSON', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('not valid json');

    expect(hasValidToken()).toBe(false);
  });
});
