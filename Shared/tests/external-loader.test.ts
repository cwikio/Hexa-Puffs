/**
 * Tests for external MCP config loader.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadExternalMCPs } from '../Discovery/external-loader.js';

describe('loadExternalMCPs', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'external-mcps-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should return empty record when file does not exist', () => {
    const result = loadExternalMCPs(join(tempDir, 'nonexistent.json'));
    expect(result).toEqual({});
  });

  it('should return empty record for empty JSON object', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, '{}');

    const result = loadExternalMCPs(configPath);
    expect(result).toEqual({});
  });

  it('should parse a valid external MCP config', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify({
      posthog: {
        command: 'npx',
        args: ['-y', '@anthropic/posthog-mcp'],
        env: { POSTHOG_API_KEY: 'test-key' },
        timeout: 15000,
      },
    }));

    const result = loadExternalMCPs(configPath);

    expect(result).toHaveProperty('posthog');
    expect(result.posthog).toEqual({
      command: 'npx',
      args: ['-y', '@anthropic/posthog-mcp'],
      env: { POSTHOG_API_KEY: 'test-key' },
      timeout: 15000,
      required: false,
      sensitive: false,
      description: undefined,
    });
  });

  it('should apply defaults for timeout and sensitive', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify({
      simple: {
        command: '/usr/local/bin/simple-mcp',
      },
    }));

    const result = loadExternalMCPs(configPath);

    expect(result.simple.timeout).toBe(30000);
    expect(result.simple.sensitive).toBe(false);
    expect(result.simple.required).toBe(false);
  });

  it('should mark sensitive MCPs correctly', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify({
      secrets: {
        command: 'secrets-mcp',
        sensitive: true,
      },
    }));

    const result = loadExternalMCPs(configPath);
    expect(result.secrets.sensitive).toBe(true);
  });

  it('should resolve ${ENV_VAR} patterns in env values', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify({
      neon: {
        command: 'neon-mcp',
        env: {
          API_KEY: '${TEST_NEON_KEY}',
          STATIC: 'no-substitution',
          MIXED: 'prefix-${TEST_NEON_KEY}-suffix',
        },
      },
    }));

    // Set the env var for the test
    const original = process.env.TEST_NEON_KEY;
    process.env.TEST_NEON_KEY = 'resolved-value';
    try {
      const result = loadExternalMCPs(configPath);
      expect(result.neon.env).toEqual({
        API_KEY: 'resolved-value',
        STATIC: 'no-substitution',
        MIXED: 'prefix-resolved-value-suffix',
      });
    } finally {
      if (original === undefined) {
        delete process.env.TEST_NEON_KEY;
      } else {
        process.env.TEST_NEON_KEY = original;
      }
    }
  });

  it('should resolve missing env vars to empty string', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify({
      test: {
        command: 'test-mcp',
        env: { KEY: '${DEFINITELY_DOES_NOT_EXIST_XYZ}' },
      },
    }));

    const result = loadExternalMCPs(configPath);
    expect(result.test.env?.KEY).toBe('');
  });

  it('should parse multiple external MCPs', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify({
      posthog: { command: 'posthog-mcp' },
      vercel: { command: 'vercel-mcp', timeout: 60000 },
      neon: { command: 'neon-mcp', sensitive: true },
    }));

    const result = loadExternalMCPs(configPath);
    expect(Object.keys(result)).toEqual(['posthog', 'vercel', 'neon']);
    expect(result.vercel.timeout).toBe(60000);
    expect(result.neon.sensitive).toBe(true);
  });

  it('should return empty record for invalid JSON', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, 'not valid json {{{');

    const result = loadExternalMCPs(configPath);
    expect(result).toEqual({});
  });

  it('should return empty record for invalid schema (missing command)', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify({
      bad: { args: ['--flag'] }, // missing required 'command'
    }));

    const result = loadExternalMCPs(configPath);
    expect(result).toEqual({});
  });

  it('should return empty record for invalid schema (bad timeout)', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify({
      bad: { command: 'mcp', timeout: -100 },
    }));

    const result = loadExternalMCPs(configPath);
    expect(result).toEqual({});
  });

  it('should pass through description field', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify({
      posthog: {
        command: 'posthog-mcp',
        description: 'Product analytics and feature flags',
      },
    }));

    const result = loadExternalMCPs(configPath);
    expect(result.posthog.description).toBe('Product analytics and feature flags');
  });

  it('should have undefined description when not provided', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify({
      simple: { command: 'simple-mcp' },
    }));

    const result = loadExternalMCPs(configPath);
    expect(result.simple.description).toBeUndefined();
  });
});
