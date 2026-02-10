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

## Multi-Account Architecture

**Decision:** Option A — run multiple Gmail MCP instances (one per Google account).
- e.g., `gmail-personal` on port 8008, `gmail-work` on port 8009
- Annabelle reaches the right instance based on context (contact → company → which account)
- Fits the existing auto-discovery architecture — each instance is a separate MCP

---

## Notification Architecture

**Decision:** Not hardcoded to Telegram — abstract notification layer.
- Skills say "notify user" not "send Telegram message"
- Current implementation: Telegram
- Future: could be email, Slack, push notification, etc.
- Needs a generic `notify_user` tool or abstraction in Orchestrator/Thinker

---

## Memory & Context Architecture

### Approach: Structured Tables + Facts (Hybrid)

**Why not just vector search?**
Vector search is great for fuzzy recall ("what do I know about John?") but unreliable for:
- Enumeration: "list ALL my active projects" — may miss some
- Filtering: "all projects for John specifically" — semantic similarity is fuzzy
- State tracking: "is Mobile App active or paused?" — can't resolve conflicting facts
- Aggregation: "how many emails from Alice this week?"

**Solution:** Lightweight structured tables for the registry, facts for rich context.

### Consultant Work Structure

```
Tomasz (Consultant)
└── Company: BigCorp
    ├── Client: John
    │   ├── Project: API Redesign (active, high priority)
    │   ├── Project: Mobile App (paused)
    │   └── ... more projects
    ├── Client: Alice
    │   ├── Project: Brand Refresh
    │   └── Project: API Redesign (also involved)
    └── Client: Bob
        └── Project: Infrastructure Audit
```

Key characteristics:
- One main company, multiple clients (people) within it
- Each client has multiple projects
- Projects can involve multiple people (many-to-many)
- Personal projects/contacts also exist outside work

### Database Schema: Two New Tables in Memorizer

**`contacts`** — people Tomasz works with

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| agent_id | TEXT | Scoped to agent (e.g., "annabelle") |
| name | TEXT | "John Smith" |
| email | TEXT | "john@bigcorp.com" |
| company | TEXT (nullable) | "BigCorp" (null for personal contacts) |
| role | TEXT (nullable) | "Product Manager" |
| type | TEXT | "work" / "personal" |
| notes | TEXT (nullable) | Free-form: "Prefers morning meetings" |
| created_at | TEXT | Auto |
| updated_at | TEXT | Auto |

**`projects`** — things Tomasz works on

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| agent_id | TEXT | Scoped to agent |
| name | TEXT | "API Redesign" |
| status | TEXT | "active" / "paused" / "completed" |
| type | TEXT | "work" / "personal" |
| description | TEXT (nullable) | Brief summary |
| primary_contact_id | INTEGER (nullable) | FK → contacts. Null for personal projects |
| participants | TEXT (nullable) | JSON array of contact IDs for multi-person projects |
| company | TEXT (nullable) | "BigCorp" (null for personal) |
| priority | TEXT (nullable) | "high" / "medium" / "low" |
| created_at | TEXT | Auto |
| updated_at | TEXT | Auto |

### New Memorizer Tools (6)

- `create_contact` / `list_contacts` / `update_contact`
- `create_project` / `list_projects` / `update_project`

Query examples:
- `list_projects({ contact_id: 1, status: "active" })` → John's active projects
- `list_contacts({ company: "BigCorp" })` → all BigCorp people
- `list_projects({ type: "personal" })` → personal projects only

### How It Works Together

1. **Email arrives** from john@bigcorp.com about "API timeline"
2. Annabelle looks up **contact** by email → finds John
3. Annabelle searches **projects** for John → sees 20 projects
4. Annabelle searches **facts** (vector) for "John API timeline" → narrows to API Redesign
5. If ambiguous → **asks Tomasz**: "Is this about API Redesign or a new project?"
6. Stores insights as **facts**, updates project status if needed
7. Summaries grouped by **company → client → project**

### What Goes Where

| Data Type | Storage | Example |
|-----------|---------|---------|
| Who someone is | `contacts` table | John Smith, john@bigcorp.com, PM at BigCorp |
| What you're working on | `projects` table | API Redesign, active, high priority |
| Insights & preferences | Memorizer facts | "John is detail-oriented about API specs" |
| Relationship patterns | Memorizer facts | "Alice always responds within 1 hour" |
| Email/calendar context | Memorizer facts | "API Redesign deliverable 3 is behind schedule" |
| User-level settings | Memorizer profile | Timezone, working hours, communication prefs |

### Annabelle's Behavior on Ambiguity

- **New sender?** → Ask: "I got an email from sarah@bigcorp.com — is this a new contact? Should I create one?"
- **Unclear project?** → Ask: "John mentioned 'the timeline' — is this about API Redesign or another project?"
- **Personal vs work?** → Ask: "John invited you to a birthday party — should I file this as personal?"
- **New project?** → Ask: "Alice mentioned 'Phase 2 migration' — is this a new project or part of Website Migration?"

---

## Open Questions
- What should the every-2-hour summary contain?
- How to handle multiple account priority/merging?
- Should calendar events include video call links auto-detection?
- How many Gmail instances needed at launch? (which accounts?)
- Should contacts/projects be seeded manually or discovered from email history?
