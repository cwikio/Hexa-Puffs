import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CostMonitor } from '../src/cost/monitor.js';
import type { CostControlConfig } from '../src/cost/types.js';

function makeConfig(overrides: Partial<CostControlConfig> = {}): CostControlConfig {
  return {
    enabled: true,
    shortWindowMinutes: 2,
    spikeMultiplier: 3.0,
    hardCapTokensPerHour: 100_000,
    minimumBaselineTokens: 1000,
    minimumBaselineRate: 0, // disabled by default in tests to preserve existing test behavior
    ...overrides,
  };
}

describe('CostMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic recording', () => {
    it('records tokens without pausing under normal load', () => {
      const monitor = new CostMonitor(makeConfig());
      monitor.recordUsage(500, 200);
      expect(monitor.paused).toBe(false);
      expect(monitor.pauseReason).toBeNull();
    });

    it('does nothing when disabled', () => {
      const monitor = new CostMonitor(makeConfig({ enabled: false }));
      // Record more than the hard cap
      monitor.recordUsage(200_000, 200_000);
      expect(monitor.paused).toBe(false);
    });

    it('tracks tokens in status', () => {
      const monitor = new CostMonitor(makeConfig());
      monitor.recordUsage(1000, 500);
      const status = monitor.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.currentHourTokens).toBe(1500);
      expect(status.activeBuckets).toBe(1);
    });
  });

  describe('hard cap', () => {
    it('pauses when total tokens exceed hard cap', () => {
      const monitor = new CostMonitor(makeConfig({ hardCapTokensPerHour: 10_000 }));

      monitor.recordUsage(6000, 0);
      expect(monitor.paused).toBe(false);

      monitor.recordUsage(5000, 0);
      expect(monitor.paused).toBe(true);
      expect(monitor.pauseReason).toContain('Hard cap exceeded');
      expect(monitor.pauseReason).toContain('11,000');
    });

    it('triggers hard cap even during cold start (no baseline needed)', () => {
      const monitor = new CostMonitor(makeConfig({
        hardCapTokensPerHour: 5000,
        minimumBaselineTokens: 999_999, // unreachable baseline — only hard cap should trigger
      }));

      monitor.recordUsage(3000, 3000);
      expect(monitor.paused).toBe(true);
      expect(monitor.pauseReason).toContain('Hard cap exceeded');
    });
  });

  describe('spike detection', () => {
    it('does not trigger spike during cold start (baseline too low)', () => {
      const monitor = new CostMonitor(makeConfig({ minimumBaselineTokens: 5000 }));

      // Huge burst in minute 0, but no baseline yet
      monitor.recordUsage(10_000, 10_000);
      expect(monitor.paused).toBe(false); // Not paused by spike (baseline too low)
    });

    it('detects spike when recent rate exceeds baseline × multiplier', () => {
      const monitor = new CostMonitor(makeConfig({
        shortWindowMinutes: 2,
        spikeMultiplier: 3.0,
        minimumBaselineTokens: 500,
        hardCapTokensPerHour: 999_999, // won't trigger
      }));

      // Build a steady baseline: 100 tokens/min for 10 minutes
      for (let min = 0; min < 10; min++) {
        monitor.recordUsage(50, 50); // 100 tokens per minute
        vi.advanceTimersByTime(60_000);
      }

      expect(monitor.paused).toBe(false);

      // Now spike: 1000 tokens/min for 2 minutes (10x the 100/min baseline → exceeds 3x)
      monitor.recordUsage(500, 500);
      vi.advanceTimersByTime(60_000);
      monitor.recordUsage(500, 500);

      expect(monitor.paused).toBe(true);
      expect(monitor.pauseReason).toContain('Token spike detected');
    });

    it('does not trigger spike when recent rate is within multiplier', () => {
      const monitor = new CostMonitor(makeConfig({
        shortWindowMinutes: 2,
        spikeMultiplier: 3.0,
        minimumBaselineTokens: 500,
        hardCapTokensPerHour: 999_999,
      }));

      // Build baseline: 100 tokens/min for 10 minutes
      for (let min = 0; min < 10; min++) {
        monitor.recordUsage(50, 50);
        vi.advanceTimersByTime(60_000);
      }

      // Slight increase: 200 tokens/min (2x baseline, below 3x threshold)
      monitor.recordUsage(100, 100);
      vi.advanceTimersByTime(60_000);
      monitor.recordUsage(100, 100);

      expect(monitor.paused).toBe(false);
    });
  });

  describe('minimumBaselineRate floor', () => {
    it('prevents spike when short-window rate is below floor × multiplier', () => {
      const monitor = new CostMonitor(makeConfig({
        shortWindowMinutes: 2,
        spikeMultiplier: 3.0,
        minimumBaselineRate: 10_000, // floor: effective threshold = 30,000 tok/min
        minimumBaselineTokens: 500,
        hardCapTokensPerHour: 999_999,
      }));

      // Build a low baseline: 200 tokens/min for 10 minutes
      for (let min = 0; min < 10; min++) {
        monitor.recordUsage(100, 100);
        vi.advanceTimersByTime(60_000);
      }

      // Burst: 5,000 tokens/min (25x the 200/min baseline, but well below 30,000 floor threshold)
      monitor.recordUsage(2500, 2500);
      vi.advanceTimersByTime(60_000);
      monitor.recordUsage(2500, 2500);

      expect(monitor.paused).toBe(false);
    });

    it('triggers spike when short-window rate exceeds floor × multiplier', () => {
      const monitor = new CostMonitor(makeConfig({
        shortWindowMinutes: 2,
        spikeMultiplier: 3.0,
        minimumBaselineRate: 10_000, // floor: effective threshold = 30,000 tok/min
        minimumBaselineTokens: 500,
        hardCapTokensPerHour: 999_999,
      }));

      // Build a low baseline: 200 tokens/min for 10 minutes
      for (let min = 0; min < 10; min++) {
        monitor.recordUsage(100, 100);
        vi.advanceTimersByTime(60_000);
      }

      // Burst: 35,000 tokens/min — exceeds floor threshold of 30,000
      monitor.recordUsage(17500, 17500);
      vi.advanceTimersByTime(60_000);
      monitor.recordUsage(17500, 17500);

      expect(monitor.paused).toBe(true);
      expect(monitor.pauseReason).toContain('Token spike detected');
    });

    it('floor is irrelevant when actual baseline exceeds it', () => {
      const monitor = new CostMonitor(makeConfig({
        shortWindowMinutes: 2,
        spikeMultiplier: 3.0,
        minimumBaselineRate: 5_000, // floor is 5K, but baseline will be 10K
        minimumBaselineTokens: 500,
        hardCapTokensPerHour: 999_999,
      }));

      // Build a high baseline: 10,000 tokens/min for 10 minutes
      for (let min = 0; min < 10; min++) {
        monitor.recordUsage(5000, 5000);
        vi.advanceTimersByTime(60_000);
      }

      // Burst: 35,000 tokens/min (3.5x the 10K baseline → exceeds 3x, floor doesn't help)
      monitor.recordUsage(17500, 17500);
      vi.advanceTimersByTime(60_000);
      monitor.recordUsage(17500, 17500);

      expect(monitor.paused).toBe(true);
      expect(monitor.pauseReason).toContain('Token spike detected');
    });

    it('floor of 0 behaves like original code (no floor)', () => {
      const monitor = new CostMonitor(makeConfig({
        shortWindowMinutes: 2,
        spikeMultiplier: 3.0,
        minimumBaselineRate: 0,
        minimumBaselineTokens: 500,
        hardCapTokensPerHour: 999_999,
      }));

      // Build baseline: 100 tokens/min for 10 minutes
      for (let min = 0; min < 10; min++) {
        monitor.recordUsage(50, 50);
        vi.advanceTimersByTime(60_000);
      }

      // Burst: 1,000 tokens/min (10x baseline → exceeds 3x)
      monitor.recordUsage(500, 500);
      vi.advanceTimersByTime(60_000);
      monitor.recordUsage(500, 500);

      expect(monitor.paused).toBe(true);
    });
  });

  describe('resume', () => {
    it('clears pause state', () => {
      const monitor = new CostMonitor(makeConfig({ hardCapTokensPerHour: 100 }));
      monitor.recordUsage(200, 0);
      expect(monitor.paused).toBe(true);

      monitor.resume();
      expect(monitor.paused).toBe(false);
      expect(monitor.pauseReason).toBeNull();
    });

    it('resets window when requested', () => {
      const monitor = new CostMonitor(makeConfig({ hardCapTokensPerHour: 100 }));
      monitor.recordUsage(200, 0);
      expect(monitor.paused).toBe(true);

      monitor.resume(true);
      expect(monitor.paused).toBe(false);

      const status = monitor.getStatus();
      expect(status.currentHourTokens).toBe(0);
    });

    it('does not immediately re-trigger after resume without reset', () => {
      const monitor = new CostMonitor(makeConfig({ hardCapTokensPerHour: 1000 }));

      // Bring close to cap
      monitor.recordUsage(900, 0);
      expect(monitor.paused).toBe(false);

      // Push over
      monitor.recordUsage(200, 0);
      expect(monitor.paused).toBe(true);

      // Resume without reset
      monitor.resume(false);
      expect(monitor.paused).toBe(false);

      // Old data is still there, so even a small addition re-triggers
      monitor.recordUsage(1, 0);
      expect(monitor.paused).toBe(true);
    });

    it('resume with reset allows fresh start', () => {
      const monitor = new CostMonitor(makeConfig({ hardCapTokensPerHour: 1000 }));

      monitor.recordUsage(1100, 0);
      expect(monitor.paused).toBe(true);

      monitor.resume(true);

      // Now 0 tokens in the window — small usage is fine
      monitor.recordUsage(50, 0);
      expect(monitor.paused).toBe(false);
    });
  });

  describe('window advancement', () => {
    it('slides window forward when time advances', () => {
      const monitor = new CostMonitor(makeConfig({ hardCapTokensPerHour: 999_999 }));

      monitor.recordUsage(1000, 0);
      expect(monitor.getStatus().currentHourTokens).toBe(1000);

      // Advance 61 minutes — the original bucket should be evicted
      vi.advanceTimersByTime(61 * 60_000);
      expect(monitor.getStatus().currentHourTokens).toBe(0);
    });

    it('handles large time gaps gracefully', () => {
      const monitor = new CostMonitor(makeConfig());
      monitor.recordUsage(500, 500);

      // Jump forward 2 hours — entire window resets
      vi.advanceTimersByTime(2 * 60 * 60_000);

      const status = monitor.getStatus();
      expect(status.currentHourTokens).toBe(0);
      expect(status.activeBuckets).toBe(0);
    });
  });

  describe('getStatus', () => {
    it('returns complete status snapshot', () => {
      const config = makeConfig();
      const monitor = new CostMonitor(config);
      monitor.recordUsage(1000, 500);

      const status = monitor.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.paused).toBe(false);
      expect(status.pauseReason).toBeNull();
      expect(status.pausedAt).toBeNull();
      expect(status.currentHourTokens).toBe(1500);
      expect(status.hardCapTokensPerHour).toBe(100_000);
      expect(status.spikeMultiplier).toBe(3.0);
      expect(status.shortWindowMinutes).toBe(2);
    });

    it('includes pausedAt timestamp when paused', () => {
      const monitor = new CostMonitor(makeConfig({ hardCapTokensPerHour: 100 }));
      monitor.recordUsage(200, 0);

      const status = monitor.getStatus();
      expect(status.paused).toBe(true);
      expect(status.pausedAt).not.toBeNull();
      expect(status.pausedAt).toContain('2025-01-15');
    });
  });
});
