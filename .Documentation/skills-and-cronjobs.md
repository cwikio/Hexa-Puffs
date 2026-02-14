# Skills (Scheduled Tasks)

Annabelle uses a unified **skills** system for all scheduled tasks. Skills support two execution tiers: **Direct tier** (zero LLM cost, single compiled tool call) and **Agent tier** (LLM-powered reasoning via Thinker). All skills are stored in SQLite via the Memorizer MCP and scheduled via Inngest.

## Execution Tiers

| | Direct Tier | Agent Tier |
|---|---|---|
| **LLM involved** | No — direct tool call | Yes — Thinker reasons through instructions |
| **Use for** | Static reminders, fixed notifications | Multi-step workflows, decision-making, content analysis |
| **Cost** | Zero — just a tool call | LLM tokens per execution |
| **Complexity** | Single tool call, fixed parameters | Can call multiple tools, branch on content |
| **Key field** | `execution_plan` (compiled steps) | `instructions` (natural language) |
| **Examples** | "Send 'Drink water!' at 9am" | "Check inbox, summarize urgent emails" |

**Rule of thumb**: For fixed actions (reminders, static messages), create a skill with an `execution_plan` (Direct tier). For tasks that read data and make decisions, create a skill with `instructions` only (Agent tier).

**Safety net**: If an `execution_plan` with more than 1 step is submitted, the system auto-converts it to Agent tier (strips the plan, populates `required_tools` from the plan's tool names). Direct tier does not support result piping between steps.

---

## Skills

Skills are **autonomous scheduled behaviors**. Simple skills (Direct tier) execute a single compiled tool call with zero LLM cost. Complex skills (Agent tier) dispatch instructions to the Thinker, which reasons through them, calls tools, makes decisions, and produces a result.

### Creating a skill

There are two ways to create a skill:

**1. Ask the Thinker via Telegram** (recommended):
Tell the Thinker what you want scheduled and it will create the skill for you. Examples:

- "Check my inbox every 30 minutes and notify me of urgent emails"
- "Set up a daily morning briefing at 6am that summarizes my calendar and email"
- "Remind me to drink water every hour"

The Thinker uses the `cron-scheduling` playbook, which follows a structured decision flow:

```
User: "Remind me in 5 minutes to drink water"
         │
    ┌────▼────────────────────────────────────────────┐
    │  THINKER (cron-scheduling playbook)              │
    │                                                  │
    │  Step 1: Parse schedule                          │
    │    • "in 5 minutes" → { in_minutes: 5 }         │
    │    • "at 3pm" → { at: "2026-02-14T15:00:00" }   │
    │    • "every day at 9am" → { schedule: "0 9 *" }  │
    │                                                  │
    │  Step 2: Classify — SIMPLE or COMPLEX?           │
    │    • Fixed action, no decisions → SIMPLE          │
    │      → Build execution_plan (Direct tier)        │
    │    • Reads data, makes decisions → COMPLEX        │
    │      → Write instructions (Agent tier)            │
    │                                                  │
    │  Step 3: Call memory_store_skill                  │
    └──────────────────────┬───────────────────────────┘
                           │
    ┌──────────────────────▼───────────────────────────┐
    │  ORCHESTRATOR                                     │
    │                                                  │
    │  Normalizer: converts in_minutes → at timestamp   │
    │  Validates cron expressions via croner             │
    │  Checks required_tools against ToolRouter          │
    └──────────────────────────────────────────────────┘
```

The key steps for skill creation:

1. **Parse schedule**: Determine one-shot (`in_minutes`, `at`) vs recurring (`schedule`, `interval_minutes`)
2. **Classify**: Simple fixed action → Direct tier with `execution_plan`. Complex decision-making → Agent tier with `instructions`
3. **Discover tools**: Calls `get_tool_catalog` to get all available tools
4. **Create**: Calls `memory_store_skill` — the Orchestrator normalizer converts `in_minutes`/`in_hours` to `at` timestamps and validates cron expressions

**2. Call the tool directly** (from any MCP client):

Direct tier example (zero LLM cost — static tool call):
```
memory_store_skill({
  name: "Drink water reminder",
  trigger_type: "cron",
  trigger_config: { in_minutes: 30 },
  instructions: "Send a reminder to drink water",
  required_tools: ["telegram_send_message"],
  execution_plan: [{ id: "step1", toolName: "telegram_send_message", parameters: { chat_id: "8304042211", message: "Drink water!" } }],
  notify_on_completion: false,
  agent_id: "thinker"
})
```

Agent tier example (LLM reasoning at fire time):
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
- `trigger_config` — schedule, interval, `at`, or `in_minutes` (see formats below). Omit for manual/event skills.
- `required_tools` — exact tool names from `get_tool_catalog`. Used for auto-enable logic and validated at creation time.
- `execution_plan` — compiled array of tool call steps. When present, skill uses Direct tier (zero LLM cost). Each step: `{ id, toolName, parameters }`.
- `max_steps` — max LLM reasoning steps for Agent tier (default: 10)
- `notify_on_completion` — send Telegram notification when done (default: true). Set to false for Direct tier skills whose `execution_plan` already sends a message.
- `notify_interval_minutes` — minimum minutes between notifications (0 = use global default from `SKILL_NOTIFY_INTERVAL_MINUTES` env var)
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

**Cron expression** (precise recurring scheduling):
```json
{ "schedule": "0 9 * * *" }
```
Timezone is **auto-injected** by the Memorizer at creation time using the system's timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`). Only specify `"timezone"` if the user explicitly requests a different one.

**Interval** (every-N-minutes recurring):
```json
{ "interval_minutes": 30 }
```
Fires when `now - last_run_at >= interval_minutes`. No timezone needed.

**One-shot absolute** (fires once at a specific time):
```json
{ "at": "2026-02-14T15:00:00" }
```
Fires once when `now >= at`, then auto-disables. Use for "remind me at 3pm" or "tomorrow at 9am."

**One-shot relative** (fires once N minutes from now):
```json
{ "in_minutes": 10 }
```
The skill normalizer (`Orchestrator/src/utils/skill-normalizer.ts`) auto-converts this to an absolute `at` timestamp at creation time. Use for "remind me in 5 minutes" or "in an hour" (`{ "in_minutes": 60 }`). Also supports `{ "in_hours": 2 }`.

**Important**: "remind me IN 5 minutes" = one-shot `{ "in_minutes": 5 }`. "remind me EVERY 5 minutes" = recurring `{ "schedule": "*/5 * * * *" }`. The `in_minutes` format exists specifically because LLMs tend to confuse these two patterns.

### Execution tiers

Skills have two execution tiers, selected automatically based on whether `execution_plan` is present:

**Direct tier** (zero LLM cost) — when `execution_plan` is present:
1. The scheduler reads the compiled tool call steps from `execution_plan`
2. Executes them sequentially via `executeWorkflow()` in `Orchestrator/src/jobs/executor.ts`
3. No LLM involved — just direct tool calls with static parameters
4. Safety net: if `telegram_send_message` is called without `chat_id`, the executor auto-injects the default monitored chat from the channel manager

**Agent tier** (LLM reasoning) — when `execution_plan` is absent:
1. The scheduler dispatches the skill's `instructions` to the Thinker via `AgentManager.executeSkill()`
2. The Thinker reads the instructions, calls tools, makes decisions, and produces a result
3. Costs LLM tokens per execution

### How a skill executes

1. `skillSchedulerFunction` runs every minute via Inngest
2. Loads all enabled cron skills from Memorizer (`memory_list_skills`)
3. For each skill, checks if it's due (cron expression match, interval elapsed, or one-shot time reached)
4. Applies failure cooldown (graduated backoff: 1, 5, 15, 60 min after consecutive errors)
5. Pre-flight checks: calendar-aware for meeting skills, email-aware for email skills
6. **Tier routing**: if `execution_plan` exists → Direct tier; otherwise → Agent tier
7. Updates `last_run_at`, `last_run_status`, `last_run_summary` in the DB
8. Sends a Telegram notification if `notify_on_completion` is true
9. One-shot skills (`at` trigger) auto-disable after firing

### Schema

```
id                      INTEGER PRIMARY KEY
agent_id                TEXT (default: "main", most skills use "thinker")
name                    TEXT (unique per agent)
description             TEXT
enabled                 INTEGER (0/1)
trigger_type            TEXT ("cron" | "event" | "manual")
trigger_config          TEXT (JSON — schedule, interval_minutes, at, or in_minutes)
instructions            TEXT (natural language for the LLM)
required_tools          TEXT (JSON array of tool names)
execution_plan          TEXT (JSON array of tool call steps — when present, uses Direct tier)
max_steps               INTEGER (default: 10, limits LLM reasoning steps for Agent tier)
notify_on_completion    INTEGER (0/1)
notify_interval_minutes INTEGER (min minutes between notifications, 0 = global default)
last_run_at             TEXT (ISO datetime)
last_run_status         TEXT ("success" | "error")
last_run_summary        TEXT
last_notified_at        TEXT (ISO datetime)
created_at              TEXT
updated_at              TEXT
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
- **Graduated backoff**: After failures, retry delays increase: 1 → 5 → 15 → 60 minutes. Auto-disables after 5 consecutive failures. Counters reset on process restart.
- **One-shot auto-disable**: Skills with `trigger_config.at` fire once and auto-disable after execution
- **Calendar pre-check**: Meeting-related skills (name matches `/meeting|prep/i` AND requires `gmail_list_events`) check all calendars via free/busy API before dispatching. No meetings → skip silently (zero LLM cost).
- **Email pre-check**: Email skills (name matches `/email/i` AND requires `gmail_get_new_emails`) skip if no new emails exist
- **chat_id auto-injection**: Direct tier executor auto-injects `chat_id` for `telegram_send_message` calls that omit it, using the first monitored chat from the channel manager
- **Skill normalizer**: The Orchestrator normalizes skill inputs at creation time (`Orchestrator/src/utils/skill-normalizer.ts`): re-nests flattened fields, converts `in_minutes`/`in_hours` to `at` timestamps, normalizes cron aliases, parses string fields to proper types
- **Cost controls**: If the Thinker's token usage spikes during a skill, the agent is auto-paused and a notification is sent

---

## Other Inngest Functions

Beyond the skill scheduler, the Orchestrator registers these Inngest functions:

| Function | Schedule | Purpose |
|----------|----------|---------|
| `backgroundJobFunction` | Event-driven | Executes one-off background tasks (queued via `queue_task` tool) |
| `conversationBackfillFunction` | Manual trigger | Extracts facts from old conversations that were never processed |
| `memorySynthesisFunction` | Sun 3:00 AM | Weekly fact consolidation — merges duplicates, resolves contradictions |
| `healthReportFunction` | Every 6 hours | Runs `/diagnose` checks, compares with last report, sends Telegram alert on changes |

### Ollama health check

The `skillSchedulerFunction` also includes a rate-limited Ollama health check. On each run it pings Ollama — if unreachable, it sends a one-time Telegram alert. When Ollama comes back, it sends a recovery notification. State tracked in `~/.annabelle/data/ollama-alert-state.json`.

---

## Timezone handling

- Timezone is auto-injected by the Memorizer when a skill is created or updated. If `trigger_config` has a `schedule` (cron expression) but no `timezone`, the system timezone is added automatically. User-specified timezones are respected.
- **System timezone**: Detected at runtime via `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- The Thinker's playbook instructs the LLM to omit timezone (auto-detected) unless the user specifies one.
