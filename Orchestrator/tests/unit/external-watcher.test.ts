import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted mocks
const mockWatch = vi.hoisted(() => vi.fn());
const mockLoadExternalMCPs = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  watch: mockWatch,
}));

vi.mock('@mcp/shared/Discovery/external-loader.js', () => ({
  loadExternalMCPs: mockLoadExternalMCPs,
}));

vi.mock('@mcp/shared/Utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import { ExternalMCPWatcher } from '../../src/core/external-watcher.js';
import type { ExternalMCPEntry } from '@mcp/shared/Discovery/external-loader.js';

function makeEntry(overrides?: Partial<ExternalMCPEntry>): ExternalMCPEntry {
  return {
    command: 'node',
    args: ['dist/index.js'],
    timeout: 30000,
    required: false,
    sensitive: false,
    ...overrides,
  };
}

describe('ExternalMCPWatcher', () => {
  let watchCallback: (() => void) | null = null;
  let mockWatcher: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    watchCallback = null;

    mockWatcher = { close: vi.fn() };
    mockWatch.mockImplementation((_path: string, cb: () => void) => {
      watchCallback = cb;
      return mockWatcher;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start watching the config file', () => {
    const watcher = new ExternalMCPWatcher('/config.json', vi.fn(), {});
    watcher.start();

    expect(mockWatch).toHaveBeenCalledWith('/config.json', expect.any(Function));
  });

  it('should stop watching on stop()', () => {
    const watcher = new ExternalMCPWatcher('/config.json', vi.fn(), {});
    watcher.start();
    watcher.stop();

    expect(mockWatcher.close).toHaveBeenCalled();
  });

  it('should detect added MCPs', async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    const watcher = new ExternalMCPWatcher('/config.json', onChanged, {});
    watcher.start();

    const newEntry = makeEntry({ description: 'Analytics' });
    mockLoadExternalMCPs.mockReturnValue({ posthog: newEntry });

    // Trigger file change
    watchCallback!();
    await vi.advanceTimersByTimeAsync(500);

    expect(onChanged).toHaveBeenCalledTimes(1);
    const [added, removed] = onChanged.mock.calls[0];
    expect([...added.keys()]).toEqual(['posthog']);
    expect(added.get('posthog')).toEqual(newEntry);
    expect(removed).toEqual([]);
  });

  it('should detect removed MCPs', async () => {
    const initialEntry = makeEntry();
    const onChanged = vi.fn().mockResolvedValue(undefined);
    const watcher = new ExternalMCPWatcher('/config.json', onChanged, {
      posthog: initialEntry,
    });
    watcher.start();

    mockLoadExternalMCPs.mockReturnValue({});

    watchCallback!();
    await vi.advanceTimersByTimeAsync(500);

    expect(onChanged).toHaveBeenCalledTimes(1);
    const [added, removed] = onChanged.mock.calls[0];
    expect(added.size).toBe(0);
    expect(removed).toEqual(['posthog']);
  });

  it('should not fire callback when nothing changed', async () => {
    const initialEntry = makeEntry();
    const onChanged = vi.fn().mockResolvedValue(undefined);
    const watcher = new ExternalMCPWatcher('/config.json', onChanged, {
      posthog: initialEntry,
    });
    watcher.start();

    mockLoadExternalMCPs.mockReturnValue({ posthog: initialEntry });

    watchCallback!();
    await vi.advanceTimersByTimeAsync(500);

    expect(onChanged).not.toHaveBeenCalled();
  });

  it('should debounce rapid file changes', async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    const watcher = new ExternalMCPWatcher('/config.json', onChanged, {});
    watcher.start();

    mockLoadExternalMCPs.mockReturnValue({ posthog: makeEntry() });

    // Rapid successive changes
    watchCallback!();
    await vi.advanceTimersByTimeAsync(100);
    watchCallback!();
    await vi.advanceTimersByTimeAsync(100);
    watchCallback!();
    await vi.advanceTimersByTimeAsync(500);

    // Should only fire once
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('should detect both added and removed in one change', async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    const watcher = new ExternalMCPWatcher('/config.json', onChanged, {
      neon: makeEntry(),
    });
    watcher.start();

    mockLoadExternalMCPs.mockReturnValue({ vercel: makeEntry() });

    watchCallback!();
    await vi.advanceTimersByTimeAsync(500);

    const [added, removed] = onChanged.mock.calls[0];
    expect([...added.keys()]).toEqual(['vercel']);
    expect(removed).toEqual(['neon']);
  });

  it('should track state across multiple changes', async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    const watcher = new ExternalMCPWatcher('/config.json', onChanged, {});
    watcher.start();

    // First change: add posthog
    mockLoadExternalMCPs.mockReturnValue({ posthog: makeEntry() });
    watchCallback!();
    await vi.advanceTimersByTimeAsync(500);

    expect(onChanged).toHaveBeenCalledTimes(1);
    expect([...onChanged.mock.calls[0][0].keys()]).toEqual(['posthog']);

    // Second change: add vercel (posthog should not appear as added again)
    mockLoadExternalMCPs.mockReturnValue({ posthog: makeEntry(), vercel: makeEntry() });
    watchCallback!();
    await vi.advanceTimersByTimeAsync(500);

    expect(onChanged).toHaveBeenCalledTimes(2);
    expect([...onChanged.mock.calls[1][0].keys()]).toEqual(['vercel']);
    expect(onChanged.mock.calls[1][1]).toEqual([]);
  });
});
