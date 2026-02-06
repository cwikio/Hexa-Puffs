/**
 * Unit tests for cron expression and timezone validation,
 * and the cron poller "is due" logic.
 */

import { describe, it, expect } from 'vitest'
import { Cron } from 'croner'
import { z } from 'zod'

function isValidCronExpression(expression: string): boolean {
  try {
    new Cron(expression)
    return true
  } catch {
    return false
  }
}

function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * Checks if a cron expression is due within a given minute.
 * This mirrors the logic in cronJobPollerFunction.
 *
 * Strategy: compute nextRun from the start of the previous minute.
 * If that falls within the current minute, the job is due.
 */
function isCronDueAt(
  cronExpression: string,
  timezone: string,
  now: Date,
  lastRunAt: string | undefined
): boolean {
  const cron = new Cron(cronExpression, { timezone })
  const minuteStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    0,
    0
  )
  const prevMinuteStart = new Date(minuteStart.getTime() - 60000)
  const nextFromPrev = cron.nextRun(prevMinuteStart)

  if (!nextFromPrev) return false

  let isDue =
    nextFromPrev >= minuteStart &&
    nextFromPrev < new Date(minuteStart.getTime() + 60000)

  if (isDue && lastRunAt) {
    const lastRun = new Date(lastRunAt).getTime()
    if (lastRun >= minuteStart.getTime()) {
      isDue = false
    }
  }

  return isDue
}

describe('Cron Expression Validation', () => {
  it('should accept valid cron expressions', () => {
    expect(isValidCronExpression('* * * * *')).toBe(true)
    expect(isValidCronExpression('0 9 * * *')).toBe(true)
    expect(isValidCronExpression('*/5 * * * *')).toBe(true)
    expect(isValidCronExpression('0 0 * * 1')).toBe(true)
    expect(isValidCronExpression('0 */2 * * *')).toBe(true)
    expect(isValidCronExpression('30 8 1 * *')).toBe(true)
    expect(isValidCronExpression('0 9,18 * * 1-5')).toBe(true)
  })

  it('should reject invalid cron expressions', () => {
    expect(isValidCronExpression('not-a-cron')).toBe(false)
    expect(isValidCronExpression('')).toBe(false)
    expect(isValidCronExpression('60 * * * *')).toBe(false)
    expect(isValidCronExpression('* 25 * * *')).toBe(false)
    expect(isValidCronExpression('* * 32 * *')).toBe(false)
  })
})

describe('Timezone Validation', () => {
  it('should accept valid timezones', () => {
    expect(isValidTimezone('UTC')).toBe(true)
    expect(isValidTimezone('America/New_York')).toBe(true)
    expect(isValidTimezone('Europe/Warsaw')).toBe(true)
    expect(isValidTimezone('Asia/Tokyo')).toBe(true)
    expect(isValidTimezone('Pacific/Auckland')).toBe(true)
  })

  it('should reject invalid timezones', () => {
    expect(isValidTimezone('Mars/Olympus_Mons')).toBe(false)
    expect(isValidTimezone('Invalid/Zone')).toBe(false)
    expect(isValidTimezone('NotATimezone')).toBe(false)
  })
})

