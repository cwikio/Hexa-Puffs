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

## Not tested

| V3 Feature | Notes |
|---|---|
| **Agent execution tier** | Complex skills needing LLM reasoning |
| **One-shot `at` schedule** | "Remind me at 3pm" with auto-delete |
| **Graduated backoff** | 30s→1m→5m→15m→60m (skill never failed, so not triggered) |
| **Cron expression validation** | Only trivially tested — `*/1 * * * *` is valid |
| **SKILL.md auto-scheduling** | File-based skills with `trigger_config` in frontmatter |
| **Strict tool sandboxing** | Agent tier receives only `required_tools` |
| **`notify_on_completion`** | Telegram notification after skill fires |

## Key observation

The input normalizer is already working at execution time — LLM stored `send_telegram` (wrong name), but the Direct executor auto-normalized it to `telegram_send_message`. Validation warned at creation but didn't block, which is correct since the normalizer fixes it at runtime.
