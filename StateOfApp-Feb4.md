# Annabelle MCP Stack: Critical Improvement Plan

## Executive Summary

After deep-diving into every server, tool definition, system prompt, and architectural decision in this monorepo, I've identified **10 high-impact improvements** that would make Annabelle significantly more capable as a personal assistant — all within the existing MCP infrastructure, no new servers needed.

The biggest bottlenecks are not in the plumbing (which is solid) but in: (1) the Thinker's crippled reasoning depth, (2) an unfinished skill execution pipeline, (3) memory that accumulates but never consolidates, and (4) security scanning being silently disabled.

---

## 1. Thinker's `maxSteps: 2` Cripples Multi-Tool Tasks — RESOLVED

**File:** `Thinker/src/agent/loop.ts:309`
**Status:** Fixed on Feb 5, 2026. Increased to `maxSteps: 8` for both primary and retry paths.

**Problem:** The agent was limited to 2 steps (1 tool call + 1 response). This means it literally could not:
- Search the web AND THEN summarize findings
- Check calendar AND THEN send a Telegram message about a conflict
- List emails AND THEN read one AND THEN reply
- Store a fact AND THEN confirm with the user

Any task requiring more than one tool call silently truncates. The user gets a partial answer with no indication that the agent gave up.

**Fix:** Increase `maxSteps` to 6-8 for interactive messages, keep the existing higher limit for proactive tasks. Add a cost guard via token budget rather than step count.

**Impact:** This is the single highest-impact change. It transforms Annabelle from a single-action bot to an actual multi-step reasoning agent.

---

## 2. Guardian Security Scanning is Silently Disabled in stdio Mode

**File:** `Orchestrator/src/core/orchestrator.ts:97-101`

```typescript
if (stdioConfigs.guardian) {
  const client = new StdioMCPClient('guardian', stdioConfigs.guardian);
  this.stdioClients.set('guardian', client);
  // Note: Guardian needs special handling for security - skip for now in stdio mode
}
```

**Problem:** Guardian is spawned as a process but **never registered with the ToolRouter** (line 106 equivalent is missing). The `SecurityCoordinator` is also never initialized in stdio mode (only in HTTP mode, line 156). This means:
- No prompt injection scanning
- No security scanning of ANY inputs
- `SCAN_ALL_INPUTS` and `SECURITY_FAIL_MODE` config values are ignored
- The entire security layer is a no-op

**Fix:** Wire Guardian into the stdio pipeline. Either register it with the ToolRouter and use it as a passthrough scanning layer, or initialize `SecurityCoordinator` to call Guardian via the stdio client.

**Impact:** Critical for security posture. Without this, any content from Telegram, emails, or web search reaches the LLM unscanned.

---

## 3. Skills System is Half-Built — Storage Works, Execution Doesn't Trigger

**Files:**
- `Memorizer-MCP/src/tools/skills.ts` — CRUD for skills works perfectly
- `Orchestrator/src/jobs/` — Inngest job infrastructure exists
- `Thinker/src/agent/loop.ts:484-590` — `processProactiveTask()` exists and works

**Problem:** The pipeline is disconnected:
1. Skills get stored in SQLite via `store_skill` with trigger_type and trigger_config (cron schedules, etc.)
2. But **nothing reads the skills table and creates Inngest cron jobs** from them
3. The Inngest functions in the Orchestrator don't query skills from memory
4. `processProactiveTask` on the Thinker is ready to execute, but nobody calls it

The user can create a skill like "Check my email every morning at 9am" — it gets stored, but never runs.

**Fix:** Add a skill scheduler that:
- On Orchestrator startup, reads all enabled skills from Memorizer
- Creates/updates Inngest cron functions for each `cron` trigger type
- When a cron fires, calls Thinker's `/execute-skill` endpoint with the skill's instructions
- On skill CRUD changes, syncs the Inngest schedule

**Impact:** This unlocks the entire proactive assistant capability — daily briefings, scheduled email summaries, periodic reminders, automated workflows.

---

## 4. Memory Accumulates But Never Consolidates — RESOLVED

**Files:**

- `Memorizer-MCP/src/db/schema.ts`
- `Memorizer-MCP/src/db/index.ts`
- `Memorizer-MCP/src/tools/facts.ts`
- `Memorizer-MCP/src/tools/memory.ts`
- `Memorizer-MCP/src/types/responses.ts`
- `Memorizer-MCP/src/tools/index.ts`
- `Memorizer-MCP/src/server.ts`

**Status:** Fixed on Feb 5, 2026. Added recency tracking, fuzzy deduplication, and an `update_fact` tool.

