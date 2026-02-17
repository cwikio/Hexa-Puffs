import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpClientError } from '../src/op/client.js';

// Mock the op/client module — all tool handlers import from it
vi.mock('../src/op/client.js', () => ({
  listVaults: vi.fn(),
  listItems: vi.fn(),
  getItem: vi.fn(),
  readSecret: vi.fn(),
  OpClientError: class OpClientError extends Error {
    stderr: string;
    constructor(message: string, stderr: string) {
      super(message);
      this.name = 'OpClientError';
      this.stderr = stderr;
    }
  },
}));

import { listVaults, listItems, getItem, readSecret } from '../src/op/client.js';
import { handleListVaults } from '../src/tools/list-vaults.js';
import { handleListItems } from '../src/tools/list-items.js';
import { handleGetItem } from '../src/tools/get-item.js';
import { handleReadSecret } from '../src/tools/read-secret.js';

const mockListVaults = vi.mocked(listVaults);
const mockListItems = vi.mocked(listItems);
const mockGetItem = vi.mocked(getItem);
const mockReadSecret = vi.mocked(readSecret);

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── list_vaults ────────────────────────────────────────────────────────────

describe('handleListVaults', () => {
  it('should return vault list on success', async () => {
    mockListVaults.mockResolvedValue([
      { id: 'v1', name: 'Private' },
      { id: 'v2', name: 'Work' },
    ]);

    const result = await handleListVaults({});

    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      { id: 'v1', name: 'Private' },
      { id: 'v2', name: 'Work' },
    ]);
  });

  it('should return empty array when no vaults exist', async () => {
    mockListVaults.mockResolvedValue([]);

    const result = await handleListVaults({});

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('should handle OpClientError', async () => {
    const err = new OpClientError('1Password CLI error: not signed in', 'not signed in');
    mockListVaults.mockRejectedValue(err);

    const result = await handleListVaults({});

    expect(result.success).toBe(false);
    expect(result.error).toContain('Error listing vaults');
  });

  it('should handle generic errors', async () => {
    mockListVaults.mockRejectedValue(new Error('network timeout'));

    const result = await handleListVaults({});

    expect(result.success).toBe(false);
    expect(result.error).toBe('network timeout');
  });

  it('should handle non-Error throws', async () => {
    mockListVaults.mockRejectedValue('string error');

    const result = await handleListVaults({});

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unknown error');
  });
});

// ─── list_items ─────────────────────────────────────────────────────────────

describe('handleListItems', () => {
  const mockItem = {
    id: 'item1',
    title: 'GitHub API Key',
    category: 'API_CREDENTIAL',
    vault: { id: 'v1', name: 'Private' },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-06-01T00:00:00Z',
  };

  it('should return items for a vault', async () => {
    mockListItems.mockResolvedValue([mockItem]);

    const result = await handleListItems({ vault: 'Private' });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([{
      id: 'item1',
      title: 'GitHub API Key',
      category: 'API_CREDENTIAL',
      vault: 'Private',
      updated_at: '2025-06-01T00:00:00Z',
    }]);
    expect(mockListItems).toHaveBeenCalledWith('Private', undefined);
  });

  it('should pass categories filter to client', async () => {
    mockListItems.mockResolvedValue([]);

    await handleListItems({ vault: 'Work', categories: ['Login', 'Password'] });

    expect(mockListItems).toHaveBeenCalledWith('Work', ['Login', 'Password']);
  });

  it('should handle OpClientError', async () => {
    const err = new OpClientError('1Password CLI error: vault not found', 'vault not found');
    mockListItems.mockRejectedValue(err);

    const result = await handleListItems({ vault: 'nonexistent' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Error listing items');
  });

  it('should handle generic errors', async () => {
    mockListItems.mockRejectedValue(new Error('something broke'));

    const result = await handleListItems({ vault: 'Private' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('something broke');
  });
});

// ─── get_item ───────────────────────────────────────────────────────────────

describe('handleGetItem', () => {
  const mockItemDetails = {
    id: 'item1',
    title: 'GitHub API Key',
    category: 'API_CREDENTIAL',
    vault: { id: 'v1', name: 'Private' },
    fields: [
      { id: 'f1', type: 'CONCEALED', label: 'password', value: 'secret123', reference: 'op://Private/GitHub API Key/password' },
      { id: 'f2', type: 'STRING', label: 'username', value: 'user@example.com', reference: 'op://Private/GitHub API Key/username' },
    ],
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-06-01T00:00:00Z',
  };

  it('should return full item details', async () => {
    mockGetItem.mockResolvedValue(mockItemDetails);

    const result = await handleGetItem({ item: 'GitHub API Key' });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      id: 'item1',
      title: 'GitHub API Key',
      category: 'API_CREDENTIAL',
      vault: 'Private',
      fields: [
        { label: 'password', type: 'CONCEALED', value: 'secret123', reference: 'op://Private/GitHub API Key/password' },
        { label: 'username', type: 'STRING', value: 'user@example.com', reference: 'op://Private/GitHub API Key/username' },
      ],
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-06-01T00:00:00Z',
    });
    expect(mockGetItem).toHaveBeenCalledWith('GitHub API Key', undefined);
  });

  it('should pass vault when provided', async () => {
    mockGetItem.mockResolvedValue(mockItemDetails);

    await handleGetItem({ item: 'item1', vault: 'Private' });

    expect(mockGetItem).toHaveBeenCalledWith('item1', 'Private');
  });

  it('should handle OpClientError', async () => {
    const err = new OpClientError('1Password CLI error: item not found', 'item not found');
    mockGetItem.mockRejectedValue(err);

    const result = await handleGetItem({ item: 'nonexistent' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Error getting item');
  });

  it('should handle generic errors', async () => {
    mockGetItem.mockRejectedValue(new Error('parse failure'));

    const result = await handleGetItem({ item: 'bad-item' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('parse failure');
  });
});

// ─── read_secret ────────────────────────────────────────────────────────────

describe('handleReadSecret', () => {
  it('should return the secret value', async () => {
    mockReadSecret.mockResolvedValue('super-secret-api-key-123');

    const result = await handleReadSecret({ reference: 'op://Private/GitHub/password' });

    expect(result.success).toBe(true);
    expect(result.data).toBe('super-secret-api-key-123');
    expect(mockReadSecret).toHaveBeenCalledWith('op://Private/GitHub/password');
  });

  it('should handle OpClientError', async () => {
    const err = new OpClientError('1Password CLI error: invalid reference', 'invalid reference');
    mockReadSecret.mockRejectedValue(err);

    const result = await handleReadSecret({ reference: 'op://bad/ref' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Error reading secret');
  });

  it('should handle generic errors', async () => {
    mockReadSecret.mockRejectedValue(new Error('timeout'));

    const result = await handleReadSecret({ reference: 'op://Private/GitHub/password' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('timeout');
  });
});
