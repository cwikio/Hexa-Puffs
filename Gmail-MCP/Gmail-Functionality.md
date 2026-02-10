# Gmail + Calendar Enhancement — Annabelle

## Decisions Made

- **Multiple Google accounts** supported (Option A: separate Gmail MCP instances)
- **Notifications via Telegram** (but not hardcoded — any messaging app via abstraction)
- **Always drafts**, never auto-send
- **Calendar write access** — can create/move events
- **No per-email notifications** — removed; replaced by smart cron-based processing
- **Email processing every 30 min** (configurable) — smart summaries, not raw forwarding
- **No 2-hour check** — the 30-min processor + morning/evening briefings cover it

---

## Information Flow Architecture

### Current Flow (being replaced)

```
Gmail MCP (polls every 60s)
    └──→ HTTP POST to Orchestrator /tools/call
              └──→ telegram_send_message → raw email notification to user
```

**Problem:** Thinker is never involved. No classification, no contact lookup, no intelligence.
Per-email Telegram pings are noisy and unhelpful. **This is deleted.**

### New Flow: Cron-Based Smart Processing

```
Inngest Skill Scheduler (checks every minute for due skills)
    │
    │  Finds "Email Processor" skill is due (every 30 min, configurable)
    │
    └──→ Thinker /execute-skill (autonomous ReAct loop)
              │
              │  Step 1: gmail_get_new_emails
              │          → pulls 0-N emails from Gmail MCP queue
              │          → if 0 emails → stop, no notification
              │
              │  Step 2: For each email, enrich with context:
              │          → list_contacts({ email: sender })   — who is this?
              │          → list_projects({ contact_id })       — what projects?
              │          → retrieve_memories("subject keywords") — any context?
              │          → Classify: meeting request? action needed? FYI?
              │
              │  Step 3: Store insights
              │          → store_fact() for noteworthy items
              │          → update_project() if status changed
              │          → create_contact() if new sender (after asking user)
              │
              │  Step 4: Compose enriched summary
              │          "3 new emails since last check:
              │           - John (BigCorp, API Redesign): timeline question — needs response
              │           - Alice (BigCorp, Brand Refresh): approved mockups — FYI
              │           - Newsletter: TechCrunch — skip"
              │
              └──→ notify_user (currently Telegram, abstracted)
```

### Morning Briefing Flow (6:00 AM)

```
Inngest triggers "Morning Briefing" skill
    │
    └──→ Thinker /execute-skill
              │
              ├──→ gmail_list_messages (unread, all accounts)
              ├──→ gmail_list_events (today, all calendars)
              ├──→ list_contacts + list_projects (for context)
              ├──→ retrieve_memories (pending action items)
              │
              └──→ Compose strategic briefing:
                   "Good morning. Today:
                    📅 3 meetings: standup 10am, John 2pm (API Redesign), Alice 4pm
                    📧 7 unread: 3 from John (API Redesign), 2 from Alice, 2 newsletters
                    ⚠️ Pending: You haven't replied to Bob's email from Tuesday
                    🔜 John meeting at 2pm — last thread was about timeline concerns"
              │
              └──→ notify_user
```

### Evening Recap Flow (6:00 PM)

```
Inngest triggers "Evening Recap" skill
    │
    └──→ Thinker /execute-skill
              │
              ├──→ gmail_list_messages (today's activity)
              ├──→ gmail_list_events (tomorrow)
              ├──→ list_projects (active, check for pending items)
              │
              └──→ Compose evening summary:
                   "End of day recap:
                    ✅ Responded to: John (timeline), Alice (mockup approval)
                    ⏳ Still pending: Bob's infrastructure question (2 days old)
                    📅 Tomorrow: 2 meetings — standup 10am, new client intro 3pm
                    💡 Tomorrow's intro is with someone you haven't emailed before"
              │
              └──→ notify_user
```

### Skill Relationships