describe('Cron Due Check Logic', () => {
  it('should detect "every minute" cron as due', () => {
    const now = new Date('2026-02-05T10:30:15Z')
    expect(isCronDueAt('* * * * *', 'UTC', now, undefined)).toBe(true)
  })

  it('should detect "daily at 9am" as due at 9:00', () => {
    const now = new Date('2026-02-05T09:00:30Z')
    expect(isCronDueAt('0 9 * * *', 'UTC', now, undefined)).toBe(true)
  })

  it('should not detect "daily at 9am" as due at 10:00', () => {
    const now = new Date('2026-02-05T10:00:30Z')
    expect(isCronDueAt('0 9 * * *', 'UTC', now, undefined)).toBe(false)
  })

  it('should not run if already run this minute', () => {
    const now = new Date('2026-02-05T10:30:15Z')
    const lastRunAt = new Date('2026-02-05T10:30:02Z').toISOString()
    expect(isCronDueAt('* * * * *', 'UTC', now, lastRunAt)).toBe(false)
  })

  it('should run if last run was in a previous minute', () => {
    const now = new Date('2026-02-05T10:31:15Z')
    const lastRunAt = new Date('2026-02-05T10:30:02Z').toISOString()
    expect(isCronDueAt('* * * * *', 'UTC', now, lastRunAt)).toBe(true)
  })

  it('should detect "every 5 minutes" at :05', () => {
    const now = new Date('2026-02-05T10:05:30Z')
    expect(isCronDueAt('*/5 * * * *', 'UTC', now, undefined)).toBe(true)
  })

  it('should not detect "every 5 minutes" at :03', () => {
    const now = new Date('2026-02-05T10:03:30Z')
    expect(isCronDueAt('*/5 * * * *', 'UTC', now, undefined)).toBe(false)
  })

  it('should handle timezone-aware scheduling', () => {
    // 8am Warsaw (CET = UTC+1 in winter) = 7am UTC
    const now = new Date('2026-02-05T07:00:30Z')
    expect(isCronDueAt('0 8 * * *', 'Europe/Warsaw', now, undefined)).toBe(true)
  })

  it('should not trigger timezone job at wrong UTC hour', () => {
    // 8am UTC is not 8am Warsaw (it's 9am Warsaw)
    const now = new Date('2026-02-05T08:00:30Z')
    expect(isCronDueAt('0 8 * * *', 'Europe/Warsaw', now, undefined)).toBe(false)
  })
})

// --- Auto-Expiration Tests ---

/**
 * Mirrors the maxRuns check in cronJobPollerFunction.
 * Returns true if the job should be considered expired (should NOT run).
 */
function isExpiredByMaxRuns(maxRuns: number | undefined, runCount: number): boolean {
  if (maxRuns === undefined) return false
  return runCount >= maxRuns
}

/**
 * Mirrors the expiresAt check in cronJobPollerFunction.
 * Returns true if the job should be considered expired (should NOT run).
 */
function isExpiredByDate(expiresAt: string | undefined, now: Date): boolean {
  if (!expiresAt) return false
  return now.getTime() >= new Date(expiresAt).getTime()
}

describe('maxRuns Expiration', () => {
  it('should not expire when runCount < maxRuns', () => {
    expect(isExpiredByMaxRuns(3, 2)).toBe(false)
  })

  it('should expire when runCount equals maxRuns', () => {
    expect(isExpiredByMaxRuns(3, 3)).toBe(true)
  })

  it('should expire when runCount exceeds maxRuns', () => {
    expect(isExpiredByMaxRuns(3, 5)).toBe(true)
  })

  it('should not expire on first run when maxRuns is 1', () => {
    expect(isExpiredByMaxRuns(1, 0)).toBe(false)
  })

  it('should expire after single run when maxRuns is 1', () => {
    expect(isExpiredByMaxRuns(1, 1)).toBe(true)
  })

  it('should never expire when maxRuns is undefined (unlimited)', () => {
    expect(isExpiredByMaxRuns(undefined, 0)).toBe(false)
    expect(isExpiredByMaxRuns(undefined, 100)).toBe(false)
    expect(isExpiredByMaxRuns(undefined, 999999)).toBe(false)
  })
})

describe('expiresAt Expiration', () => {
  it('should not expire when expiresAt is in the future', () => {
    const now = new Date('2026-02-05T10:00:00Z')
    expect(isExpiredByDate('2026-12-31T23:59:59Z', now)).toBe(false)
  })

  it('should expire when expiresAt is in the past', () => {
    const now = new Date('2026-02-05T10:00:00Z')
    expect(isExpiredByDate('2026-01-01T00:00:00Z', now)).toBe(true)
  })

  it('should expire when now equals expiresAt exactly', () => {
    const now = new Date('2026-02-05T10:00:00Z')
    expect(isExpiredByDate('2026-02-05T10:00:00Z', now)).toBe(true)
  })

  it('should never expire when expiresAt is undefined (no expiry)', () => {
    const now = new Date('2099-12-31T23:59:59Z')
    expect(isExpiredByDate(undefined, now)).toBe(false)
  })
})

