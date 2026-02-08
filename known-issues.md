# Known Issues

## 1. LLM tool selection bias: `create_job` vs `memory_store_skill`

**Status:** Mitigated (not fully resolved)

**Problem:** When a user asks for a recurring task that requires multi-step reasoning (e.g., "send me an article from onet.pl every minute for 3 minutes"), the LLM (llama-3.3-70b-versatile) defaults to `create_job` instead of `memory_store_skill`. Cron jobs execute ONE fixed tool call — they can't browse, search, or reason. The correct tool is `memory_store_skill` with `trigger_type: "cron"`, which runs a full AI reasoning loop each execution.

**Root causes:**
- **Name bias:** `create_job` literally says "job/schedule" — the LLM pattern-matches to it without reasoning about task complexity. `memory_store_skill` has "memory" in the name, making it sound like a knowledge storage tool.
- **Tool count:** With 20 tools in context, a 70B model skims descriptions rather than carefully analyzing which is architecturally better.
- **Missing reasoning step:** The LLM doesn't chain: "browsing a website + picking an article + sending it = multi-step = needs AI loop = `memory_store_skill`."

**Mitigations applied:**
1. Cron-scheduling playbook injected into system prompt with explicit Option A vs Option B decision criteria
2. Playbook keywords expanded to cover all time-unit patterns (`every minute`, `per hour`, etc.)
3. Playbook instructions explicitly list "send me an article from onet.pl" as an Option B example

**Potential further fix:** Add a warning to the `create_job` tool description itself:
> "NOTE: Cron jobs execute ONE fixed tool call — they cannot browse, search, or reason. For multi-step recurring tasks, use memory_store_skill instead."

This would make the guidance available even when the playbook doesn't match.
