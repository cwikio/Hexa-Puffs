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

## Key observation

The input normalizer is already working at execution time — LLM stored `send_telegram` (wrong name), but the Direct executor auto-normalized it to `telegram_send_message`. Validation warned at creation but didn't block, which is correct since the normalizer fixes it at runtime.
