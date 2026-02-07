/**
 * Unit tests for MCP auto-discovery scanner.
 * Uses temporary directories to simulate the MCPs root with various package.json configurations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { scanForMCPs } from '../../src/config/scanner.js';

let testRoot: string;

beforeEach(() => {
  testRoot = resolve(tmpdir(), `scanner-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testRoot, { recursive: true });
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function createMCPDir(name: string, pkgJson: Record<string, unknown>): void {
  const dir = resolve(testRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'package.json'), JSON.stringify(pkgJson, null, 2));
}

describe('scanForMCPs', () => {
  it('discovers an MCP with a valid annabelle manifest', () => {
    createMCPDir('My-MCP', {
      name: 'my-mcp-server',
      main: 'dist/index.js',
      annabelle: { mcpName: 'my-mcp' },
    });

    const results = scanForMCPs(testRoot);

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('my-mcp');
    expect(results[0].dir).toBe(resolve(testRoot, 'My-MCP'));
    expect(results[0].entryPoint).toBe(resolve(testRoot, 'My-MCP/dist/index.js'));
    expect(results[0].transport).toBe('stdio');
    expect(results[0].sensitive).toBe(false);
    expect(results[0].isGuardian).toBe(false);
    expect(results[0].timeout).toBe(30000);
    expect(results[0].required).toBe(false);
  });

  it('skips directories without package.json', () => {
    mkdirSync(resolve(testRoot, 'empty-dir'), { recursive: true });

    const results = scanForMCPs(testRoot);

    expect(results).toHaveLength(0);
  });

  it('skips directories without annabelle field', () => {
    createMCPDir('Orchestrator', {
      name: 'orchestrator',
      main: 'dist/index.js',
    });
    createMCPDir('Shared', {
      name: '@mcp/shared',
      main: 'dist/index.js',
    });
    createMCPDir('Thinker', {
      name: 'thinker',
      main: 'dist/index.js',
    });

    const results = scanForMCPs(testRoot);

    expect(results).toHaveLength(0);
  });

  it('skips annabelle field without mcpName', () => {
    createMCPDir('Bad-MCP', {
      name: 'bad-mcp',
      main: 'dist/index.js',
      annabelle: { transport: 'stdio' },
    });

    const results = scanForMCPs(testRoot);

    expect(results).toHaveLength(0);
  });

  it('handles malformed package.json gracefully', () => {
    const dir = resolve(testRoot, 'Broken-MCP');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'package.json'), '{ invalid json }}}');

    const results = scanForMCPs(testRoot);

    expect(results).toHaveLength(0);
  });

  it('respects transport: "http" field', () => {
    createMCPDir('Searcher-MCP', {
      name: 'searcher-mcp',
      main: 'dist/index.js',
      annabelle: { mcpName: 'searcher', transport: 'http', httpPort: 8007 },
    });

    const results = scanForMCPs(testRoot);

    expect(results).toHaveLength(1);
    expect(results[0].transport).toBe('http');
    expect(results[0].httpPort).toBe(8007);
  });

  it('identifies Guardian by role field', () => {
    createMCPDir('Guardian', {
      name: 'guardian-mcp',
      main: 'dist/index.js',
      annabelle: { mcpName: 'guardian', role: 'guardian' },
    });

    const results = scanForMCPs(testRoot);

    expect(results).toHaveLength(1);
    expect(results[0].isGuardian).toBe(true);
    expect(results[0].name).toBe('guardian');
  });

  it('applies correct defaults for optional fields', () => {
    createMCPDir('Minimal-MCP', {
      name: 'minimal',
      annabelle: { mcpName: 'minimal' },
    });

    const results = scanForMCPs(testRoot);

    expect(results).toHaveLength(1);
    expect(results[0].transport).toBe('stdio');
    expect(results[0].sensitive).toBe(false);
    expect(results[0].isGuardian).toBe(false);
    expect(results[0].timeout).toBe(30000);
    expect(results[0].required).toBe(false);
    expect(results[0].httpPort).toBeUndefined();
    // No "main" field → defaults to dist/index.js
    expect(results[0].entryPoint).toBe(resolve(testRoot, 'Minimal-MCP/dist/index.js'));
  });

  it('resolves entry point from main field', () => {
    createMCPDir('Custom-MCP', {
      name: 'custom',
      main: 'dist/src/index.js',
      annabelle: { mcpName: 'custom' },
    });

    const results = scanForMCPs(testRoot);

    expect(results).toHaveLength(1);
    expect(results[0].entryPoint).toBe(resolve(testRoot, 'Custom-MCP/dist/src/index.js'));
  });

  it('respects custom sensitive and timeout values', () => {
    createMCPDir('Sensitive-MCP', {
      name: 'sensitive',
      main: 'dist/index.js',
      annabelle: { mcpName: 'sensitive', sensitive: true, timeout: 60000, required: true },
    });

    const results = scanForMCPs(testRoot);

    expect(results).toHaveLength(1);
    expect(results[0].sensitive).toBe(true);
    expect(results[0].timeout).toBe(60000);
    expect(results[0].required).toBe(true);
  });

  it('discovers multiple MCPs in the same root', () => {
    createMCPDir('MCP-A', {
      name: 'mcp-a',
      main: 'dist/index.js',
      annabelle: { mcpName: 'alpha' },
    });
    createMCPDir('MCP-B', {
      name: 'mcp-b',
      main: 'dist/index.js',
      annabelle: { mcpName: 'beta', transport: 'http', httpPort: 9000 },
    });
    createMCPDir('Not-An-MCP', {
      name: 'not-an-mcp',
      main: 'dist/index.js',
    });

    const results = scanForMCPs(testRoot);

    expect(results).toHaveLength(2);
    const names = results.map((r) => r.name).sort();
    expect(names).toEqual(['alpha', 'beta']);
  });

  it('respects MCP_ENABLED=false env var', () => {
    createMCPDir('Disabled-MCP', {
      name: 'disabled',
      main: 'dist/index.js',
      annabelle: { mcpName: 'disabled' },
    });

    // Set env var to disable
    process.env.DISABLED_MCP_ENABLED = 'false';

    try {
      const results = scanForMCPs(testRoot);
      expect(results).toHaveLength(0);
    } finally {
      delete process.env.DISABLED_MCP_ENABLED;
    }
  });

  it('returns empty array for non-existent root directory', () => {
    const results = scanForMCPs('/tmp/does-not-exist-12345');

    expect(results).toHaveLength(0);
  });

  it('skips non-object annabelle field', () => {
    createMCPDir('String-Annabelle', {
      name: 'bad',
      main: 'dist/index.js',
      annabelle: 'not-an-object',
    });

    const results = scanForMCPs(testRoot);

    expect(results).toHaveLength(0);
  });
});
