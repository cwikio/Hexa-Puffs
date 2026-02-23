import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mcp/shared/Utils/logger.js', () => ({
  Logger: class { info = vi.fn(); warn = vi.fn(); error = vi.fn(); debug = vi.fn(); },
}));

// Shared in-memory grants data for mock
let mockGrantsData: { grants: Array<Record<string, unknown>> } = { grants: [] };
const mockSaveGrants = vi.fn().mockResolvedValue(undefined);
let mockIdCounter = 0;

vi.mock('../../src/db/index.js', () => ({
  getGrantsData: () => Promise.resolve(mockGrantsData),
  saveGrants: (...args: unknown[]) => mockSaveGrants(...args),
  generateGrantId: () => `grant_test_${++mockIdCounter}`,
}));

vi.mock('../../src/utils/config.js', () => ({
  getConfig: () => ({
    grants: [],
  }),
  expandHome: (p: string) => p.replace('~', '/home/test'),
}));

import {
  findGrantForPath,
  createGrant,
  listGrants,
  revokeGrant,
  recordAccess,
  checkPermission,
  loadConfigGrants,
  ensureSystemGrants,
  type Grant,
} from '../../src/db/grants.js';

function makeGrant(overrides: Partial<Grant> = {}): Grant {
  return {
    id: `grant_${Math.random().toString(36).slice(2)}`,
    path: '/home/test/data/',
    permission: 'read',
    scope: 'permanent',
    granted_at: '2026-01-01T00:00:00Z',
    granted_by: 'user_explicit',
    expires_at: null,
    last_accessed: null,
    access_count: 0,
    ...overrides,
  };
}

describe('grants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGrantsData = { grants: [] };
    mockIdCounter = 0;
  });

  describe('findGrantForPath', () => {
    it('returns most specific matching grant', async () => {
      const broad = makeGrant({ id: 'broad', path: '/home/test/' });
      const specific = makeGrant({ id: 'specific', path: '/home/test/data/docs/' });
      mockGrantsData.grants.push(broad, specific);

      const result = await findGrantForPath('/home/test/data/docs/file.txt');
      expect(result?.id).toBe('specific');
    });

    it('returns null when no grant matches', async () => {
      mockGrantsData.grants.push(makeGrant({ path: '/home/test/other/' }));

      const result = await findGrantForPath('/completely/different/path');
      expect(result).toBeNull();
    });

    it('returns null for expired grant', async () => {
      mockGrantsData.grants.push(makeGrant({
        path: '/home/test/data/',
        expires_at: '2020-01-01T00:00:00Z', // expired
      }));

      const result = await findGrantForPath('/home/test/data/file.txt');
      expect(result).toBeNull();
    });

    it('returns non-expired grant', async () => {
      mockGrantsData.grants.push(makeGrant({
        id: 'valid',
        path: '/home/test/data/',
        expires_at: '2099-01-01T00:00:00Z', // far future
      }));

      const result = await findGrantForPath('/home/test/data/file.txt');
      expect(result?.id).toBe('valid');
    });
  });

  describe('createGrant', () => {
    it('adds grant to data and calls saveGrants', async () => {
      const grant = await createGrant('/tmp/test/', 'read-write', 'user_explicit');

      expect(mockGrantsData.grants).toHaveLength(1);
      expect(mockSaveGrants).toHaveBeenCalledOnce();
      expect(grant.path).toBe('/tmp/test/');
      expect(grant.permission).toBe('read-write');
    });

    it('returns grant with correct structure', async () => {
      const grant = await createGrant('/tmp/test/', 'read', 'config_file', 'session');

      expect(grant.id).toMatch(/^grant_test_/);
      expect(grant.scope).toBe('session');
      expect(grant.granted_by).toBe('config_file');
      expect(grant.granted_at).toBeTruthy();
      expect(grant.expires_at).toBeNull();
      expect(grant.access_count).toBe(0);
    });
  });

  describe('listGrants', () => {
    it('returns all non-expired grants', async () => {
      mockGrantsData.grants.push(
        makeGrant({ id: 'a' }),
        makeGrant({ id: 'b' }),
      );

      const result = await listGrants();
      expect(result).toHaveLength(2);
    });

    it('excludes expired grants', async () => {
      mockGrantsData.grants.push(
        makeGrant({ id: 'active' }),
        makeGrant({ id: 'expired', expires_at: '2020-01-01T00:00:00Z' }),
      );

      const result = await listGrants();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('active');
    });
  });

  describe('revokeGrant', () => {
    it('removes grant by ID', async () => {
      mockGrantsData.grants.push(makeGrant({ id: 'to-remove' }));

      const result = await revokeGrant('to-remove');
      expect(result).toBe(true);
      expect(mockGrantsData.grants).toHaveLength(0);
      expect(mockSaveGrants).toHaveBeenCalledOnce();
    });

    it('returns false for non-existent ID', async () => {
      const result = await revokeGrant('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('recordAccess', () => {
    it('updates last_accessed and increments access_count', async () => {
      const grant = makeGrant({ id: 'tracked', access_count: 3 });
      mockGrantsData.grants.push(grant);

      await recordAccess('tracked');

      expect(grant.last_accessed).toBeTruthy();
      expect(grant.access_count).toBe(4);
      expect(mockSaveGrants).toHaveBeenCalledOnce();
    });

    it('is no-op for non-existent grant', async () => {
      await recordAccess('missing');
      expect(mockSaveGrants).not.toHaveBeenCalled();
    });
  });

  describe('checkPermission', () => {
    it('allows read with read grant', async () => {
      mockGrantsData.grants.push(makeGrant({ path: '/data/', permission: 'read' }));

      const result = await checkPermission('/data/file.txt', 'read');
      expect(result.allowed).toBe(true);
      expect(result.grant).toBeDefined();
    });

    it('allows write with read-write grant', async () => {
      mockGrantsData.grants.push(makeGrant({ path: '/data/', permission: 'read-write' }));

      const result = await checkPermission('/data/file.txt', 'write');
      expect(result.allowed).toBe(true);
    });

    it('denies write with read-only grant', async () => {
      mockGrantsData.grants.push(makeGrant({ path: '/data/', permission: 'read' }));

      const result = await checkPermission('/data/file.txt', 'write');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('read-only');
    });

    it('returns reason when no grant exists', async () => {
      const result = await checkPermission('/unknown/file.txt', 'read');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('No access grant');
    });

    it('calls recordAccess (via saveGrants) on successful check', async () => {
      mockGrantsData.grants.push(makeGrant({ id: 'g1', path: '/data/' }));

      await checkPermission('/data/file.txt', 'read');
      // recordAccess triggers saveGrants
      expect(mockSaveGrants).toHaveBeenCalled();
    });
  });

  describe('loadConfigGrants', () => {
    it('returns 0 when config has no grants', async () => {
      const count = await loadConfigGrants();
      expect(count).toBe(0);
    });
  });

  describe('ensureSystemGrants', () => {
    it('creates system grants for hexa-puffs directories', async () => {
      const count = await ensureSystemGrants();
      expect(count).toBe(2); // documentation + logs
      expect(mockGrantsData.grants.length).toBeGreaterThanOrEqual(2);
    });

    it('skips if grants already exist (idempotent)', async () => {
      // First call creates them
      await ensureSystemGrants();
      mockSaveGrants.mockClear();

      // Second call should skip
      const count = await ensureSystemGrants();
      expect(count).toBe(0);
    });
  });
});
