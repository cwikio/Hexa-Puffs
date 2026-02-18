/**
 * Tests for external MCP config loader.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

  // ── File-level tests ──────────────────────────────────────────────

  it('should return empty result when file does not exist', () => {
    const result = loadExternalMCPs(join(tempDir, 'nonexistent.json'));
    expect(result.entries).toEqual({});
    expect(result.errors).toEqual([]);
    expect(result.fileError).toBeUndefined();
  });

  it('should return empty entries for empty JSON object', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, '{}');

    const result = loadExternalMCPs(configPath);
    expect(result.entries).toEqual({});
    expect(result.errors).toEqual([]);
  });

  it('should set fileError for invalid JSON', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, 'not valid json {{{');

    const result = loadExternalMCPs(configPath);
    expect(result.entries).toEqual({});
    expect(result.fileError).toBeDefined();
  });

  it('should set fileError for non-object root', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify([1, 2, 3]));

    const result = loadExternalMCPs(configPath);
    expect(result.entries).toEqual({});
    expect(result.fileError).toBe('Root must be a JSON object');
  });

  // ── Stdio entry tests ─────────────────────────────────────────────

  it('should parse a valid stdio external MCP config', () => {
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
    expect(result.entries).toHaveProperty('posthog');
    expect(result.entries.posthog).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@anthropic/posthog-mcp'],
      env: { POSTHOG_API_KEY: 'test-key' },
      timeout: 15000,
      required: false,
      sensitive: false,
      description: undefined,
    });
    expect(result.errors).toEqual([]);
  });

  it('should default type to stdio when not specified', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify({
      simple: { command: '/usr/local/bin/simple-mcp' },
    }));

    const result = loadExternalMCPs(configPath);
    expect(result.entries.simple.type).toBe('stdio');
  });

  it('should apply defaults for timeout and sensitive', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify({
      simple: { command: '/usr/local/bin/simple-mcp' },
    }));

    const result = loadExternalMCPs(configPath);
    expect(result.entries.simple.timeout).toBe(30000);
    expect(result.entries.simple.sensitive).toBe(false);
    expect(result.entries.simple.required).toBe(false);
  });

  it('should mark sensitive MCPs correctly', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify({
      secrets: { command: 'secrets-mcp', sensitive: true },
    }));

    const result = loadExternalMCPs(configPath);
    expect(result.entries.secrets.sensitive).toBe(true);
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

    const original = process.env.TEST_NEON_KEY;
    process.env.TEST_NEON_KEY = 'resolved-value';
    try {
      const result = loadExternalMCPs(configPath);
      const entry = result.entries.neon;
      expect(entry.type).toBe('stdio');
      if (entry.type === 'stdio') {
        expect(entry.env).toEqual({
          API_KEY: 'resolved-value',
          STATIC: 'no-substitution',
          MIXED: 'prefix-resolved-value-suffix',
        });
      }
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
    const entry = result.entries.test;
    if (entry.type === 'stdio') {
      expect(entry.env?.KEY).toBe('');
    }
  });

  it('should parse multiple stdio external MCPs', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify({
      posthog: { command: 'posthog-mcp' },
      vercel: { command: 'vercel-mcp', timeout: 60000 },
      neon: { command: 'neon-mcp', sensitive: true },
    }));

    const result = loadExternalMCPs(configPath);
    expect(Object.keys(result.entries)).toEqual(['posthog', 'vercel', 'neon']);
    expect(result.entries.vercel.timeout).toBe(60000);
    expect(result.entries.neon.sensitive).toBe(true);
    expect(result.errors).toEqual([]);
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
    expect(result.entries.posthog.description).toBe('Product analytics and feature flags');
  });

  it('should have undefined description when not provided', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify({
      simple: { command: 'simple-mcp' },
    }));

    const result = loadExternalMCPs(configPath);
    expect(result.entries.simple.description).toBeUndefined();
  });

  // ── HTTP entry tests ──────────────────────────────────────────────

  it('should parse a valid HTTP external MCP config', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify({
      github: {
        type: 'http',
        url: 'https://api.githubcopilot.com/mcp/',
        description: 'GitHub API',
      },
    }));

    const result = loadExternalMCPs(configPath);
    expect(result.entries.github).toEqual({
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      timeout: 30000,
      required: false,
      sensitive: false,
      description: 'GitHub API',
    });
    expect(result.errors).toEqual([]);
  });

  it('should parse HTTP config with headers', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify({
      github: {
        type: 'http',
        url: 'https://api.githubcopilot.com/mcp/',
        headers: { 'Authorization': 'Bearer test-token' },
      },
    }));

    const result = loadExternalMCPs(configPath);
    const entry = result.entries.github;
    expect(entry.type).toBe('http');
    if (entry.type === 'http') {
      expect(entry.headers).toEqual({ 'Authorization': 'Bearer test-token' });
    }
  });

  it('should resolve ${ENV_VAR} in HTTP headers', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify({
      github: {
        type: 'http',
        url: 'https://api.githubcopilot.com/mcp/',
        headers: { 'Authorization': 'Bearer ${TEST_GH_TOKEN}' },
      },
    }));

    const original = process.env.TEST_GH_TOKEN;
    process.env.TEST_GH_TOKEN = 'ghp_secret123';
    try {
      const result = loadExternalMCPs(configPath);
      const entry = result.entries.github;
      if (entry.type === 'http') {
        expect(entry.headers?.['Authorization']).toBe('Bearer ghp_secret123');
      }
    } finally {
      if (original === undefined) {
        delete process.env.TEST_GH_TOKEN;
      } else {
        process.env.TEST_GH_TOKEN = original;
      }
    }
  });

  it('should resolve ${ENV_VAR} in HTTP URL', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify({
      custom: {
        type: 'http',
        url: 'https://${TEST_MCP_HOST}/mcp/',
      },
    }));

    const original = process.env.TEST_MCP_HOST;
    process.env.TEST_MCP_HOST = 'mcp.example.com';
    try {
      const result = loadExternalMCPs(configPath);
      const entry = result.entries.custom;
      if (entry.type === 'http') {
        expect(entry.url).toBe('https://mcp.example.com/mcp/');
      }
    } finally {
      if (original === undefined) {
        delete process.env.TEST_MCP_HOST;
      } else {
        process.env.TEST_MCP_HOST = original;
      }
    }
  });

  it('should reject HTTP config without url', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify({
      bad: { type: 'http' },
    }));

    const result = loadExternalMCPs(configPath);
    expect(result.entries).toEqual({});
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].name).toBe('bad');
  });

  // ── Mixed entry tests ─────────────────────────────────────────────

  it('should handle mixed stdio and HTTP entries', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify({
      vercel: { command: 'npx', args: ['-y', 'vercel-mcp'] },
      github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' },
    }));

    const result = loadExternalMCPs(configPath);
    expect(Object.keys(result.entries)).toEqual(['vercel', 'github']);
    expect(result.entries.vercel.type).toBe('stdio');
    expect(result.entries.github.type).toBe('http');
    expect(result.errors).toEqual([]);
  });

  // ── Per-entry validation tests ────────────────────────────────────

  it('should skip invalid entry and load valid ones', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify({
      good: { command: 'good-mcp' },
      bad: { args: ['--flag'] }, // missing command, defaults to stdio
    }));

    const result = loadExternalMCPs(configPath);
    expect(Object.keys(result.entries)).toEqual(['good']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].name).toBe('bad');
  });

  it('should report error for invalid timeout but load valid entries', () => {
    const configPath = join(tempDir, 'external-mcps.json');
    writeFileSync(configPath, JSON.stringify({
      good: { command: 'good-mcp' },
      bad: { command: 'mcp', timeout: -100 },
    }));

    const result = loadExternalMCPs(configPath);
    expect(Object.keys(result.entries)).toEqual(['good']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].name).toBe('bad');
  });
});
