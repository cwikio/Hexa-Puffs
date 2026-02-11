# Gmail + Calendar Enhancement

## Status: Implementation Complete

All phases implemented. Ready for end-to-end testing after build + restart.

---

## Resolved Decisions

| Question | Decision |
|----------|----------|
| Gmail accounts | 2 at launch (could grow) |
| Notification channel | Telegram for now, not hardcoded |
| Email sending | Always drafts, never auto-send |
| Calendar access | Read + write |
| Per-email notifications | Removed — replaced by smart cron processing |
| Email processing frequency | Every 30 min (configurable via `interval_minutes`) |
| Email history scan | Yes — scan history to seed contacts/projects |
| Video call link detection | Yes — in pre-meeting prep skill |
| Cron skill seeding | Seeded as disabled, auto-enabled when required tools available |

---

## Architecture

### Data Layer (Memorizer MCP)

Two new tables in the existing SQLite database:

- **contacts** — people the user works with (name, email, company, role, type, notes)
- **projects** — things the user is working on (name, status, type, company, priority, primary_contact_id, participants JSON)

6 new tools: `create_contact`, `list_contacts`, `update_contact`, `create_project`, `list_projects`, `update_project`.

### Execution Models

| Model | Trigger | Example |
|-------|---------|---------|
| Cron skills | Inngest scheduler (every minute) | Email Processor (30 min), Morning Briefing (6am) |
| Playbooks (SKILL.md) | Keyword match in user message | "draft an email", "who is John?" |
| Native tool calls | Direct tool invocation by Thinker | `gmail_search_emails`, `memory_list_contacts` |

### Information Flow

```
Gmail MCP → polls via History API → queues new emails (no notifications)
                                         ↓
Inngest scheduler → Email Processor skill → Thinker → reads queue + enriches → Telegram summary
                                         ↓
User asks via Telegram → Thinker → keyword matches SKILL.md → guided conversation
```

---

## Implemented Components

### Phase 1: Memorizer Schema + Tools
- `Memorizer-MCP/src/db/schema.ts` — contacts + projects tables, types, enums
- `Memorizer-MCP/src/tools/contacts.ts` — 3 tools (create, list, update)
- `Memorizer-MCP/src/tools/projects.ts` — 3 tools (create, list, update)
- Wired into server.ts, index.ts, tools/index.ts

### Phase 2: Gmail Notification Removal
- Removed `sendTelegramNotification` from `polling.ts`
- Deleted `notifications.ts`
- Removed `notifications` config section from schema/config

### Phase 3: SKILL.md Playbooks (7 files)
Location: `~/.annabelle/skills/<Name>/SKILL.md`

| Skill | Keywords | Purpose |
|-------|----------|---------|
| EmailDrafting | draft, reply, compose | Guide email composition with contact context |
| CalendarAvailability | free, available, busy | Check calendars, find free slots |
| EmailSearch | find email, search email | Search + summarize emails |
| MeetingScheduling | suggest times, set up meeting | Find slots, create events/drafts |
| Rescheduling | reschedule, move meeting | Find alternatives, update events |
| ProjectStatus | status of, update on | Project overview with recent activity |
| ContactBriefing | who is, tell me about | Contact overview with relationship history |

### Phase 4: Cron Skills + Auto-Enable
- `_scripts/seed-cron-skills.ts` — seeds 7 skills as disabled
- Auto-enable logic in `Orchestrator/src/jobs/functions.ts` — checks disabled skills' required_tools against ToolRouter every minute

| Skill | Schedule | max_steps |
|-------|----------|-----------|
| Email Processor | Every 30 min | 15 |
| Morning Briefing | 6am (Europe/Warsaw) | 15 |
| Evening Recap | 6pm (Europe/Warsaw) | 12 |
| Weekly Digest | Sunday 6pm (Europe/Warsaw) | 15 |
| Follow-up Tracker | 9am daily (Europe/Warsaw) | 10 |
| Pre-meeting Prep | Every 15 min | 10 |
| Meeting Overload Warning | 8pm daily (Europe/Warsaw) | 6 |

---

## Testing Checklist

- [ ] Build all packages: `./rebuild.sh`
- [ ] Restart stack: `./restart.sh`
- [ ] Verify tools visible: `curl http://localhost:8010/tools/list | grep -E "memory_(create|list|update)_(contact|project)"`
- [ ] Test contacts CRUD: create → list → update → list
- [ ] Test projects CRUD: create with contact_id → list with filter → update
- [ ] Send test email → verify NO Telegram notification
- [ ] Verify `gmail_get_new_emails` still returns new emails
- [ ] Check Thinker logs for "Loaded 7 file-based skill(s) from disk"
- [ ] Run seed script: `npx tsx _scripts/seed-cron-skills.ts`
- [ ] Check skills seeded as disabled
- [ ] Start Gmail MCP → verify auto-enable within 1 minute
- [ ] Test playbook: send "who is John" via Telegram → verify ContactBriefing
