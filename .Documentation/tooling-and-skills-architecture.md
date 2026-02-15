# Tooling & Skills Architecture

> How skills are created, validated, scheduled, and executed across the Annabelle ecosystem. Covers the two-tier execution model, practical usage, input normalization, tool argument pipeline, and the evolution from cron jobs to unified skills.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Execution Tiers](#execution-tiers)
3. [Creating & Managing Skills](#creating--managing-skills)
4. [Skill Creation Flow](#skill-creation-flow)
5. [Skill Execution Flow](#skill-execution-flow)
6. [Tool Argument Normalization](#tool-argument-normalization)
7. [Resilience](#resilience)
8. [Tool Catalog & Discovery](#tool-catalog--discovery)
9. [SKILL.md File-Based Skills](#skillmd-file-based-skills)
10. [Other Inngest Functions](#other-inngest-functions)
    - [Background Jobs](#background-jobs-queue_task)
11. [Timezone Handling](#timezone-handling)
12. [Evolution: Cron Jobs to Unified Skills](#evolution-cron-jobs-to-unified-skills)
13. [Key Files Reference](#key-files-reference)

---

## Architecture Overview

![Skill Architecture v3](diagrams/skill-architecture-v3.svg)

All scheduled tasks in Annabelle are **skills** — stored in Memorizer SQLite, scheduled via Inngest, executed via either direct tool calls (zero LLM cost) or Thinker agent reasoning (sandboxed LLM). There is no separate "cron job" concept.

```
User says "remind me to drink water every hour"
        │
        ▼
   ┌─────────┐        ┌──────────────┐        ┌────────────┐
   │ Thinker │──────▶│ Orchestrator  │──────▶│ Memorizer  │
   │         │  calls │  normalizes   │ stores │  SQLite    │
   │ playbook│  tool  │  validates    │ skill  │            │
   └─────────┘        └──────────────┘        └──────┬─────┘
                                                      │
                                               Inngest fires
                                               every 1 minute
                                                      │
                                               ┌──────▼─────┐
                                               │ Tier Router │
                                               └──┬──────┬──┘
                                                  │      │
                                          ┌───────▼┐  ┌──▼──────┐
                                          │ Direct │  │  Agent  │
                                          │ ~5ms   │  │  ~2s    │
                                          │ 0 LLM  │  │  LLM    │
                                          └────────┘  └─────────┘
```

---

## Execution Tiers

Skills support two execution tiers, selected automatically based on whether `execution_plan` is present:

| | Direct Tier | Agent Tier |
|---|---|---|
| **LLM involved** | No — direct tool call | Yes — Thinker reasons through instructions |
| **Use for** | Static reminders, fixed notifications | Multi-step workflows, decision-making |
| **Cost** | Zero tokens per fire | LLM tokens per execution |
| **Latency** | ~5ms | ~2-5s (depends on LLM + tools) |
| **Key field** | `execution_plan` (compiled steps) | `instructions` (natural language) |
| **Tool access** | Only tools in the plan | Strict sandbox: only `required_tools` |
| **Examples** | "Send 'Drink water!' at 9am" | "Check inbox, summarize urgent emails" |

### Tier Classification

The LLM decides the tier at **creation time** based on task complexity:

| User says | Tier | Stored as | Fire cost |
|-----------|------|-----------|-----------|
| "Send hello every minute" | Direct | `execution_plan: [{tool: "telegram_send_message", params: {message: "hello"}}]` | ~0 tokens, ~5ms |
| "Remind me at 3pm about dentist" | Direct (one-shot) | `execution_plan` + `trigger_config: {at: "..."}` | ~0 tokens, fires once |
| "Search AI news every 3 hours, summarize" | Agent | `instructions: "Search latest AI news..."` + `required_tools: [...]` | ~500-2000 tokens |
| "Check emails, classify urgent, draft replies" | Agent | `instructions: "..."` + `required_tools: [...]` + `max_steps: 10` | ~2000-5000 tokens |

**Decision rule:** If the task can be expressed as a fixed sequence of tool calls with static params → Direct. If it needs reasoning, summarization, classification, or dynamic content → Agent.

### Safety Net

If an `execution_plan` with more than 1 step is submitted, the system auto-converts it to Agent tier:

```
Orchestrator/src/routing/tool-router.ts (lines 445-462)
```

- Strips the `execution_plan` from args
- Populates `required_tools` from the plan's tool names
- Forces Agent tier execution

**Rationale:** Direct tier uses `executeWorkflow()` which has no result piping between steps. A multi-step plan would send literal `{{step1.result}}` instead of actual data. Converting to Agent tier lets the LLM reason about intermediate results.

---

## Creating & Managing Skills

### Creating via Thinker (recommended)

Tell the Thinker what you want scheduled via Telegram:

- "Check my inbox every hour and notify me of urgent emails"
- "Set up a daily morning briefing at 6am"
- "Remind me to drink water every hour"
- "Remind me in 5 minutes to call the dentist"

The Thinker activates the `cron-scheduling` playbook, which guides it through:

1. **Parse schedule** — Determine one-shot (`in_minutes`, `at`) vs recurring (`schedule`, `interval_minutes`)
2. **Discover tools** — Call `get_tool_catalog` to see all available tools
3. **Classify** — Simple fixed action → Direct tier with `execution_plan`. Complex reasoning → Agent tier with `instructions`
4. **Create** — Call `memory_store_skill` (the Orchestrator normalizes and validates)

See [Skill Creation Flow](#skill-creation-flow) for the internal details.

### Creating via direct tool call

Direct tier example (zero LLM cost — static tool call):

```json
memory_store_skill({
  "name": "Drink water reminder",
  "trigger_type": "cron",
  "trigger_config": { "schedule": "0 * * * *" },
  "instructions": "Send a reminder to drink water",
  "required_tools": ["telegram_send_message"],
  "execution_plan": [{
    "id": "step1",
    "toolName": "telegram_send_message",
    "parameters": { "message": "Drink water!" }
  }],
  "notify_on_completion": false
})
```

Agent tier example (LLM reasoning at fire time):

```json
memory_store_skill({
  "name": "Morning Briefing",
  "trigger_type": "cron",
  "trigger_config": { "schedule": "0 6 * * *" },
  "instructions": "Check unread emails, summarize the top 5, and send a briefing via Telegram.",
  "required_tools": ["gmail_list_messages", "gmail_get_message", "telegram_send_message"],
  "max_steps": 15,
  "notify_on_completion": true
})
```

### Fields

**Required:** `name`, `trigger_type`, `instructions`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `trigger_config` | JSON | — | Schedule config. See [Trigger Configuration](#trigger-configuration). |
| `required_tools` | string[] | — | Exact tool names from `get_tool_catalog`. Validated at creation time. Used for auto-enable logic and Agent tier sandboxing. |
| `execution_plan` | object[] | — | Compiled tool call steps. When present → Direct tier (zero LLM cost). Each step: `{ id, toolName, parameters }`. |
| `max_steps` | integer | 10 | Max LLM reasoning steps for Agent tier. |
| `notify_on_completion` | boolean | true | Scaffolded for future use. Currently only failure notifications are implemented. |
| `notify_interval_minutes` | integer | 0 | Scaffolded for notification throttling (0 = use `SKILL_NOTIFY_INTERVAL_MINUTES` env default). Not yet implemented. |
| `agent_id` | string | "thinker" | Which agent owns the skill. |
| `enabled` | boolean | true | Set false to create disabled; auto-enables when `required_tools` become available. |
| `description` | string | — | Brief description of what the skill does. |

### Management tools

| Tool | Purpose |
|------|---------|
| `memory_store_skill` | Create a new skill |
| `memory_update_skill` | Update any field (enable/disable, change schedule, etc.) |
| `memory_list_skills` | List skills with optional filters (enabled, trigger_type, agent_id) |
| `memory_get_skill` | Get a single skill by ID |
| `memory_delete_skill` | Delete a skill by ID |

### Trigger types

| Type | Description |
|------|-------------|
| `cron` | Scheduled — cron expression, fixed interval, or one-shot timestamp |
| `event` | Event-driven — keyword-matched playbook skills |
| `manual` | On-demand only — never auto-triggered |

### Trigger configuration

**Cron expression** (precise recurring):

```json
{ "schedule": "0 9 * * *" }
```

Timezone is auto-injected by the Memorizer at creation time from the system timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`). Only specify `timezone` if the user explicitly requests a different one.

**Interval** (every-N-minutes recurring):

```json
{ "interval_minutes": 30 }
```

Fires when `now - last_run_at >= interval_minutes`. No timezone needed.

**One-shot absolute** (fires once at a specific time):

```json
{ "at": "2026-02-14T15:00:00" }
```

Fires once when `now >= at`, then auto-disables.

**One-shot relative** (fires once, N minutes from now):

```json
{ "in_minutes": 10 }
```

The normalizer converts this to an absolute `at` timestamp at creation time. Also supports `{ "in_hours": 2 }`.

> **Important:** "remind me IN 5 minutes" = one-shot `{ "in_minutes": 5 }`. "remind me EVERY 5 minutes" = recurring `{ "schedule": "*/5 * * * *" }`. The `in_minutes` format exists specifically because LLMs tend to confuse these two patterns.

### Schema

```sql
id                      INTEGER PRIMARY KEY
agent_id                TEXT (default: "main", most skills use "thinker")
name                    TEXT
description             TEXT
enabled                 INTEGER (0/1)
trigger_type            TEXT ("cron" | "event" | "manual")
trigger_config          TEXT (JSON — schedule, interval_minutes, at, or in_minutes)
instructions            TEXT (natural language for the LLM)
required_tools          TEXT (JSON array of tool names)
execution_plan          TEXT (JSON array of tool call steps — Direct tier)
max_steps               INTEGER (default: 10)
notify_on_completion    INTEGER (0/1, default: 1)
notify_interval_minutes INTEGER (default: 0)
last_run_at             TEXT (ISO datetime)
last_run_status         TEXT ("success" | "error")
last_run_summary        TEXT
last_notified_at        TEXT (ISO datetime)
created_at              TEXT
updated_at              TEXT
```

### Default skills (from seed)

All default skills start `enabled: false` and auto-enable when their `required_tools` become available.

| Skill | Schedule | Max Steps | Required Tools |
|-------|----------|-----------|----------------|
| Email Processor | Every 60 min | 15 | `gmail_get_new_emails`, `memory_list_contacts`, `memory_list_projects` |
| Morning Briefing | 6:00 AM ET | 15 | `gmail_list_events`, `gmail_get_new_emails`, `memory_list_projects`, `memory_list_facts` |
| Evening Recap | 6:00 PM ET | 12 | `gmail_list_events`, `gmail_list_emails`, `memory_list_facts` |
| Weekly Digest | Sun 6:00 PM ET | 15 | `gmail_list_events`, `gmail_list_emails`, `memory_list_projects` |
| Follow-up Tracker | 9:00 AM ET | 10 | `gmail_list_emails`, `memory_list_contacts`, `memory_list_projects` |
| Pre-meeting Prep | Every 15 min | 10 | `gmail_list_events`, `memory_list_contacts`, `memory_list_projects`, `gmail_list_emails`, `memory_list_facts` |
| Meeting Overload Warning | 8:00 PM ET | 6 | `gmail_list_events` |

Additional skills can be created at runtime via Thinker or direct tool calls.

Event-driven skills (playbooks): `email-triage`, `email-compose`, `schedule-meeting`, `research-and-share`, `telegram-conversation`, `memory-recall`, `file-operations`, `daily-briefing`, `contact-lookup`, `email-classify`, `system-health-check`, `message-cleanup`, `cron-scheduling`, `web-browsing`, `vercel-deployments`.

---

## Skill Creation Flow

![Skill Creation Flow](diagrams/skill-creation-flow.mmd)

```mermaid
sequenceDiagram
    participant U as User
    participant T as Thinker
    participant LLM as LLM
    participant O as Orchestrator
    participant M as Memorizer

    U->>T: "Remind me to drink water every hour"
    T->>T: Playbook classifier → cron-scheduling
    T->>LLM: Playbook + user message
    LLM->>O: get_tool_catalog()
    O-->>LLM: 148+ tools by MCP
    LLM->>O: memory_store_skill(...)
    O->>O: normalizeSkillInput()
    O->>O: validateCronExpression()
    O->>O: Safety net check
    O->>M: Store skill
    M-->>LLM: { success: true }
    LLM-->>U: "Done! Reminder set."
```

### Creation Steps

1. **Playbook activation** — The Thinker's playbook classifier matches the message (e.g., "remind me", "every hour") to the `cron-scheduling` playbook. The playbook is injected into the system prompt with structured instructions.

2. **Tool discovery** — The playbook forces inclusion of `get_tool_catalog` and `memory_store_skill`. The LLM calls `get_tool_catalog` to discover all available tools before creating the skill.

3. **Tier classification** — The LLM decides: simple fixed action → build `execution_plan` (Direct tier). Complex task needing decisions → write `instructions` (Agent tier).

4. **Input normalization** — The Orchestrator's `normalizeSkillInput()` (`Orchestrator/src/utils/skill-normalizer.ts`) fixes common LLM mistakes before storage:

   | Fix | Example |
   |-----|---------|
   | Re-nest flattened trigger_config | `{ schedule: "0 * * * *" }` at root → moved into `trigger_config` |
   | Normalize aliases | `cronExpression` → `schedule`, `intervalMinutes` → `interval_minutes` |
   | Convert relative times | `{ in_minutes: 5 }` → `{ at: "2026-02-14T15:05:00" }` |
   | Parse string arrays | `"[\"tool_a\"]"` → `["tool_a"]` |
   | Parse notify_on_completion | `"true"` → `true` |
   | Default agent_id | Missing → `"thinker"` |

5. **Validation** — Cron expressions are validated via `croner` at creation time. Bad expressions are rejected immediately (not at fire time). `required_tools` are checked against ToolRouter.

6. **Storage** — Skill is stored in Memorizer SQLite. If `execution_plan` has >1 step, it's auto-converted to Agent tier (safety net).

---

## Skill Execution Flow

See [diagrams/skill-execution-flow.mmd](diagrams/skill-execution-flow.mmd) for the full flowchart.

```
Orchestrator/src/jobs/skill-scheduler.ts — skillSchedulerFunction
```

The scheduler runs every minute via Inngest:

### Step 0: Auto-Enable

Disabled skills with `required_tools` are automatically re-enabled when all their tools become available (e.g., after an MCP reconnects). One-shot skills (those with `trigger_config.at`) are skipped — they should not be re-enabled after intentional disable.

### Step 1: Schedule Check

For each enabled cron skill, check if it's due:
- **Cron expression:** Parse with timezone, check if `nextRun` falls in current minute
- **Interval:** Check if `now - last_run_at >= interval_minutes`
- **One-shot:** Check if `now >= trigger_config.at` (fire once)

### Step 2: Graduated Backoff

After failures, retry delays increase progressively: **1 → 5 → 15 → 60 minutes**. After 5 consecutive failures, the skill is auto-disabled and a Telegram notification is sent. Failure counters are in-memory and reset on process restart.

### Step 3: Pre-flight Checks

**Calendar:** Meeting-related skills (name matches `/meeting|prep/i` AND requires `gmail_list_events`) check all calendars via free/busy API. No events in the next 2-hour window → skip silently (zero LLM cost).

**Email:** Email skills (name matches `/email/i` AND requires `gmail_get_new_emails`) check for new emails. No new emails → skip silently.

### Step 4: Tier Routing + Execution

**Direct Tier** (has `execution_plan`):
1. Parse execution plan from skill record
2. Call `executeWorkflow()` (`Orchestrator/src/jobs/executor.ts`) — sequential tool calls via ToolRouter
3. Auto-inject `chat_id` for `telegram_send_message` if missing
4. Zero LLM cost, ~5ms per fire

**Agent Tier** (has `instructions` only):
1. Dispatch to Thinker via `AgentManager.executeSkill()`
2. Thinker receives instructions + `required_tools` as strict sandbox (only those tools available)
3. LLM reasons, calls tools, produces summary
4. Costs LLM tokens per execution

### Post-Execution

- Update `last_run_at`, `last_run_status`, `last_run_summary` in Memorizer
- One-shot skills (`trigger_config.at`) auto-disable after firing
- On failure: send Telegram notification with error details, increment backoff counter
- On cost-pause: send Telegram alert, mark agent as paused
- Success notifications are not yet implemented (`notify_on_completion` and `notify_interval_minutes` fields exist in the schema but are not checked by the scheduler)

---

## Tool Argument Normalization

There are two normalization layers — one at skill creation time (Orchestrator-side) and one at tool call time (Thinker-side).

See [diagrams/tool-normalization-pipeline.mmd](diagrams/tool-normalization-pipeline.mmd) for a visual overview.

### Thinker-Side: Tool Call Normalization

```
Thinker/src/orchestrator/tools.ts
```

Every tool call from the LLM passes through this pipeline before reaching the Orchestrator:

```
args → coerceStringBooleans → stripNullValues → stripHallucinatedParams → injectChatId → Orchestrator
```

| Step | Function | What it fixes |
|------|----------|--------------|
| 1 | `coerceStringBooleans()` | `"true"` → `true`, `"false"` → `false` |
| 2 | `stripNullValues()` | Removes keys with `null` values (LLMs send `null` instead of omitting optional params) |
| 3 | `stripHallucinatedParams()` | Removes known hallucinated params (e.g., `teamId`/`slug` on `vercel_*` tools) |
| 4 | `injectChatId()` | Fixes `telegram_send_message` `chat_id`: replaces missing, non-string, or suspiciously long (>20 char) values with real primary chat_id from channel manager |

Additionally, `relaxSchemaTypes()` modifies JSON Schema definitions sent to the LLM:

- Numeric types also accept strings (`"type": "number"` → `"type": ["number", "string"]`)
- Boolean types also accept strings
- Optional properties also accept `null`

### Orchestrator-Side: Skill Input Normalization

```
Orchestrator/src/utils/skill-normalizer.ts
```

Applied at creation time when `memory_store_skill` or `memory_update_skill` is called:

| Step | What it fixes |
|------|--------------|
| Re-nest flattened fields | `schedule`, `interval_minutes`, `at`, `in_minutes` at root → moved into `trigger_config` |
| Normalize aliases | `cronExpression` → `schedule`, `intervalMinutes` → `interval_minutes` |
| Convert relative times | `in_minutes: 5` → `at: "2026-02-14T15:05:00"` (absolute ISO timestamp) |
| Infer trigger_type | Sets `trigger_type: "cron"` if `schedule`, `interval_minutes`, or `at` exists |
| Parse required_tools | JSON string → array, plain string → `[str]` |
| Parse max_steps | String → number |
| Parse notify_on_completion | String → boolean |
| Default agent_id | Missing → `"thinker"` |

---

## Resilience

### Graduated Backoff

```
Orchestrator/src/utils/skill-normalizer.ts — getBackoffMinutes(), recordFailure(), recordSuccess()
```

Replaces the old flat 5-minute cooldown with progressive retry delays:

| Consecutive failures | Backoff | What happens |
|---------------------|---------|--------------|
| 1 | 1 minute | Quick retry — may be transient |
| 2 | 5 minutes | Moderate delay |
| 3 | 15 minutes | Longer delay |
| 4 | 60 minutes | Last chance |
| 5 | Auto-disable | Skill disabled + Telegram notification |

Failure counters are stored in-memory (`Map<number, number>`) and reset on process restart.

### Ollama Health Monitoring

```
Orchestrator/src/jobs/skill-scheduler.ts (lines 152-206)
```

The skill scheduler includes a rate-limited Ollama health check on every run (every minute):
- Pings `${OLLAMA_URL}/api/tags` with 3s timeout
- One-time Telegram alert when Ollama becomes unreachable
- Recovery notification when Ollama comes back online
- State tracked in `~/.annabelle/data/ollama-alert-state.json`

### Cost Controls Integration

If the Thinker's token usage spikes during a skill execution, the agent is auto-paused via the cost monitor. A Telegram notification is sent with the reason, token counts, and thresholds. See [cost-controls.md](cost-controls.md) for details.

---

## Tool Catalog & Discovery

### get_tool_catalog

```
Orchestrator/src/tools/tool-catalog.ts
```

A lightweight tool for LLMs to discover available tools before creating skills. Returns tool names + short descriptions (first sentence only), grouped by MCP, sorted alphabetically:

```json
{
  "success": true,
  "data": {
    "summary": "142 tools across 8 MCP servers",
    "catalog": {
      "telegram": [
        { "name": "telegram_send_message", "description": "Send a message to a Telegram chat." }
      ],
      "gmail": [
        { "name": "gmail_send_email", "description": "Send an email." }
      ]
    }
  }
}
```

This replaces the old `AVAILABLE_TOOLS_DESCRIPTION` hardcoded list that only listed 30 of 148+ tools. The catalog is dynamic — always reflects the current ToolRouter state.

### Tool Refresh at Runtime

The Thinker has a 10-minute TTL cache for tools fetched from the Orchestrator (`GET /tools/list`). When MCPs are added or removed (via auto-discovery or hot-reload), the Thinker picks up the changes within 10 minutes without requiring a restart.

---

## SKILL.md File-Based Skills

```
~/.annabelle/skills/*/SKILL.md
```

File-based skills follow the [agentskills.io](https://agentskills.io/specification) specification with Annabelle extensions in the `metadata` block.

### Format

```yaml
---
name: code-review
description: Reviews code for quality, security, and best practices
metadata:
  keywords: [review, code review, audit]
  priority: 5
  required_tools: [filer_read_file, codexec_execute_code]
---

## Instructions

1. Read the specified file using filer_read_file
2. Analyze the code for...
```

### Two Roles

File-based skills serve two purposes:

**1. Playbook injectors** (event-triggered) — Skills with `keywords` participate in playbook classification. When the user's message matches, the skill's instructions are injected into the system prompt as workflow guidance.

**2. Scheduled executors** (cron-triggered) — Skills with `trigger_config` in their metadata auto-register in Memorizer and execute on schedule:

```yaml
metadata:
  required_tools:
    - searcher_news_search
    - telegram_send_message
  trigger_config:
    schedule: "0 */3 * * *"
  max_steps: 5
```

On startup + every 5-minute refresh:
- `SkillLoader` detects `trigger_config` in frontmatter
- If no matching DB skill exists → auto-creates via `memory_store_skill`
- If DB skill exists and file is newer → updates via `memory_update_skill`
- If file is deleted → disables the DB skill

This means you can **git-manage scheduled skills** — version control, deploy by copying files, share via the agentskills.io standard.

### Progressive Disclosure

Skills **without keywords** are not eligible for playbook classification. Instead, they appear as brief `<available_skills>` XML descriptions in the system prompt, telling the LLM what capabilities exist without bloating the prompt.

---

## Other Inngest Functions

Beyond the skill scheduler, the Orchestrator registers these Inngest functions:

| Function | Schedule | Purpose |
|----------|----------|---------|
| `backgroundJobFunction` | Event-driven | Executes one-off background tasks (queued via `queue_task` tool) |
| `conversationBackfillFunction` | Event-driven | Extracts facts from old conversations that were never processed |
| `memorySynthesisFunction` | Sun 3:00 AM | Weekly fact consolidation — merges duplicates, resolves contradictions |
| `healthReportFunction` | Every 6 hours | Runs `/diagnose` checks, compares with last report, sends Telegram alert on changes |

### Background Jobs (`queue_task`)

```
Orchestrator/src/tools/jobs.ts — queue_task tool
Orchestrator/src/jobs/background-job.ts — backgroundJobFunction
Orchestrator/src/jobs/storage.ts — TaskStorage (file-based)
```

Background jobs are one-off tasks that execute asynchronously via Inngest. They're used when the Thinker or a skill needs to fire-and-forget a tool call without blocking the conversation.

**Queuing:**

The `queue_task` tool accepts a task name and an action:

```json
{
  "name": "Send greeting",
  "action": {
    "type": "tool_call",
    "toolName": "telegram_send_message",
    "parameters": { "message": "Hello!", "chat_id": "123456789" }
  }
}
```

Action types: `tool_call` (single tool) or `workflow` (multi-step with `workflowSteps`).

Returns a `taskId` immediately. Use `get_job_status` to poll for completion.

**Execution:**

```
queue_task called
    │
    ├── Save task to disk (status: queued)
    ├── Send Inngest event: job/background.execute
    │
    ▼
backgroundJobFunction fires
    │
    ├── Halt check (skip if /kill inngest active)
    ├── Load task, set status: running
    ├── executeAction() via executor.ts
    │
    ├── Success: status: completed, save result + duration
    └── Failure: status: failed, save error
               └── Store error fact in Memory MCP
                   (category: 'error', agent_id: 'orchestrator')
```

**Configuration:**

| Setting | Value | Description |
|---------|-------|-------------|
| Concurrency | 10 | Max parallel background jobs |
| Retries | 3 | Inngest auto-retries on failure |
| Storage | `~/.annabelle/data/tasks/` | JSON files, one per task |

**Task lifecycle:** `queued → running → completed` or `queued → running → failed`

On failure, the error message is stored as a fact in Memorizer (category `error`) via `storeErrorFact()`, making it searchable in memory for debugging.

---

## Timezone Handling

- Timezone is auto-injected by the Memorizer when a skill is created or updated. If `trigger_config` has a `schedule` (cron expression) but no `timezone`, the system timezone is added automatically. User-specified timezones are respected.
- **System timezone**: Detected at runtime via `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- The Thinker's `cron-scheduling` playbook instructs the LLM to omit timezone (auto-detected) unless the user specifies one.

---

## Evolution: Cron Jobs to Unified Skills

### What Was Removed

| Removed | Replaced by |
|---------|-------------|
| `create_job` tool | `memory_store_skill` |
| `list_jobs` / `delete_job` / `get_job_status` tools | `memory_list_skills` / `memory_delete_skill` / `memory_get_skill` |
| Job storage (`~/.annabelle/data/jobs/*.json`) | Memorizer SQLite skills table |
| Cron job poller loop (`functions.ts` lines 208-330) | Skill scheduler (`skill-scheduler.ts`) |
| `executor.ts` backward compat map | Direct tier via `executeWorkflow()` |
| SKILL vs CRON JOB classification in playbook | All scheduling = skill |
| `AVAILABLE_TOOLS_DESCRIPTION` hardcoded list | `get_tool_catalog` (dynamic, from ToolRouter) |

### What Stayed

| Kept | Role |
|------|------|
| **Inngest** | Single scheduler — fires every minute |
| **Memorizer** | Single store — skills with schedule, instructions, required_tools |
| **Thinker** | Single executor — LLM reasons at fire time with required_tools |
| **Playbook** | Simplified — all scheduling goes through `get_tool_catalog` → `memory_store_skill` |
| **ToolRouter** | Unchanged — routes tool calls to MCPs |
| **required_tools validation** | Validates against ToolRouter at creation time |
| **Calendar pre-flight** | Skips meeting skills when no events |

### What Was Added

| New | Purpose |
|-----|---------|
| **Direct tier** | Zero-LLM execution for simple skills via `executeWorkflow()` |
| **Tier router** | Examines `execution_plan` presence to choose Direct vs Agent |
| **Input normalizer** | Fixes LLM formatting mistakes before storage |
| **Cron expression validation** | Validates via `croner` at creation time, not fire time |
| **Graduated backoff** | 1 → 5 → 15 → 60 min progressive retry + auto-disable after 5 failures |
| **One-shot `at` schedule** | "Remind me at 3pm" — fires once, auto-disables |
| **`get_tool_catalog`** | Dynamic tool discovery (replaces stale hardcoded list) |
| **Strict tool sandboxing** | Agent tier skills get ONLY `required_tools`, nothing else |
| **Safety net** | Multi-step `execution_plan` auto-converts to Agent tier |

### Why This Is Better

| Concern | Before (v2) | After (v3) |
|---------|-------------|------------|
| "Send hello" fires every minute | ~500 tokens per fire (LLM) | ~0 tokens (Direct tier) |
| 20 simple skills x 1440 fires/day | ~14.4M tokens/day | ~0 tokens/day |
| "Remind me at 3pm" | Not supported | One-shot `at` schedule, auto-disables |
| Bad cron expression | Stored, fails at fire time | Rejected at creation time |
| LLM malformed input | Stored as-is | Normalizer fixes before storage |
| Skill starts failing | Retries every fire, error spam | Graduated backoff + auto-disable |
| "Is this a cron job or a skill?" | Two confusing systems | Single concept: skill |

---

## Key Files Reference

| Component | File | Purpose |
|-----------|------|---------|
| Skill Scheduler | `Orchestrator/src/jobs/skill-scheduler.ts` | Inngest poller, auto-enable, schedule check, pre-flight, tier routing |
| Skill Normalizer | `Orchestrator/src/utils/skill-normalizer.ts` | Input normalization, cron validation, graduated backoff |
| Direct Tier Executor | `Orchestrator/src/jobs/executor.ts` | `executeWorkflow()`, `executeToolCall()` |
| Tool Catalog | `Orchestrator/src/tools/tool-catalog.ts` | `get_tool_catalog` — dynamic tool discovery |
| Tool Router (safety net) | `Orchestrator/src/routing/tool-router.ts` | Multi-step plan auto-conversion to Agent tier |
| Tool Normalization | `Thinker/src/orchestrator/tools.ts` | `relaxSchemaTypes()`, `stripNullValues()`, `injectChatId()` |
| Agent Loop | `Thinker/src/agent/loop.ts` | `processProactiveTask()` — Agent tier execution |
| Playbook Classifier | `Thinker/src/agent/playbook-classifier.ts` | Keyword matching for playbook activation |
| Playbook Cache | `Thinker/src/agent/playbook-cache.ts` | DB + file skill merging, 5-min refresh |
| Skill Loader | `Thinker/src/agent/skill-loader.ts` | SKILL.md parsing, trigger_config extraction |
| Skill Schema | `Memorizer-MCP/src/db/schema.ts` | `SkillRow` interface, skills table |
| Skill Seeding | `_scripts/seed-cron-skills.ts` | Default skill definitions |
| Thinker Client | `Orchestrator/src/agents/thinker-client.ts` | `executeSkill()` HTTP call |
| Cron Scheduling Playbook | `Thinker/src/agent/playbook-seed.ts` | Playbook instructions for skill creation |
| Background Jobs | `Orchestrator/src/jobs/background-job.ts` | `backgroundJobFunction` — async task execution |
| Memory Synthesis | `Orchestrator/src/jobs/memory-synthesis.ts` | Weekly fact consolidation |
| Health Report | `Orchestrator/src/jobs/health-report.ts` | Periodic `/diagnose` + Telegram alerts |
| Conversation Backfill | `Orchestrator/src/jobs/backfill.ts` | Extract facts from old conversations |

### Diagrams

| Diagram | File | Description |
|---------|------|-------------|
| Architecture v3 | [diagrams/skill-architecture-v3.mmd](diagrams/skill-architecture-v3.mmd) | Full v3 architecture (current, implemented) |
| Legacy Architecture | [diagrams/skill-architecture-legacy.mmd](diagrams/skill-architecture-legacy.mmd) | Pre-v3 architecture (historical reference) |
| Skill Creation Flow | [diagrams/skill-creation-flow.mmd](diagrams/skill-creation-flow.mmd) | User → Playbook → LLM → Normalizer → Memorizer |
| Skill Execution Flow | [diagrams/skill-execution-flow.mmd](diagrams/skill-execution-flow.mmd) | Inngest → Pre-flight → Tier Router → Direct/Agent |
| Normalization Pipeline | [diagrams/tool-normalization-pipeline.mmd](diagrams/tool-normalization-pipeline.mmd) | Both Thinker-side and Orchestrator-side pipelines |
