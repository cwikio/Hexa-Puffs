# V3 Architecture — Test Progress (Feb 14, 2026)

## Test scenario
User said "send hello every minute" → Thinker created skill `hello_every_minute` (ID 1302) with `execution_plan` → Direct tier executed it every minute → deleted via `memory_delete_skill`.

---

## Tested and working

| V3 Feature | Evidence |
|---|---|
| **Skill creation via conversation** | `memory_store_skill` created skill 1302 |
| **Direct execution tier** | "Executing skill via Direct tier" every minute, ~50ms per fire, zero LLM |
| **`execution_plan` compiled plan** | Stored as `[{tool: "send_telegram", params: {chat_id, message}}]`, executed directly |
| **Tier router** | Correctly routed to Direct tier (had `execution_plan`) |
| **`required_tools` validation** | "Skill created with unknown required_tools" logged at creation |
| **`execution_plan` validation** | "Skill execution_plan references unknown tools" logged at creation |
| **Input normalization** | `send_telegram` auto-normalized to `telegram_send_message` at execution time |
| **Skill deletion** | `memory_delete_skill` removed it cleanly |
| **Skill poller (Inngest)** | Fired every minute reliably |
| **`last_run_at/status/summary` tracking** | Updated after every execution |

## Automated E2E tests (Feb 14, 2026)

Two test files cover the scheduler pipeline end-to-end:

**`workflow-scheduler-e2e.test.ts`** (existing):
| Test | Status |
|---|---|
| Direct-tier skill via Inngest poller | ✅ Passed |
| One-shot `at` schedule + auto-disable | ✅ Passed |
| Invalid cron expression rejected at creation | ✅ Passed |
| Input normalization (flattened schedule → trigger_config) | ✅ Passed |
| Old cron job tools removed from tool list | ✅ Passed |

**`skill-tiers-e2e.test.ts`** (new):
| Test | Status |
|---|---|
| Agent-tier skill via Inngest poller (LLM stores fact) | ✅ Passed |
| Direct-tier with Telegram delivery | ⏳ Needs `E2E_TELEGRAM_CHAT_ID` |
| Tool sandboxing (requiredTools blocks excluded tools) | ✅ Passed |
| notify_on_completion Telegram notification | ⏳ Needs `E2E_TELEGRAM_CHAT_ID` |

## Not covered by automated tests

| V3 Feature | Reason |
|---|---|
| **Graduated backoff** | Unit-tested in `graduated-backoff.test.ts` (8 tests). E2E would need 5+ Inngest cycles (80+ min). |
| **SKILL.md auto-scheduling** | Unit-tested in `skill-loader-schedule.test.ts`. No existing SKILL.md files have `trigger_config`. |

## Bugs found during live testing (Feb 14, 2026)

### Bug 1: Direct tier has no result piping between steps
- **Symptom**: `ai_news_every_minute` (skill 1303) sent literal `{{search_news.result}}` to Telegram
- **Root cause**: `executeWorkflow()` in `executor.ts:95-126` passes step parameters as-is. No template interpolation between steps.
- **Deeper cause**: LLM classified "search AI news and send" as Direct tier despite the playbook saying data-reading tasks = Agent tier
- **Fix**: Two-part:
  1. **Playbook**: reinforce that multi-step plans with data dependencies = Agent tier (guidance is correct but LLM ignored it)
  2. **Safety net**: in `tool-router.ts:428` (pre-storage proxy), auto-convert `execution_plan` with >1 step to Agent tier — strip `execution_plan`, keep `instructions` + `required_tools`
- **Files**: `Orchestrator/src/jobs/executor.ts`, `Orchestrator/src/routing/tool-router.ts`, `Thinker/src/agent/playbook-seed.ts`

### Bug 2: Pre-meeting notification fires when no meetings are soon
Two sub-causes:

**2a: Calendar pre-flight window too wide**
- `skill-scheduler.ts:327` uses `endOfDay` (23:59:59) instead of 30-minute lookahead
- At 5 AM with a 6 PM meeting, pre-flight passes → skill runs → "No meetings in next 30 min"
- **Fix**: change `endOfDay` to `new Date(now.getTime() + 30 * 60 * 1000)`
- **File**: `Orchestrator/src/jobs/skill-scheduler.ts:327`

**2b: Trivial result filter was removed**
- Commit `f14e11e` (Feb 13) removed the `trivialPatterns` regex array from `loop.ts:1424`
- Previously filtered "No meetings", "No new emails", "All caught up" → skipped notification
- Now every skill result gets sent as Telegram notification unconditionally
- **Fix**: restore the trivial result filter
- **File**: `Thinker/src/agent/loop.ts:1424`

### Stale documentation
- `~/.annabelle/documentation/skills-and-cronjobs.md` still describes dual system (Skills + Cron Jobs)
- Needs updating to reflect v3 (everything is a skill, Direct/Agent tiers, `execution_plan`)

## Key observations

- The input normalizer works at execution time — `send_telegram` auto-normalized to `telegram_send_message`
- Validation warned at creation but didn't block, which is correct since the normalizer fixes it at runtime
- The playbook prompt has correct tier classification rules, but the LLM ignored them for the "search AI news" case — a proxy-level safety net is needed
