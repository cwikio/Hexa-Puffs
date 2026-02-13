# Tooling for Cron & Skills — Architecture Comparison

## Problems Identified (Feb 13, 2026)

1. **Playbook keywords too narrow** — `"every three minutes"` doesn't match `"every minute"` keyword
2. **LLM hallucinated tool name** — `create_job` stored `get_status` for a news search task
3. **Stale hardcoded tool list** — `create_job` description lists 30 tools, actual system has 148+
4. **No validation at creation** — `create_job` accepts any tool name, fails at execution time

---

## Diagram 1: OpenClaw Architecture

![OpenClaw Architecture](diagram-openclaw.svg)

**Key design choices:**
- Cron stores **messages**, not tool calls — LLM reasons at execution time
- **All tools always in context** — no tool selector, no catalog lookup needed
- No intent classifier — LLM decides everything from tool descriptions
- Aggressive **input normalization** forgives LLM formatting mistakes
- Resilience: exponential backoff, auto-disable after 3 failures, stuck detection

---

## Diagram 2: Annabelle Current Architecture

![Annabelle Current Architecture](diagram-annabelle-current.svg)

**Failure points (red):**
1. Playbook classifier uses exact keyword matching — `"every three hours"` doesn't match any keyword
2. Without the playbook, LLM never gets structured instructions or `get_tool_catalog`
3. `create_job` has stale hardcoded tool list (30 tools, missing `searcher_news_search`)
4. No validation of `action.toolName` — hallucinated name gets stored
5. Cron executor fails at runtime — `get_status` is a custom handler, not in ToolRouter

---

## Diagram 3: Proposed Architecture

![Annabelle Proposed Architecture](diagram-annabelle-proposed.svg)

**What changes (green = new/fixed):**

| Component | Location | Change |
|-----------|----------|--------|
| Playbook Classifier | **Thinker** | Keyword matching → embedding similarity |
| `create_job` validation | **Orchestrator** | Validates `action.toolName` against ToolRouter + custom handlers |
| `create_job` description | **Orchestrator** | Dynamic tool list from ToolRouter (or reference `get_tool_catalog`) |
| Cron Executor | **Orchestrator** | New `agentTurn` mode — dispatches message to Thinker instead of raw tool call |
| `get_tool_catalog` | **Orchestrator** | Already done — used by playbook for tool discovery |
| `required_tools` validation | **Orchestrator** | Already done — warns on unknown tools in `memory_store_skill` |

**What stays the same:**
- Skill execution path (Memorizer stores, Inngest fires, Thinker executes)
- Tool routing (ToolRouter with prefixed names)
- Embedding tool selector (picks tools per message)
- Regex tool groups (core, search, jobs, memory)

---

## Change Summary

### Phase 1: Quick wins (prevent broken jobs)
1. **Validate `create_job` tool names** — same pattern as `memory_store_skill` validation
2. **Dynamic tool list in `create_job` description** — replace stale `AVAILABLE_TOOLS_DESCRIPTION`

### Phase 2: Fix playbook activation
3. **Embedding-based playbook matching** — replace keyword regex with cosine similarity in `playbook-classifier.ts`

### Phase 3: Robust execution
4. **`agentTurn` cron payload** — new job type that dispatches to Thinker at execution time
5. **Merge SKILL and complex CRON** — playbook steers complex scheduling to skills, simple to `tool_call` cron jobs

### Comparison with OpenClaw

| Aspect | OpenClaw | Annabelle Current | Annabelle Proposed |
|--------|----------|-------------------|-------------------|
| Intent routing | LLM only | Keyword classifier | Embedding classifier + LLM |
| Tool discovery | All tools in context always | Embedding selector (top-K) | Embedding selector + `get_tool_catalog` for scheduling |
| Cron payloads | Messages only | Tool calls only | Both (tool_call + agentTurn) |
| Tool validation | None (no tool names stored) | None | At creation time |
| NL → cron | LLM does it | LLM does it | LLM does it |
| Error resilience | Exponential backoff + auto-disable | Retry every fire, errors forever | Add backoff + auto-disable |
| Skill system | Markdown files, LLM reads on demand | DB-stored, Inngest-fired, LLM-executed | Same (already strong) |

---

## Diagram 4: Proposed Architecture v2 — Skills Only (No Cron Jobs)

![Annabelle Proposed v2 — Skills Only](diagram-annabelle-proposed-v2.svg)

**Core change**: Eliminate cron jobs entirely. Everything is a skill. Inngest remains the single scheduler.

### What gets removed (red dashed box in diagram)

| Removed | Why |
|---------|-----|
| `create_job` tool | Replaced by `memory_store_skill` |
| `list_jobs` / `delete_job` / `get_job_status` tools | Replaced by `memory_list_skills` / `memory_delete_skill` / `memory_get_skill` |
| Job Storage (`~/.annabelle/data/jobs/*.json`) | Skills are already in Memorizer SQLite |
| Cron job poller loop (functions.ts lines 208-330) | Skill poller (lines 464-760) already handles everything |
| `executor.ts` backward compat map | No more raw tool calls from cron |
| SKILL vs CRON JOB classification in playbook | All scheduling = skill |
| `AVAILABLE_TOOLS_DESCRIPTION` hardcoded list | `get_tool_catalog` is the single source of truth |

### What stays

| Kept | Role |
|------|------|
| **Inngest** | Single scheduler — skill poller fires every minute |
| **Memorizer** | Single store — skills with schedule, instructions, required_tools |
| **Thinker** | Single executor — LLM reasons at fire time with required_tools |
| **Playbook** | Simplified — all scheduling goes through `get_tool_catalog` → `memory_store_skill` |
| **ToolRouter** | Unchanged — routes tool calls to MCPs |
| **`get_tool_catalog`** | Tool discovery for the LLM at skill creation time |
| **`required_tools` validation** | Warns on unknown tools at creation time |
| **Failure cooldown** | Already in skill poller (5-min backoff) |
| **Calendar pre-flight** | Already in skill poller for meeting skills |

