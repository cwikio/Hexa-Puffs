/**
 * Unit tests for cron expression and timezone validation,
 * and the cron poller "is due" logic.
 */

import { describe, it, expect } from 'vitest'
import { Cron } from 'croner'

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