| Skill | Schedule | Purpose |
|-------|----------|---------|
| **Email Processor** | Every 30 min (configurable) | Tactical: "what just came in?" — processes new emails, classifies, notifies |
| **Morning Briefing** | 6:00 AM daily | Strategic: full day overview — calendar, unread, pending items, meeting prep |
| **Evening Recap** | 6:00 PM daily | Strategic: day wrap-up — what's done, what's pending, tomorrow preview |
| **Weekly Digest** | Sunday 6:00 PM | Strategic: week summary, next week preview |
| **Follow-up Tracker** | 9:00 AM daily | Check for sent emails > 48h without reply |
| **Pre-meeting Prep** | Every 15 min | Check for meetings in next 30 min, send attendee context briefing |
| **Meeting Overload** | 8:00 PM daily | Check tomorrow's calendar, warn if overloaded |

---

## Core Daily Routines (Cron Skills via Inngest)

### Morning Briefing (6:00 AM)

- Unread email summary, grouped by contact/project
- Today's calendar overview — meetings, gaps
- Action items extracted from yesterday's emails you haven't responded to
- Pre-meeting context: "You have a meeting with X in 4 hours — here's the email thread"

### Evening Recap (6:00 PM)

- What came in today, what you responded to, what's still pending
- Tomorrow's calendar preview
- Reminder of emails that need a response before tomorrow

### Email Processor (every 30 min, configurable)

- Pull new emails from Gmail MCP queue
- Classify each: meeting request, action needed, FYI, newsletter
- Enrich with contact/project context
- Store insights as facts
- Send short summary only if there's something notable

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
- **Per-email Telegram notifications removed** — replaced by smart cron-based processing

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

## Execution Architecture Summary

### Cron Skills (7 — stored in Memorizer DB, triggered by Inngest)

| # | Skill | Schedule | Required Tools |
|---|-------|----------|----------------|
| 1 | Email Processor | `*/30 * * * *` (configurable) | gmail_get_new_emails, list_contacts, list_projects, retrieve_memories, store_fact, notify_user |
| 2 | Morning Briefing | `0 6 * * *` | gmail_list_messages, gmail_list_events, list_contacts, list_projects, retrieve_memories, notify_user |
| 3 | Evening Recap | `0 18 * * *` | gmail_list_messages, gmail_list_events, list_projects, retrieve_memories, notify_user |
| 4 | Weekly Digest | `0 18 * * 0` | gmail_list_messages, gmail_list_events, list_projects, retrieve_memories, notify_user |
| 5 | Follow-up Tracker | `0 9 * * *` | gmail_list_messages, list_contacts, list_projects, notify_user |
| 6 | Pre-meeting Prep | `*/15 * * * *` | gmail_list_events, gmail_list_messages, list_contacts, retrieve_memories, notify_user |
| 7 | Meeting Overload | `0 20 * * *` | gmail_list_events, notify_user |

### Playbooks (7 — SKILL.md files, keyword-triggered in conversations)

| # | Playbook | Keywords | Purpose |
|---|----------|----------|---------|
| 1 | Email Drafting | draft, reply, respond, write email | Guide Thinker through draft composition with contact/project context |
| 2 | Calendar Availability | free, available, busy, meeting time, schedule | Check calendars, find slots, format options |
| 3 | Email Search | find email, search email, what did X say | Map person to contact, search Gmail, summarize |
| 4 | Meeting Scheduling | suggest times, when can I meet, set up meeting | Check calendar, propose options formatted for email |
| 5 | Rescheduling | reschedule, move meeting, postpone | Find event, find alternatives, draft notifications |
| 6 | Project Status | status of, what's happening with, update on | Look up project, recent emails/facts, summarize |
| 7 | Contact Briefing | tell me about, who is, background on | Look up contact, their projects, relationship history |

---

## Open Questions

- How to handle multiple account priority/merging?
- How many Gmail instances needed at launch? (which accounts?)
- Should contacts/projects be seeded manually or discovered from email history?
- Should calendar events include video call links auto-detection?
