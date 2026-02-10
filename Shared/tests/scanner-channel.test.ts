/**
 * Unit tests for scanner channel detection.
 * Tests that the scanner correctly identifies channel MCPs via the role field
 * and propagates channel adapter configuration from the manifest.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { scanForMCPs } from '../Discovery/scanner.js';

let testRoot: string;

beforeEach(() => {
  testRoot = resolve(tmpdir(), `scanner-channel-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe('scanner — channel detection', () => {
  it('MCP with role: "channel" sets isChannel: true', () => {
    createMCPDir('Telegram-MCP', {
      name: 'telegram-mcp',
      main: 'dist/index.js',
      annabelle: { mcpName: 'telegram', transport: 'http', role: 'channel', httpPort: 8002 },
    });

    const results = scanForMCPs(testRoot);

    expect(results).toHaveLength(1);
    expect(results[0].isChannel).toBe(true);
    expect(results[0].isGuardian).toBe(false);
  });

  it('MCP with role: "guardian" sets isGuardian: true, isChannel: false', () => {
    createMCPDir('Guardian-MCP', {
      name: 'guardian-mcp',
      main: 'dist/index.js',
      annabelle: { mcpName: 'guardian', role: 'guardian' },
    });

    const results = scanForMCPs(testRoot);

    expect(results).toHaveLength(1);
    expect(results[0].isGuardian).toBe(true);
    expect(results[0].isChannel).toBe(false);
  });

  it('MCP with no role sets both isChannel: false and isGuardian: false', () => {
    createMCPDir('Searcher-MCP', {
      name: 'searcher-mcp',
      main: 'dist/index.js',
      annabelle: { mcpName: 'searcher', transport: 'http', httpPort: 8007 },
    });

    const results = scanForMCPs(testRoot);

    expect(results).toHaveLength(1);
    expect(results[0].isChannel).toBe(false);
    expect(results[0].isGuardian).toBe(false);
  });

  it('propagates channel adapter config from manifest', () => {
    createMCPDir('Discord-MCP', {
      name: 'discord-mcp',
      main: 'dist/index.js',
      annabelle: {
        mcpName: 'discord',
        transport: 'http',
        role: 'channel',
        httpPort: 8003,
        channel: {
          botPatterns: ['[BOT]', 'Discord AutoMod:'],
          chatRefreshIntervalMs: 60000,
          maxMessageAgeMs: 300000,
        },
      },
    });

    const results = scanForMCPs(testRoot);

    expect(results).toHaveLength(1);
    expect(results[0].isChannel).toBe(true);
    expect(results[0].channelConfig).toEqual({
      botPatterns: ['[BOT]', 'Discord AutoMod:'],
      chatRefreshIntervalMs: 60000,
      maxMessageAgeMs: 300000,
    });
  });

  it('channelConfig is undefined when no channel section in manifest', () => {
    createMCPDir('Simple-Channel', {
      name: 'simple-channel',
      main: 'dist/index.js',
      annabelle: { mcpName: 'simple', role: 'channel' },
    });

    const results = scanForMCPs(testRoot);

    expect(results).toHaveLength(1);
    expect(results[0].isChannel).toBe(true);
    expect(results[0].channelConfig).toBeUndefined();
  });

  it('discovers multiple MCPs with different roles', () => {
    createMCPDir('Telegram-MCP', {
      name: 'telegram-mcp',
      main: 'dist/index.js',
      annabelle: { mcpName: 'telegram', role: 'channel', transport: 'http', httpPort: 8002 },
    });
    createMCPDir('Discord-MCP', {
      name: 'discord-mcp',
      main: 'dist/index.js',
      annabelle: { mcpName: 'discord', role: 'channel', transport: 'http', httpPort: 8003 },
    });
    createMCPDir('Guardian-MCP', {
      name: 'guardian-mcp',
      main: 'dist/index.js',
      annabelle: { mcpName: 'guardian', role: 'guardian' },
    });
    createMCPDir('Searcher-MCP', {
      name: 'searcher-mcp',
      main: 'dist/index.js',
      annabelle: { mcpName: 'searcher', transport: 'http', httpPort: 8007 },
    });

    const results = scanForMCPs(testRoot);

    expect(results).toHaveLength(4);

    const channels = results.filter((r) => r.isChannel);
    const guardians = results.filter((r) => r.isGuardian);
    const utilities = results.filter((r) => !r.isChannel && !r.isGuardian);

    expect(channels).toHaveLength(2);
    expect(guardians).toHaveLength(1);
    expect(utilities).toHaveLength(1);
  });
});
