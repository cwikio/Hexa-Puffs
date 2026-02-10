import { describe, it, expect } from 'vitest';
import { formatPipe } from '../Discovery/format.js';
import type { DiscoveredMCP } from '../Discovery/types.js';

function makeMCP(overrides: Partial<DiscoveredMCP> = {}): DiscoveredMCP {
  return {
    name: 'test-mcp',
    dir: '/path/to/Test-MCP',
    entryPoint: '/path/to/Test-MCP/dist/index.js',
    transport: 'stdio',
    sensitive: false,
    isGuardian: false,
    isChannel: false,
    timeout: 30000,
    required: false,
    ...overrides,
  };
}

describe('formatPipe', () => {
  it('formats a stdio MCP correctly', () => {
    const result = formatPipe([makeMCP()]);
    expect(result).toBe('test-mcp|stdio||/path/to/Test-MCP|0');
  });

  it('formats an HTTP MCP with port', () => {
    const result = formatPipe([
      makeMCP({ name: 'searcher', transport: 'http', httpPort: 8007 }),
    ]);
    expect(result).toBe('searcher|http|8007|/path/to/Test-MCP|0');
  });

  it('formats a sensitive MCP with 1', () => {
    const result = formatPipe([
      makeMCP({ name: 'filer', sensitive: true }),
    ]);
    expect(result).toBe('filer|stdio||/path/to/Test-MCP|1');
  });

  it('returns empty string for empty array', () => {
    const result = formatPipe([]);
    expect(result).toBe('');
  });

  it('formats multiple MCPs as separate lines', () => {
    const result = formatPipe([
      makeMCP({ name: 'alpha', dir: '/mcps/Alpha' }),
      makeMCP({ name: 'beta', transport: 'http', httpPort: 9000, dir: '/mcps/Beta' }),
    ]);

    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('alpha|stdio||/mcps/Alpha|0');
    expect(lines[1]).toBe('beta|http|9000|/mcps/Beta|0');
  });

  it('uses pipe delimiter consistently', () => {
    const result = formatPipe([makeMCP()]);
    const parts = result.split('|');
    expect(parts).toHaveLength(5);
  });
});
