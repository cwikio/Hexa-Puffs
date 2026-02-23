import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@mcp/shared/Utils/logger.js', () => ({
  Logger: class { info = vi.fn(); warn = vi.fn(); error = vi.fn(); debug = vi.fn(); },
}));

import { CircuitBreaker } from '../../src/agent/circuit-breaker.js';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('starts in closed state', () => {
      const cb = new CircuitBreaker();
      expect(cb.getState().state).toBe('closed');
      expect(cb.getState().consecutiveErrors).toBe(0);
      expect(cb.getState().trippedAt).toBeNull();
    });

    it('allows processing when closed', () => {
      const cb = new CircuitBreaker();
      expect(cb.canProcess()).toBe(true);
    });
  });

  describe('recordFailure', () => {
    it('increments consecutive errors', () => {
      const cb = new CircuitBreaker(5);
      cb.recordFailure();
      expect(cb.getState().consecutiveErrors).toBe(1);
      expect(cb.getState().state).toBe('closed');
    });

    it('trips to open after reaching maxErrors', () => {
      const cb = new CircuitBreaker(3);
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState().state).toBe('open');
      expect(cb.getState().trippedAt).not.toBeNull();
    });

    it('does not trip before reaching maxErrors', () => {
      const cb = new CircuitBreaker(3);
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState().state).toBe('closed');
    });

    it('blocks processing when open', () => {
      const cb = new CircuitBreaker(2);
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.canProcess()).toBe(false);
    });
  });

  describe('recordSuccess', () => {
    it('resets consecutive errors', () => {
      const cb = new CircuitBreaker(5);
      cb.recordFailure();
      cb.recordFailure();
      cb.recordSuccess();
      expect(cb.getState().consecutiveErrors).toBe(0);
      expect(cb.getState().state).toBe('closed');
    });

    it('clears trippedAt', () => {
      const cb = new CircuitBreaker(5);
      cb.recordFailure();
      cb.recordSuccess();
      expect(cb.getState().trippedAt).toBeNull();
    });
  });

  describe('half-open transition', () => {
    it('transitions from open to half-open after cooldown', () => {
      const cb = new CircuitBreaker(2, 5_000);
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.canProcess()).toBe(false);

      // Advance time past cooldown
      vi.advanceTimersByTime(5_001);
      expect(cb.canProcess()).toBe(true);
      expect(cb.getState().state).toBe('half-open');
    });

    it('stays open before cooldown expires', () => {
      const cb = new CircuitBreaker(2, 10_000);
      cb.recordFailure();
      cb.recordFailure();

      vi.advanceTimersByTime(5_000);
      expect(cb.canProcess()).toBe(false);
      expect(cb.getState().state).toBe('open');
    });

    it('closes on success in half-open state', () => {
      const cb = new CircuitBreaker(2, 5_000);
      cb.recordFailure();
      cb.recordFailure();

      vi.advanceTimersByTime(5_001);
      cb.canProcess(); // triggers transition to half-open

      cb.recordSuccess();
      expect(cb.getState().state).toBe('closed');
      expect(cb.getState().consecutiveErrors).toBe(0);
      expect(cb.getState().trippedAt).toBeNull();
    });

    it('re-opens on failure in half-open state', () => {
      const cb = new CircuitBreaker(2, 5_000);
      cb.recordFailure();
      cb.recordFailure();

      vi.advanceTimersByTime(5_001);
      cb.canProcess(); // triggers transition to half-open

      cb.recordFailure();
      expect(cb.getState().state).toBe('open');
      expect(cb.getState().trippedAt).not.toBeNull();
    });

    it('resets cooldown timer on re-open from half-open', () => {
      const cb = new CircuitBreaker(2, 5_000);
      cb.recordFailure();
      cb.recordFailure();

      // First cooldown
      vi.advanceTimersByTime(5_001);
      cb.canProcess(); // half-open
      cb.recordFailure(); // re-open

      // Should need another full cooldown
      vi.advanceTimersByTime(4_000);
      expect(cb.canProcess()).toBe(false);

      vi.advanceTimersByTime(1_001);
      expect(cb.canProcess()).toBe(true);
      expect(cb.getState().state).toBe('half-open');
    });
  });

  describe('full lifecycle', () => {
    it('closed → open → half-open → closed', () => {
      const cb = new CircuitBreaker(2, 1_000);

      // closed
      expect(cb.getState().state).toBe('closed');
      cb.recordFailure();
      cb.recordFailure();

      // open
      expect(cb.getState().state).toBe('open');
      expect(cb.canProcess()).toBe(false);

      // half-open after cooldown
      vi.advanceTimersByTime(1_001);
      expect(cb.canProcess()).toBe(true);
      expect(cb.getState().state).toBe('half-open');

      // closed on success
      cb.recordSuccess();
      expect(cb.getState().state).toBe('closed');
      expect(cb.canProcess()).toBe(true);
    });

    it('closed → open → half-open → open → half-open → closed', () => {
      const cb = new CircuitBreaker(2, 1_000);

      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState().state).toBe('open');

      vi.advanceTimersByTime(1_001);
      cb.canProcess(); // half-open
      cb.recordFailure(); // re-open

      vi.advanceTimersByTime(1_001);
      cb.canProcess(); // half-open again
      cb.recordSuccess(); // finally close
      expect(cb.getState().state).toBe('closed');
    });
  });

  describe('constructor defaults', () => {
    it('defaults to maxErrors=5', () => {
      const cb = new CircuitBreaker();
      for (let i = 0; i < 4; i++) cb.recordFailure();
      expect(cb.getState().state).toBe('closed');
      cb.recordFailure();
      expect(cb.getState().state).toBe('open');
    });

    it('defaults to cooldownMs=60000', () => {
      const cb = new CircuitBreaker(1);
      cb.recordFailure();

      vi.advanceTimersByTime(59_999);
      expect(cb.canProcess()).toBe(false);

      vi.advanceTimersByTime(2);
      expect(cb.canProcess()).toBe(true);
    });
  });
});
