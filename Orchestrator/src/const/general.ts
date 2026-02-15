// ── Skill Scheduler Pre-flight Constants ─────────────────────────

/** How far ahead to check for upcoming meetings before running meeting skills (ms). */
export const PREFLIGHT_CALENDAR_WINDOW_MS = 60 * 60 * 1000 // 60 minutes

/** Whether to check for new emails before running email skills. */
export const PREFLIGHT_EMAIL_ENABLED = true

// ── Skill Scheduler Frequency ─────────────────────────────────────

/** How often the skill scheduler checks for due skills (Inngest cron expression). */
export const SKILL_SCHEDULER_CRON = process.env.SKILL_SCHEDULER_CRON || '* * * * *' // Every minute

// ── Notification Constants ───────────────────────────────────────

/** Default minimum minutes between Telegram notifications per skill.
 *  Skills still run at their normal interval — only notifications are throttled.
 *  Override globally via SKILL_NOTIFY_INTERVAL_MINUTES env var,
 *  or per-skill via notify_interval_minutes column in the skills table. */
export const DEFAULT_NOTIFY_INTERVAL_MINUTES = parseInt(process.env.SKILL_NOTIFY_INTERVAL_MINUTES || '60', 10)
