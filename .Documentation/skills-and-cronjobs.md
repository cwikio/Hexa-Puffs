# Skills and Cron Jobs

Annabelle has two independent scheduling systems. **Skills** are LLM-powered — when they fire, the Thinker receives natural language instructions, reasons through them, calls multiple tools, and makes decisions. **Cron Jobs** are dumb — they execute a single hardcoded tool call on a schedule with zero LLM involvement. Skills cost tokens; cron jobs are free. Use skills for anything that requires reading data and deciding what to do. Use cron jobs for fixed reminders and static notifications.

## Comparison

| | Skills | Cron Jobs |
|---|---|---|
| **LLM involved** | Yes — Thinker reasons through instructions | No — direct tool call |
| **Use for** | Multi-step workflows, decision-making, content analysis | Static reminders, fixed notifications |
| **Storage** | SQLite (`~/.annabelle/data/memory.db`, table `skills`) | JSON files (`~/.annabelle/data/jobs/`) |
| **Managed by** | Memorizer MCP (`memory_store_skill`, etc.) | Orchestrator (`create_job`, etc.) |
| **Scheduling** | `skillSchedulerFunction` (Inngest, every minute) | `cronJobPollerFunction` (Inngest, every minute) |
| **Examples** | "Check inbox, summarize urgent emails" | "Send 'Good morning!' at 9am" |
| **Cost** | LLM tokens per execution | Zero — just a tool call |
| **Complexity** | Can call multiple tools, branch on content | Single tool call, fixed parameters |

**Rule of thumb**: If the task reads data and makes decisions, use a skill. If it's a fixed action with no branching, use a cron job.

---

## Skills

Skills are **intelligent scheduled behaviors** powered by the Thinker LLM. When a skill fires, the Orchestrator sends the skill's instructions to the Thinker, which reasons through them, calls tools, makes decisions, and optionally notifies you of the result.

### Creating a skill

There are two ways to create a skill:

**1. Ask the Thinker via Telegram** (recommended):
Tell the Thinker what you want scheduled and it will create the skill for you. Examples:

- "Check my inbox every 30 minutes and notify me of urgent emails"
- "Set up a daily morning briefing at 6am that summarizes my calendar and email"
- "Remind me to drink water every hour"

The Thinker uses the `cron-scheduling` playbook, which follows a structured decision flow:

```
User: "Check my email every 3 hours"
         │
    ┌────▼────────────────────────────────────────────┐
    │  THINKER (cron-scheduling playbook)              │
    │                                                  │
    │  Step 1: Classify — cron job or skill?           │
    │    • Fixed action, no decisions → CRON JOB       │
    │    • Reads data, makes decisions → SKILL         │
    │                                                  │
    │  CRON JOB path:                                  │
    │    → Parse schedule → create_job                 │
    │                                                  │
    │  SKILL path:                                     │
    │    → Call get_tool_catalog (discover tools)       │
    │    → Select required tools from catalog           │
    │    → Parse schedule, write instructions           │
    │    → Call memory_store_skill                      │
    └──────────────────────┬───────────────────────────┘
                           │
    ┌──────────────────────▼───────────────────────────┐
    │  ORCHESTRATOR                                     │
    │                                                  │
    │  get_tool_catalog: returns all tools grouped      │
    │  by MCP (name + short description only)           │
    │                                                  │
    │  Validation: when memory_store_skill is called,   │
    │  checks required_tools against ToolRouter.        │
    │  Warns on unknown tools (still stores the skill). │
    └──────────────────────────────────────────────────┘
```

The key steps for skill creation:

1. **Classify**: The playbook decides if the request needs an LLM (skill) or is a simple fixed action (cron job)
2. **Discover tools**: Calls `get_tool_catalog` to get all available tools grouped by MCP with short descriptions
3. **Select tools**: Picks the exact tool names needed from the catalog (no guessing)
4. **Create**: Calls `memory_store_skill` with validated `required_tools`
5. **Validate**: The Orchestrator checks that all `required_tools` actually exist and warns if any are unknown

**2. Call the tool directly** (from any MCP client):
```
memory_store_skill({
  name: "Morning Briefing",
  trigger_type: "cron",
  trigger_config: { schedule: "0 6 * * *" },
  instructions: "Check unread emails, summarize the top 5, and send a briefing via Telegram.",
  required_tools: ["gmail_list_messages", "gmail_get_message", "telegram_send_message"],
  max_steps: 15,
  notify_on_completion: true,
  agent_id: "thinker"
})
```

**Required fields**: `name`, `trigger_type`, `instructions`