**Problem:** Facts piled up indefinitely with no mechanism to deduplicate, supersede, decay, or prioritize.

**Fix (implemented):**

1. **`last_accessed_at` column** — Added to facts table (with migration for existing DBs). Updated every time `retrieve_memories` returns a fact. Facts that are never retrieved naturally decay in ranking.
2. **Fuzzy deduplication in `store_fact`** — Before inserting, extracts keywords from the new fact and checks overlap against existing facts in the same category (60% threshold). If similar facts exist, the response includes `similar_existing` with their IDs and text, plus a message suggesting `update_fact` or `delete_fact`.
3. **`update_fact` tool** — New tool that atomically supersedes an existing fact with new text (optionally changing category). The LLM can now say "update fact #42 from 'Lives in Krakow' to 'Lives in Warsaw'" in a single call instead of delete + store.
4. **Recency-weighted retrieval** — `retrieve_memories` now sorts by `confidence DESC, last_accessed_at DESC, created_at DESC` instead of just `confidence DESC, created_at DESC`. Frequently-accessed facts rank higher.

**Remaining (not in scope):** Periodic memory consolidation skill (summarizing old conversations + pruning stale facts) — this requires the skills scheduler (#3) to be wired first.

**Impact:** Memory quality now degrades much more slowly. Duplicates are flagged, outdated facts can be superseded, and retrieval favors recently-relevant information.

---

## 5. Thinker's System Prompt Lacks Date/Time and User Context — RESOLVED

**File:** `Thinker/src/agent/loop.ts:17-81`
**Status:** Fixed on Feb 5, 2026. Added dynamic date/time injection in `buildContext()` using `Intl.DateTimeFormat` with configurable timezone (`USER_TIMEZONE` env var, defaults to `Europe/Warsaw`).

**Problem:** The system prompt never told the agent:
- What today's date and time is
- What timezone the user is in
- Who the user is (beyond what memories say)
- What the current day of week is

This means:
- "What's my schedule today?" — the agent doesn't know what "today" is
- "Remind me tomorrow" — no temporal anchor
- Calendar queries require the user to specify exact dates
- "What day is it?" fails without a web search

**Fix:** Inject dynamic context into the system prompt:
```typescript
const now = new Date();
systemPrompt += `\n\nCurrent date and time: ${now.toISOString()}`;
systemPrompt += `\nTimezone: ${config.userTimezone || 'Europe/Warsaw'}`;
systemPrompt += `\nDay of week: ${now.toLocaleDateString('en-US', { weekday: 'long' })}`;
```

Also pull the user's name and key preferences from the profile at prompt-build time (this partially happens in `buildContext` but only for persona, not basic identity).

**Impact:** Essential for any time-sensitive assistant task. Low effort, high payoff.

---

## 6. Tool Descriptions Are Inconsistent Across MCPs — RESOLVED

**Status:** Fixed on Feb 5, 2026.

**Changes made across 7 MCPs:**

- **Memorizer-MCP:** Added disambiguation between `retrieve_memories` (primary keyword search across facts + conversations), `list_facts` (browse all facts by category), and `search_conversations` (search chat transcripts with date filters). Improved `store_fact` with category guidance and examples. Added workflow hints to `get_profile`, `update_profile`, `store_conversation`, and skill tools with trigger_type documentation.
- **Searcher-MCP:** Added freshness filter examples, "when to use" guidance, and disambiguation between `web_search` (general) and `news_search` (current events). Updated in both stdio server.ts and HTTP index.ts.
- **Filer-MCP:** Clarified workspace vs granted path behavior on every tool. Added guidance on when `check_grant` is needed, what `search_files` search_type and search_in options do, and what `get_audit_log` can filter on.
- **Telegram-MCP:** Added disambiguation with Gmail (`send_message` = Telegram, `send_email` = email). Added cross-references between `get_messages` (recent history) and `search_messages` (keyword search).
- **Gmail-MCP:** Added search syntax examples to `list_emails`, workflow hints (list → get → reply), and disambiguation with Telegram tools. Clarified `reply_email` vs `send_email`.
- **Orchestrator:** Clarified `execute_task` is HTTP-mode keyword matching only, directing users to use specific tools directly.
- **1Password-MCP:** Already had excellent descriptions — no changes needed.

---

## 7. Orchestrator's HTTP-Mode `execute()` Uses Naive Keyword Parsing

**File:** `Orchestrator/src/core/orchestrator.ts:302-360`

**Problem:** The `execute()` method does `task.toLowerCase().includes('telegram')` to decide which tools to invoke. This is brittle and unused in stdio mode (which is the primary mode). However, it's still reachable via the HTTP REST API and represents dead code / incomplete feature.

**Fix:** Either:
- Remove it entirely (since stdio mode with the ToolRouter handles everything)
- Or replace it with proper LLM-based routing if HTTP mode is still used

**Impact:** Medium — mostly a code quality issue, but it could mislead anyone trying to use the HTTP API.

---

## 8. Conversation History Window is Too Small — RESOLVED

**File:** `Thinker/src/agent/loop.ts:258`
**Status:** Fixed on Feb 5, 2026. Increased from `slice(-10)` to `slice(-30)` (~15 exchanges).

**Problem:** 10 messages = 5 exchanges. For any non-trivial conversation (planning a trip, debugging a problem, discussing a project), context is lost mid-conversation. The agent forgets what was discussed 6 messages ago.

Combined with `maxSteps: 2`, each exchange uses 2+ messages (user + assistant + possibly tool results), so the effective window is even smaller.

**Impact:** Directly affects conversation quality for anything beyond simple Q&A.

---

## 9. No Error Recovery for Failed MCP Connections

**Files:**
- `Orchestrator/src/core/orchestrator.ts:200-218` — parallel init, no retry
- `Orchestrator/src/mcp-clients/stdio-client.ts` — spawns child, no restart on crash

**Problem:** If a child MCP process crashes after startup:
- No automatic restart
- No health monitoring loop
- Tools from that MCP silently fail
- User gets opaque errors with no guidance

The `start-all.sh` script does one-time health checks but no ongoing monitoring.

**Fix:**
- Add a periodic health check loop in the Orchestrator (every 60s)
- Auto-restart crashed stdio children
- Return clear error messages when a downstream MCP is unavailable: "Gmail is currently unavailable, please try again in a moment"
- Log MCP availability changes

**Impact:** Reliability. A personal assistant that silently breaks when one component crashes is frustrating.

---

## 10. Thinker Doesn't Store Tool Results Back Into Context Properly — RESOLVED

**File:** `Thinker/src/agent/loop.ts:389-441`
**Status:** Fixed on Feb 5, 2026. Replaced search-specific fallback with generic tool result collection + LLM summarization call.

**Problem:** When the LLM didn't generate a text response (only tool calls), the fallback logic only handled search results (checking for `.results` array). Calendar, email, memory, and other tool results fell through to "I apologize, but I was unable to generate a response."

**Fix:** The fallback now:

1. Collects all tool call names and their results generically (any tool type)
2. Makes a final LLM call asking it to summarize the tool results into a natural response
3. Falls back to raw formatted JSON if the summarization call itself fails
4. Truncates large results (>2000 chars) to prevent blowing up the summarization context

**Impact:** Directly reduces "sorry I couldn't help" responses for non-search tool calls.

---

## Priority Order for Implementation

| # | Improvement | Effort | Impact | Status |
|---|-------------|--------|--------|--------|
| 1 | Increase maxSteps from 2 to 8 | 5 min | Transformative | DONE |
| 5 | Add date/time/timezone to system prompt | 15 min | High | DONE |
| 6 | Improve tool descriptions across all MCPs | 2-3 hrs | High | DONE |
| 8 | Increase conversation history window | 5 min | High | DONE |
| 2 | Wire Guardian security scanning in stdio mode | 1-2 hrs | Critical (security) | |
| 10 | Fix tool result fallback in Thinker | 1 hr | Medium | DONE |
| 4 | Add memory deduplication and consolidation | 2-3 hrs | High (long-term) | DONE |
| 3 | Wire skills to Inngest cron scheduler | 3-4 hrs | High (unlocks proactivity) | |
| 9 | Add MCP health monitoring and auto-restart | 2 hrs | Medium (reliability) | |
| 7 | Clean up dead HTTP-mode execute() code | 30 min | Low (code quality) | |

## Verification

After implementing changes:
1. **maxSteps**: Send a multi-step request via Telegram ("search for weather in Krakow and then check my calendar for today") — should complete both actions
2. **Date/time**: Ask "what day is it?" — should answer without web search
3. **Guardian**: Check Orchestrator logs for scan_content calls on incoming messages
4. **Skills**: Create a skill with `store_skill`, verify Inngest dashboard shows the cron function, wait for execution
5. **Memory**: Store duplicate facts and verify deduplication works
6. **Tool descriptions**: Use Claude Desktop and ask ambiguous queries — observe correct tool selection
