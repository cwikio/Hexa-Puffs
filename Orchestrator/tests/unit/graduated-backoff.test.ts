/**
 * Unit tests for graduated backoff logic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getBackoffMinutes,
  getConsecutiveFailures,
  recordFailure,
  recordSuccess,
  _resetFailureCounts,
  MAX_CONSECUTIVE_FAILURES,
} from '../../src/utils/skill-normalizer.js';

describe('Graduated Backoff', () => {
  beforeEach(() => {
    _resetFailureCounts();
  });

  it('should return 1 min backoff before any failures', () => {
    // No failures recorded yet → backoff based on 0 failures = BACKOFF_MINUTES[0] = 1
    expect(getBackoffMinutes(100)).toBe(1);
  });

  it('should return 1 min backoff after first failure', () => {
    recordFailure(100);
    // 1 failure → BACKOFF_MINUTES[1] = 5
    expect(getBackoffMinutes(100)).toBe(5);
  });

  it('should escalate backoff with consecutive failures', () => {
    recordFailure(100); // count=1 → next backoff=5
    recordFailure(100); // count=2 → next backoff=15
    expect(getBackoffMinutes(100)).toBe(15);
  });

  it('should cap backoff at 60 minutes', () => {
    recordFailure(100); // 1
    recordFailure(100); // 2
    recordFailure(100); // 3
    expect(getBackoffMinutes(100)).toBe(60);

    recordFailure(100); // 4
    expect(getBackoffMinutes(100)).toBe(60); // still capped
  });

  it('should reset counter on success', () => {
    recordFailure(100);
    recordFailure(100);
    expect(getConsecutiveFailures(100)).toBe(2);

    recordSuccess(100);
    expect(getConsecutiveFailures(100)).toBe(0);
    expect(getBackoffMinutes(100)).toBe(1);
  });

  it('should signal auto-disable after MAX_CONSECUTIVE_FAILURES', () => {
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES - 1; i++) {
      const result = recordFailure(100);
      expect(result.shouldDisable).toBe(false);
    }

    const result = recordFailure(100);
    expect(result.shouldDisable).toBe(true);
    expect(result.count).toBe(MAX_CONSECUTIVE_FAILURES);
  });

  it('should track skills independently', () => {
    recordFailure(100);
    recordFailure(100);
    recordFailure(200);

    expect(getConsecutiveFailures(100)).toBe(2);
    expect(getConsecutiveFailures(200)).toBe(1);

    recordSuccess(100);
    expect(getConsecutiveFailures(100)).toBe(0);
    expect(getConsecutiveFailures(200)).toBe(1);
  });

  it('should return 0 consecutive failures for unknown skill', () => {
    expect(getConsecutiveFailures(999)).toBe(0);
  });

  it('should report correct failure count in recordFailure result', () => {
    expect(recordFailure(100).count).toBe(1);
    expect(recordFailure(100).count).toBe(2);
    expect(recordFailure(100).count).toBe(3);
    expect(recordFailure(100).count).toBe(4);
    expect(recordFailure(100).count).toBe(5);
  });
});
