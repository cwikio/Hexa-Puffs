# Gmail + Calendar Enhancement — Annabelle

## Decisions Made
- **Multiple Google accounts** supported
- **Notifications via Telegram** (but not hardcoded — any messaging app)
- **Always drafts**, never auto-send
- **Calendar write access** — can create/move events
- **Short summary every 2h** — content TBD

---

## Core Daily Routines (Cron via Inngest)

### Morning Briefing (6:00 AM)
- Unread email summary, grouped by priority/sender
- Today's calendar overview — meetings, gaps, travel time
- Action items extracted from yesterday's emails you haven't responded to
- Heads-up: "You have a meeting with X in 2 hours — here's the email thread for context"

### Evening Recap (6:00 PM)
- What came in today, what you responded to, what's still pending
- Tomorrow's calendar preview
- Reminder of emails that need a response before tomorrow

### Every-2-Hour Summary
- Content TBD — short summary of what's new since last check

---

## Email Scenarios

1. **Draft preparation** — Draft replies, auto-draft for common patterns (confirmations, scheduling)
2. **Email summarization** — Summarize long threads into key points + action items
3. **Priority triage** — Flag urgent, filter noise, surface what needs attention
4. **Follow-up tracking** — Detect unanswered sent emails after N days, remind
5. **Email search** — "Find the email about the invoice" / "What did Sarah say about the deadline?"
6. **Auto-categorization** — Label/tag by topic (invoices, meetings, personal, newsletters)
7. **Unsubscribe suggestions** — "You haven't opened emails from X in 3 months"

---

## Calendar Scenarios

1. **Availability check** — "Am I free Thursday afternoon?"
2. **Next free slot** — "When is my next 1-hour free block?"
3. **Multi-calendar awareness** — Personal + work + shared, detect conflicts across all
4. **Meeting suggestion** — "Suggest 3 times this week" (formatted for pasting into email)
5. **Day overview** — "What does my Wednesday look like?"
6. **Conflict detection** — "You have two overlapping meetings on Friday at 2pm"
7. **Travel/buffer time** — Flag need for travel time for in-person meetings

---

## Cross-functional (Email + Calendar)

1. **Meeting request detection** — Email says "Can we meet Thursday?" → check calendar, draft reply with options
2. **Pre-meeting briefing** — 30 min before, summarize recent email threads with attendees
3. **Post-meeting follow-up** — After meeting ends, offer to draft follow-up email
4. **Interview prep** — Detect interview emails, prepare candidate info/questions, morning reminder
5. **Rescheduling** — "Move my 3pm to tomorrow" → find slot, draft reschedule emails
6. **Deadline tracking** — Extract deadlines from emails, cross-ref with calendar, warn about conflicts

---

## Proactive / Smart Scenarios

1. **"You haven't responded" alerts** — After 24/48h nudge about important unanswered emails
2. **Meeting overload warning** — "6 meetings tomorrow with no breaks — want to move one?"
3. **Weekly digest** — Sunday evening: week summary, pending items, next week preview
4. **Contact intelligence** — "Last emailed X 2 months ago" / "Meeting with someone new — here's context"
5. **Out-of-office handling** — Detect travel from calendar, suggest auto-responders

---

## Open Questions
- What should the every-2-hour summary contain?
- How to handle multiple account priority/merging?
- Should calendar events include video call links auto-detection?