**Optional fields**:
- `trigger_config` — schedule or interval (see formats below). Omit for manual/event skills.
- `required_tools` — exact tool names from `get_tool_catalog`. Used for auto-enable logic and validated at creation time.
- `max_steps` — max LLM reasoning steps (default: 10)
- `notify_on_completion` — send Telegram notification when done (default: true)
- `agent_id` — which agent owns the skill (default: "main", most cron skills use "thinker")
- `enabled` — set to false to create a skill that auto-enables later when its tools become available
- `description` — brief description of what the skill does

### Managing skills

| Tool | Purpose |
|------|---------|
| `memory_store_skill` | Create a new skill |
| `memory_update_skill` | Update any field (enable/disable, change schedule, update instructions) |
| `memory_list_skills` | List skills with optional filters (enabled, trigger_type, agent_id) |
| `memory_get_skill` | Get a single skill by ID |
| `memory_delete_skill` | Delete a skill by ID |

### Trigger types

| Type | Description |
|------|-------------|
| `cron` | Scheduled execution — either a cron expression or a fixed interval |
| `event` | Event-driven — matched by keywords when the user sends a message (playbook skills) |
| `manual` | On-demand only — never auto-triggered |

### Cron trigger_config formats

**Cron expression** (precise scheduling):
```json
{ "schedule": "0 9 * * *" }
```
Timezone is **auto-injected** by the Memorizer at creation time using the system's timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`). Only specify `"timezone"` if the user explicitly requests a different one.

**Interval** (every-N-minutes):
```json
{ "interval_minutes": 30 }
```
Fires when `now - last_run_at >= interval_minutes`. No timezone needed.

### How a skill executes

1. `skillSchedulerFunction` runs every minute via Inngest
2. Loads all enabled cron skills from Memorizer (`memory_list_skills`)
3. For each skill, checks if it's due (cron expression match or interval elapsed)
4. Applies failure cooldown (5 min backoff after errors)
5. For meeting-related skills: runs a calendar pre-check (free/busy across all calendars)
6. Dispatches the skill's `instructions` to the Thinker via `AgentManager.executeSkill()`
7. The Thinker reads the instructions, calls tools (gmail, telegram, searcher, etc.), and produces a result
8. Updates `last_run_at`, `last_run_status`, `last_run_summary` in the DB
9. Sends a Telegram notification if `notify_on_completion` is true

### Schema

```
id              INTEGER PRIMARY KEY
agent_id        TEXT (default: "main", most skills use "thinker")
name            TEXT (unique per agent)
description     TEXT
enabled         INTEGER (0/1)
trigger_type    TEXT ("cron" | "event" | "manual")
trigger_config  TEXT (JSON)
instructions    TEXT (natural language for the LLM)
required_tools  TEXT (JSON array of tool names)
max_steps       INTEGER (default: 10, limits LLM reasoning steps)
notify_on_completion  INTEGER (0/1)
last_run_at     TEXT (ISO datetime)
last_run_status TEXT ("success" | "error")
last_run_summary TEXT
created_at      TEXT
updated_at      TEXT
```

### Current active skills

| ID | Name | Schedule | What it does |
|----|------|----------|-------------|
| 643 | Email Processor | Every 30 min | Checks inbox, processes new emails |
| 644 | Morning Briefing | 6:00 AM ET | Daily morning summary |
| 645 | Evening Recap | 6:00 PM ET | Daily evening review |
| 646 | Weekly Digest | Sun 6:00 PM ET | Weekly summary |
| 647 | Pre-meeting Prep | Every 15 min | Checks calendars, preps for upcoming meetings |
| 648 | Meeting Overload Warning | 8:00 PM ET | Alerts if too many meetings scheduled |
| 649 | Follow-up Tracker | 9:00 AM ET | Tracks pending follow-ups |
| 989 | Daily Email Classification | 5:00 AM ET | Classifies and labels emails |

Event-driven skills (playbook): `email-triage`, `email-compose`, `schedule-meeting`, `research-and-share`, `telegram-conversation`, `memory-recall`, `file-operations`, `daily-briefing`, `contact-lookup`, `email-classify`, `system-health-check`, `message-cleanup`, `cron-scheduling`, `web-browsing`, `vercel-deployments`

### Special behaviors

- **Auto-enable**: Disabled skills with `required_tools` are automatically re-enabled when all their tools become available (e.g., after an MCP reconnects)
- **Failure cooldown**: After a skill fails, it waits 5 minutes before retrying
- **Calendar pre-check**: Meeting-related skills (name matches `/meeting|prep/i` AND requires `gmail_list_events`) check all calendars via free/busy API before dispatching to the Thinker. First empty check of the day sends a "no events" notification; subsequent empty checks skip silently.
- **Cost controls**: If the Thinker's token usage spikes during a skill, the agent is auto-paused and a notification is sent