describe('Combined Expiration (maxRuns + expiresAt)', () => {
  it('should expire when maxRuns is reached even if date is in the future', () => {
    const now = new Date('2026-02-05T10:00:00Z')
    const expiredByRuns = isExpiredByMaxRuns(3, 3)
    const expiredByDate = isExpiredByDate('2026-12-31T23:59:59Z', now)
    expect(expiredByRuns || expiredByDate).toBe(true)
  })

  it('should expire when date is past even if maxRuns not reached', () => {
    const now = new Date('2026-02-05T10:00:00Z')
    const expiredByRuns = isExpiredByMaxRuns(10, 2)
    const expiredByDate = isExpiredByDate('2026-01-01T00:00:00Z', now)
    expect(expiredByRuns || expiredByDate).toBe(true)
  })

  it('should not expire when neither limit is reached', () => {
    const now = new Date('2026-02-05T10:00:00Z')
    const expiredByRuns = isExpiredByMaxRuns(10, 2)
    const expiredByDate = isExpiredByDate('2026-12-31T23:59:59Z', now)
    expect(expiredByRuns || expiredByDate).toBe(false)
  })

  it('should not expire when neither limit is set (backward compat)', () => {
    const now = new Date('2026-02-05T10:00:00Z')
    const expiredByRuns = isExpiredByMaxRuns(undefined, 50)
    const expiredByDate = isExpiredByDate(undefined, now)
    expect(expiredByRuns || expiredByDate).toBe(false)
  })
})

describe('CreateJob Schema Validation (maxRuns + expiresAt)', () => {
  // Mirrors the CreateJobSchema from tools/jobs.ts
  const CreateJobSchema = z.object({
    name: z.string().min(1),
    type: z.enum(['cron', 'scheduled', 'recurring']),
    cronExpression: z.string().optional(),
    timezone: z.string().default('UTC'),
    scheduledAt: z.string().optional(),
    action: z.object({
      type: z.enum(['tool_call', 'workflow']),
      toolName: z.string().optional(),
      parameters: z.record(z.unknown()).optional(),
    }),
    enabled: z.boolean().default(true),
    maxRuns: z.number().int().positive().optional(),
    expiresAt: z.string().optional(),
  })

  const validBase = {
    name: 'test-job',
    type: 'cron' as const,
    cronExpression: '* * * * *',
    action: { type: 'tool_call' as const, toolName: 'telegram_send_message', parameters: { message: 'hi' } },
  }

  it('should accept maxRuns as a positive integer', () => {
    const result = CreateJobSchema.safeParse({ ...validBase, maxRuns: 5 })
    expect(result.success).toBe(true)
  })

  it('should reject maxRuns as a negative number', () => {
    const result = CreateJobSchema.safeParse({ ...validBase, maxRuns: -1 })
    expect(result.success).toBe(false)
  })

  it('should reject maxRuns as a non-integer', () => {
    const result = CreateJobSchema.safeParse({ ...validBase, maxRuns: 1.5 })
    expect(result.success).toBe(false)
  })

  it('should accept expiresAt as an ISO date string', () => {
    const result = CreateJobSchema.safeParse({ ...validBase, expiresAt: '2026-12-25T00:00:00Z' })
    expect(result.success).toBe(true)
  })

  it('should accept both maxRuns and expiresAt together', () => {
    const result = CreateJobSchema.safeParse({ ...validBase, maxRuns: 3, expiresAt: '2026-12-25T00:00:00Z' })
    expect(result.success).toBe(true)
  })

  it('should accept omitting both maxRuns and expiresAt (backward compat)', () => {
    const result = CreateJobSchema.safeParse(validBase)
    expect(result.success).toBe(true)
  })
})
