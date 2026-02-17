/**
 * Unit tests for Browser MCP proxy configuration logic.
 * Tests resolveProxy() and buildConfig() in isolation — no browser or MCP server needed.
 */

import { describe, it, expect } from 'vitest';
import { resolveProxy, buildConfig } from '../../src/config.js';

describe('resolveProxy', () => {
  it('returns proxy disabled when no env vars are set', () => {
    const result = resolveProxy({});

    expect(result.useProxy).toBe(false);
    expect(result.warning).toBeUndefined();
  });

  it('returns proxy disabled when only BROWSER_PROXY_SERVER is set', () => {
    const result = resolveProxy({
      BROWSER_PROXY_SERVER: 'http://proxy.example.com:80',
    });

    expect(result.useProxy).toBe(false);
    expect(result.warning).toBeUndefined();
  });

  it('returns proxy disabled with warning when enabled but no server', () => {
    const result = resolveProxy({
      BROWSER_PROXY_ENABLED: 'true',
    });

    expect(result.useProxy).toBe(false);
    expect(result.warning).toContain('BROWSER_PROXY_SERVER is not set');
  });

  it('returns proxy enabled when both toggle and server are set', () => {
    const result = resolveProxy({
      BROWSER_PROXY_ENABLED: 'true',
      BROWSER_PROXY_SERVER: 'http://proxy.example.com:80',
    });

    expect(result.useProxy).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it('returns proxy disabled when BROWSER_PROXY_ENABLED is not "true"', () => {
    const result = resolveProxy({
      BROWSER_PROXY_ENABLED: 'false',
      BROWSER_PROXY_SERVER: 'http://proxy.example.com:80',
    });

    expect(result.useProxy).toBe(false);
  });

  it('returns proxy disabled when BROWSER_PROXY_ENABLED is empty string', () => {
    const result = resolveProxy({
      BROWSER_PROXY_ENABLED: '',
      BROWSER_PROXY_SERVER: 'http://proxy.example.com:80',
    });

    expect(result.useProxy).toBe(false);
  });
});

describe('buildConfig', () => {
  it('returns headless config with no proxy when disabled', () => {
    const config = buildConfig({});

    expect(config.browser?.launchOptions?.headless).toBe(true);
    expect(config.browser?.launchOptions?.proxy).toBeUndefined();
  });

  it('includes proxy config when enabled', () => {
    const config = buildConfig({
      BROWSER_PROXY_ENABLED: 'true',
      BROWSER_PROXY_SERVER: 'http://p.webshare.io:80',
      BROWSER_PROXY_USERNAME: 'user123',
      BROWSER_PROXY_PASSWORD: 'pass456',
    });

    expect(config.browser?.launchOptions?.proxy).toEqual({
      server: 'http://p.webshare.io:80',
      username: 'user123',
      password: 'pass456',
      bypass: 'localhost,127.0.0.1',
    });
  });

  it('uses default bypass when not specified', () => {
    const config = buildConfig({
      BROWSER_PROXY_ENABLED: 'true',
      BROWSER_PROXY_SERVER: 'http://proxy:80',
    });

    expect(config.browser?.launchOptions?.proxy?.bypass).toBe('localhost,127.0.0.1');
  });

  it('uses custom bypass when specified', () => {
    const config = buildConfig({
      BROWSER_PROXY_ENABLED: 'true',
      BROWSER_PROXY_SERVER: 'http://proxy:80',
      BROWSER_PROXY_BYPASS: 'localhost,*.internal.com',
    });

    expect(config.browser?.launchOptions?.proxy?.bypass).toBe('localhost,*.internal.com');
  });

  it('omits proxy entirely when toggle is off even with credentials', () => {
    const config = buildConfig({
      BROWSER_PROXY_ENABLED: 'false',
      BROWSER_PROXY_SERVER: 'http://proxy:80',
      BROWSER_PROXY_USERNAME: 'stale-user',
      BROWSER_PROXY_PASSWORD: 'stale-pass',
    });

    expect(config.browser?.launchOptions?.proxy).toBeUndefined();
  });

  it('defaults to isolated mode (fresh profile per session)', () => {
    const config = buildConfig({});

    expect(config.browser?.isolated).toBe(true);
  });

  it('can disable isolated mode with BROWSER_ISOLATED=false', () => {
    const config = buildConfig({ BROWSER_ISOLATED: 'false' });

    expect(config.browser?.isolated).toBe(false);
  });
});
