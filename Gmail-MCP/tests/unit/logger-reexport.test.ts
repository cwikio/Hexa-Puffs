/**
 * Verify Gmail-MCP's logger module correctly re-exports from @mcp/shared.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Do NOT use the global mock from setup.ts — import the real module
vi.unmock('../../src/utils/logger.js');

describe('Gmail Logger re-export', () => {
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it('should export Logger class from @mcp/shared', async () => {
    const mod = await import('../../src/utils/logger.js');
    expect(mod.Logger).toBeDefined();
    expect(typeof mod.Logger).toBe('function');
  });

  it('should export a default logger instance with "gmail" context', async () => {
    const mod = await import('../../src/utils/logger.js');
    expect(mod.logger).toBeDefined();
    mod.logger.info('test message');

    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain('[gmail]');
    expect(output).toContain('test message');
  });

  it('should support child loggers', async () => {
    const mod = await import('../../src/utils/logger.js');
    const child = mod.logger.child('auth');
    child.info('auth event');

    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain('[gmail:auth]');
  });
});