---

## Cron Jobs

Cron jobs are **simple, dumb scheduled actions**. They execute a single hardcoded tool call on a schedule with no LLM involvement.

### Creating a cron job

**1. Ask the Thinker via Telegram**:
- "Remind me to drink water every hour"
- "Send me 'Stand up!' every 30 minutes during work hours"

The Thinker uses the `cron-scheduling` playbook to decide whether to create a cron job or a skill based on complexity.

**2. Call the tool directly**:
```
create_job({
  name: "Daily water reminder",
  type: "cron",
  cronExpression: "0 9 * * *",
  action: {
    type: "tool_call",
    toolName: "telegram_send_message",
    parameters: {
      chat_id: "123456789",
      message: "Drink water!"
    }
  }
})
```

Timezone defaults to the system timezone. Optional fields: `maxRuns` (auto-disable after N runs), `expiresAt` (ISO date to auto-disable).

### Managing cron jobs

| Tool | Purpose |
|------|---------|
| `create_job` | Create a new cron or scheduled job |
| `list_jobs` | List all jobs |
| `get_job` | Get a single job by ID |
| `delete_job` | Delete a job by ID |

### Job types

| Type | Description |
|------|-------------|
| `cron` | Recurring — fires on a cron expression schedule |
| `scheduled` | One-shot — fires once at a specific datetime, then stays as a record |

### How a cron job executes

1. `cronJobPollerFunction` runs every minute via Inngest
2. Loads all enabled cron jobs from `~/.annabelle/data/jobs/`
3. For each job, uses `croner` to check if the cron expression fires in the current minute
4. Checks expiration limits (`maxRuns`, `expiresAt`)
5. Calls `executeAction()` which directly routes the tool call via `ToolRouter`
6. Updates `lastRunAt`, `runCount` in the job file
7. On failure: sends Telegram notification and stores error in Memory MCP

### Job file format

```json
{
  "id": "job_1770880402842_t36thucch",
  "name": "Daily water reminder",
  "type": "cron",
  "cronExpression": "0 9 * * *",
  "timezone": "America/New_York",
  "action": {
    "type": "tool_call",
    "toolName": "telegram_send_message",
    "parameters": {
      "chat_id": "123456789",
      "message": "Drink water!"
    }
  },
  "enabled": true,
  "createdAt": "2026-02-12T07:13:22.842Z",
  "createdBy": "user",
  "runCount": 5,
  "lastRunAt": "2026-02-13T09:00:00.363Z",
  "maxRuns": 10,
  "expiresAt": "2026-03-01T00:00:00Z"
}
```

### Dedup protection

If a job with the same name was created within the last 60 seconds, the system returns the existing job instead of creating a duplicate. This prevents LLM retry loops from creating multiple identical jobs.

---

## Other Inngest Functions

Beyond the two schedulers, the Orchestrator registers these Inngest functions:

| Function | Schedule | Purpose |
|----------|----------|---------|
| `backgroundJobFunction` | Event-driven | Executes one-off background tasks (queued via `queue_task` tool) |
| `cronJobFunction` | Event-driven | Executes a single cron job (dispatched by the poller) |
| `conversationBackfillFunction` | Manual trigger | Extracts facts from old conversations that were never processed |
| `memorySynthesisFunction` | Sun 3:00 AM | Weekly fact consolidation — merges duplicates, resolves contradictions |
| `healthReportFunction` | Every 6 hours | Runs `/diagnose` checks, compares with last report, sends Telegram alert on changes |

### Ollama health check

The `skillSchedulerFunction` also includes a rate-limited Ollama health check. On each run it pings Ollama — if unreachable, it sends a one-time Telegram alert. When Ollama comes back, it sends a recovery notification. State tracked in `~/.annabelle/data/ollama-alert-state.json`.

---

## Timezone handling

- **Skills**: Timezone is auto-injected by the Memorizer when a skill is created or updated. If `trigger_config` has a `schedule` (cron expression) but no `timezone`, the system timezone is added automatically. User-specified timezones are respected.
- **Cron Jobs**: Timezone defaults to the system timezone in the `CreateJobSchema` (via `SYSTEM_TIMEZONE`).
- **System timezone**: Detected at runtime via `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- The Thinker's playbook instructs the LLM to omit timezone (auto-detected) unless the user specifies one.