### The unified flow

**Creation** (user says "send hello every minute"):
1. Embedding classifier activates cron-scheduling playbook
2. Playbook has NO classification step — everything is a skill
3. LLM calls `get_tool_catalog` → picks `telegram_send_message`
4. LLM calls `memory_store_skill` with:
   - `instructions: "Send 'hello' via Telegram"`
   - `required_tools: ["telegram_send_message"]`
   - `trigger_config: { schedule: "*/1 * * * *" }`
   - `max_steps: 2`
5. Orchestrator validates required_tools against ToolRouter

**Execution** (Inngest fires every minute):
1. Skill poller loads enabled cron skills from Memorizer
2. Checks schedule via croner — skill is due
3. Dispatches to Thinker with instructions + required_tools
4. LLM reads instructions, calls `telegram_send_message`
5. Updates `last_run_at`, `last_run_status`, `last_run_summary`

**Simple vs complex** — the only difference is `max_steps`:
- Simple ("send hello"): `max_steps: 2`, ~500 tokens, ~0.2s on Groq
- Complex ("check emails, classify, notify"): `max_steps: 10`, ~3000 tokens, ~2s on Groq

### Why this is better

1. **Single concept** — no more "is this a cron job or a skill?" confusion
2. **Single store** — Memorizer SQLite, not JSON files on disk
3. **Single poller** — already handles schedules, cooldown, calendar pre-flight, notifications
4. **Tool names resolved at runtime** — LLM picks tools when the skill fires, never hardcoded
5. **Validated at creation** — `required_tools` checked against ToolRouter
6. **Editable** — `memory_update_skill` lets you change instructions, schedule, tools
7. **Observable** — `last_run_at`, `last_run_status`, `last_run_summary` tracked per skill
8. **Already built** — the skill poller is more mature than the cron job executor (cooldown, pre-flight, notification)

---

### OpenClaw vs Annabelle Proposed v2

| Aspect | OpenClaw | Annabelle Proposed v2 | Winner |
|--------|----------|----------------------|--------|
| **Scheduling concept** | Cron jobs with message payloads | Skills with instructions + required_tools | Annabelle — skills are richer (validated tools, editable instructions, run history) |
| **Intent routing** | None — LLM decides from tool descriptions | Embedding-based playbook classifier | Annabelle — playbook injects structured workflow, not just hoping LLM figures it out |
| **Tool discovery at creation** | All tools always in LLM context (~15 core tools) | `get_tool_catalog` returns 148+ tools grouped by MCP | Annabelle — scales better; OpenClaw works because it has fewer tools |
| **Tool validation** | None — no tool names stored in jobs | `required_tools` checked against ToolRouter at creation | Annabelle — catches errors before execution |
| **Storage** | JSON5 files on disk | SQLite via Memorizer MCP | Annabelle — queryable, relational, supports filtering/search |
| **Execution model** | LLM reasons at fire time (always) | LLM reasons at fire time (always) | Tie — same approach |
| **Token cost** | Every job fires an LLM call | Every skill fires an LLM call | Tie — same tradeoff |
| **Error resilience** | Exponential backoff (30s→1m→5m→15m→60m), auto-disable after 3 failures | 5-min failure cooldown, Telegram notification on error | OpenClaw — more graduated backoff; Annabelle could adopt this |
| **Schedule types** | 3 kinds: `at` (one-shot), `every` (interval), `cron` (expression) | 2 kinds: `schedule` (cron expression), `interval_minutes` | OpenClaw — `at` (one-shot) is useful; Annabelle has `scheduled` jobs but losing them in this merge |
| **Input normalization** | Aggressive — fixes casing, flattened params, legacy fields | Minimal — trusts LLM output structure | OpenClaw — LLMs produce malformed JSON; normalization prevents silent failures |
| **Observability** | Job status only | `last_run_at`, `last_run_status`, `last_run_summary` per skill | Annabelle — run summary gives human-readable history |
| **Skill system** | Markdown files on disk, LLM reads on demand | DB-stored, Inngest-fired, LLM-executed with required_tools | Annabelle — required_tools scoping means the LLM only sees tools it needs |
| **NL → schedule** | LLM converts directly, tool description is the schema guide | LLM converts via playbook instructions | Tie — both work; playbook adds guardrails |
| **Multi-step execution** | Agent session with full tool access | Thinker with `max_steps` limit and required_tools scoping | Annabelle — `max_steps` prevents runaway, required_tools reduces hallucination |
| **Notification** | None built-in for job completion | `notify_on_completion` sends Telegram summary | Annabelle — user knows what happened |
| **Calendar awareness** | None | Pre-flight check skips meeting skills when no events | Annabelle — avoids wasting LLM calls on empty days |

**Summary**: OpenClaw is simpler (fewer moving parts, no classifier, no validation) which works well for its ~15 core tools. Annabelle's proposed v2 is more structured but handles a larger tool surface (148+) more safely. The main things to steal from OpenClaw:

1. **Graduated exponential backoff** — replace flat 5-min cooldown with 30s→1m→5m→15m→60m
2. **Input normalization** — add a normalizer for `memory_store_skill` that fixes common LLM mistakes (wrong casing, flattened trigger_config, missing fields)
3. **One-shot `at` schedule** — add support for "remind me at 3pm today" as a skill with `trigger_config: { at: "2026-02-13T15:00:00" }` that auto-deletes after firing
