import { describe, it, expect } from 'vitest';

/**
 * Extracted scheduling logic from skillSchedulerFunction for unit testing.
 * Tests the three scheduling modes: cron, interval, and one-shot (at).
 */

interface TriggerConfig {
  schedule?: string;
  timezone?: string;
  interval_minutes?: number;
  at?: string;
}

interface ScheduleResult {
  isDue: boolean;
  isOneShot: boolean;
}

/**
 * Pure-function extraction of the skill scheduler's isDue logic.
 * Mirrors the logic in skillSchedulerFunction (functions.ts lines 567-617).
 */
function checkSchedule(
  triggerConfig: TriggerConfig | null,
  lastRunAt: string | null,
  now: Date,
): ScheduleResult {
  if (!triggerConfig) {
    return { isDue: false, isOneShot: false };
  }

  // One-shot mode
  if (triggerConfig.at) {
    const atTime = new Date(triggerConfig.at);
    if (isNaN(atTime.getTime())) {
      return { isDue: false, isOneShot: true };
    }
    if (now >= atTime) {
      // Prevent double execution — only skip if last run was AFTER the scheduled `at` time
      // (allows re-firing when `at` is updated to a new future time)
      if (lastRunAt) {
        const lastRun = new Date(lastRunAt).getTime();
        if (lastRun >= atTime.getTime()) {
          return { isDue: false, isOneShot: true };
        }
      }
      return { isDue: true, isOneShot: true };
    }
    return { isDue: false, isOneShot: true };
  }

  // Interval mode (when no schedule or at)
  if (!triggerConfig.schedule) {
    const intervalMinutes = triggerConfig.interval_minutes || 1440;
    const lastRunTime = lastRunAt ? new Date(lastRunAt).getTime() : 0;
    const minutesSinceLastRun = (now.getTime() - lastRunTime) / 60000;
    return { isDue: minutesSinceLastRun >= intervalMinutes, isOneShot: false };
  }

  // Cron mode — not tested here (uses croner library, tested in cron-validation.test.ts)
  return { isDue: false, isOneShot: false };
}

describe('One-shot (at) schedule', () => {
  it('should be due when current time is past the scheduled at time', () => {
    const result = checkSchedule(
      { at: '2026-02-13T10:00:00' },
      null,
      new Date('2026-02-13T10:05:00'),
    );
    expect(result.isDue).toBe(true);
    expect(result.isOneShot).toBe(true);
  });

  it('should be due when current time exactly equals the at time', () => {
    const result = checkSchedule(
      { at: '2026-02-13T10:00:00' },
      null,
      new Date('2026-02-13T10:00:00'),
    );
    expect(result.isDue).toBe(true);
    expect(result.isOneShot).toBe(true);
  });

  it('should NOT be due when current time is before the at time', () => {
    const result = checkSchedule(
      { at: '2026-02-13T15:00:00' },
      null,
      new Date('2026-02-13T10:00:00'),
    );
    expect(result.isDue).toBe(false);
    expect(result.isOneShot).toBe(true);
  });

  it('should NOT be due when already run AFTER the at time (prevents double execution)', () => {
    const result = checkSchedule(
      { at: '2026-02-13T10:00:00' },
      '2026-02-13T10:01:00', // ran after the at time
      new Date('2026-02-13T10:05:00'),
    );
    expect(result.isDue).toBe(false);
    expect(result.isOneShot).toBe(true);
  });

  it('should be due when at is updated to a new future time after a previous run', () => {
    // Scenario: skill originally had at=10:00, ran at 10:01. User updates at to 11:00.
    // At 11:05, the skill should fire again because the new at (11:00) > last_run_at (10:01).
    const result = checkSchedule(
      { at: '2026-02-13T11:00:00' }, // updated to new future time
      '2026-02-13T10:01:00',          // previous run from old at
      new Date('2026-02-13T11:05:00'),
    );
    expect(result.isDue).toBe(true);
    expect(result.isOneShot).toBe(true);
  });

  it('should NOT be due for invalid date in at field', () => {
    const result = checkSchedule(
      { at: 'not-a-date' },
      null,
      new Date('2026-02-13T10:00:00'),
    );
    expect(result.isDue).toBe(false);
    expect(result.isOneShot).toBe(true);
  });
});

describe('Interval schedule', () => {
  it('should be due when enough time has passed since last run', () => {
    const result = checkSchedule(
      { interval_minutes: 60 },
      '2026-02-13T09:00:00',
      new Date('2026-02-13T10:05:00'), // 65 minutes later
    );
    expect(result.isDue).toBe(true);
    expect(result.isOneShot).toBe(false);
  });

  it('should NOT be due when interval has not elapsed', () => {
    const result = checkSchedule(
      { interval_minutes: 60 },
      '2026-02-13T09:30:00',
      new Date('2026-02-13T10:00:00'), // only 30 minutes
    );
    expect(result.isDue).toBe(false);
    expect(result.isOneShot).toBe(false);
  });

  it('should default to 1440 minutes (daily) when interval_minutes is not set', () => {
    const result = checkSchedule(
      {}, // no interval_minutes, no schedule, no at
      '2026-02-12T10:00:00',
      new Date('2026-02-13T10:01:00'), // just over 24 hours later
    );
    expect(result.isDue).toBe(true);
    expect(result.isOneShot).toBe(false);
  });

  it('should be due when never run before (lastRunAt = null)', () => {
    const result = checkSchedule(
      { interval_minutes: 30 },
      null,
      new Date('2026-02-13T10:00:00'),
    );
    expect(result.isDue).toBe(true);
    expect(result.isOneShot).toBe(false);
  });
});

describe('No trigger config', () => {
  it('should not be due when trigger config is null', () => {
    const result = checkSchedule(null, null, new Date());
    expect(result.isDue).toBe(false);
    expect(result.isOneShot).toBe(false);
  });
});
