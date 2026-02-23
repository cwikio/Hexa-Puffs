import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

describe('config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset module registry so getConfig singleton is fresh
    vi.resetModules();
    // Restore env
    process.env = { ...originalEnv };
  });

  it('loadConfig throws when BRAVE_API_KEY is missing', async () => {
    delete process.env.BRAVE_API_KEY;
    const { loadConfig } = await import('../../src/utils/config.js');
    expect(() => loadConfig()).toThrow('BRAVE_API_KEY');
  });

  it('loadConfig returns config with valid BRAVE_API_KEY', async () => {
    process.env.BRAVE_API_KEY = 'test-key-123';
    const { loadConfig } = await import('../../src/utils/config.js');
    const config = loadConfig();
    expect(config.braveApiKey).toBe('test-key-123');
  });

  it('loadConfig uses default 1100 for braveRateLimitMs', async () => {
    process.env.BRAVE_API_KEY = 'test-key';
    delete process.env.BRAVE_RATE_LIMIT_MS;
    const { loadConfig } = await import('../../src/utils/config.js');
    const config = loadConfig();
    expect(config.braveRateLimitMs).toBe(1100);
  });

  it('loadConfig uses default 8007 for port', async () => {
    process.env.BRAVE_API_KEY = 'test-key';
    delete process.env.PORT;
    const { loadConfig } = await import('../../src/utils/config.js');
    const config = loadConfig();
    expect(config.port).toBe(8007);
  });

  it('loadConfig uses default "stdio" for transport', async () => {
    process.env.BRAVE_API_KEY = 'test-key';
    delete process.env.TRANSPORT;
    const { loadConfig } = await import('../../src/utils/config.js');
    const config = loadConfig();
    expect(config.transport).toBe('stdio');
  });

  it('loadConfig parses custom BRAVE_RATE_LIMIT_MS', async () => {
    process.env.BRAVE_API_KEY = 'test-key';
    process.env.BRAVE_RATE_LIMIT_MS = '2000';
    const { loadConfig } = await import('../../src/utils/config.js');
    const config = loadConfig();
    expect(config.braveRateLimitMs).toBe(2000);
  });

  it('getConfig returns singleton', async () => {
    process.env.BRAVE_API_KEY = 'test-key';
    const { getConfig } = await import('../../src/utils/config.js');
    const a = getConfig();
    const b = getConfig();
    expect(a).toBe(b);
  });
});
