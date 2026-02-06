# Annabelle MCP Stack: Critical Improvement Plan

## Executive Summary

After deep-diving into every server, tool definition, system prompt, and architectural decision in this monorepo, I've identified **10 high-impact improvements** that would make Annabelle significantly more capable as a personal assistant — all within the existing MCP infrastructure, no new servers needed.

The biggest bottlenecks are not in the plumbing (which is solid) but in: (1) the Thinker's crippled reasoning depth, (2) an unfinished skill execution pipeline, (3) memory that accumulates but never consolidates, and (4) security scanning being silently disabled.

---

## 1. Thinker's `maxSteps: 2` Cripples Multi-Tool Tasks

**File:** `Thinker/src/agent/loop.ts:309`

**Problem:** The agent is limited to 2 steps (1 tool call + 1 response). This means it literally cannot:
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

## 4. Memory Accumulates But Never Consolidates

**Files:**
- `Memorizer-MCP/src/tools/facts.ts`
- `Memorizer-MCP/src/tools/conversations.ts`

**Problem:** Facts pile up indefinitely with no mechanism to:
- **Deduplicate** — storing "User lives in Krakow" 5 times creates 5 entries
- **Supersede** — if user moves to Warsaw, old "lives in Krakow" fact persists
- **Consolidate** — 50 individual conversation facts never get summarized into higher-level understanding
- **Decay** — outdated facts (like "working on project X" from 6 months ago) have equal weight to recent ones
- **Prioritize** — `retrieve_memories` does text matching, not relevance scoring

The Thinker's system prompt says "proactively store important details" which means facts grow fast, but nothing prunes them.

**Fix:**
- Add a `relevance_score` or `last_accessed_at` column to facts for recency weighting
- Add a deduplication check in `store_fact` (fuzzy match against existing facts in same category)
- Create a periodic "memory consolidation" skill that summarizes old conversations and prunes stale facts
- Add `supersede_fact` or `update_fact` tool so the LLM can explicitly replace outdated information

**Impact:** Without this, memory quality degrades over time. After a few months, `retrieve_memories` returns noise instead of signal.

---

## 5. Thinker's System Prompt Lacks Date/Time and User Context

**File:** `Thinker/src/agent/loop.ts:17-81`

**Problem:** The system prompt never tells the agent:
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

## 6. Tool Descriptions Are Inconsistent Across MCPs

**Worst offenders:**
- Telegram MCP tools have good descriptions individually but lose context through the Orchestrator's prefixing
- Gmail calendar tools exist but aren't in the README (invisible to humans reviewing)
- `trigger_type` enum in skills references `TRIGGER_TYPES` but descriptions don't list valid values
- Orchestrator's `get_status` is the only custom tool — no help/guidance tools

**Specific issues:**
- `store_fact` description says "Store a discrete fact" but doesn't explain what makes a good fact vs. a bad one
- `search_conversations` doesn't explain what fields are searched
- `retrieve_memories` vs `search_conversations` vs `list_facts` — three overlapping tools with no guidance on when to use which
- `send_message` (Telegram) vs `send_email` (Gmail) — no disambiguation help for "send a message" type requests

**Fix:** For each MCP, enhance tool descriptions with:
1. **When to use** — "Use this when the user wants to recall something from a previous conversation"
2. **When NOT to use** — "Don't use this for general knowledge questions"
3. **Examples** — "Example query: 'meetings last week'"
4. **Disambiguation** — "For searching facts use list_facts. For searching past chat transcripts use search_conversations. For a combined search use retrieve_memories."

**Impact:** Better tool descriptions = fewer wrong tool calls = better assistant accuracy. This is the cheapest improvement per unit of quality gained.

---

## 7. Orchestrator's HTTP-Mode `execute()` Uses Naive Keyword Parsing

**File:** `Orchestrator/src/core/orchestrator.ts:302-360`

**Problem:** The `execute()` method does `task.toLowerCase().includes('telegram')` to decide which tools to invoke. This is brittle and unused in stdio mode (which is the primary mode). However, it's still reachable via the HTTP REST API and represents dead code / incomplete feature.

**Fix:** Either:
- Remove it entirely (since stdio mode with the ToolRouter handles everything)
- Or replace it with proper LLM-based routing if HTTP mode is still used

**Impact:** Medium — mostly a code quality issue, but it could mislead anyone trying to use the HTTP API.

---

## 8. Conversation History Window is Too Small

**File:** `Thinker/src/agent/loop.ts:243`

```typescript
conversationHistory: state.messages.slice(-10), // Keep last 10 messages
```

**Problem:** 10 messages = 5 exchanges. For any non-trivial conversation (planning a trip, debugging a problem, discussing a project), context is lost mid-conversation. The agent forgets what was discussed 6 messages ago.

Combined with `maxSteps: 2`, each exchange uses 2+ messages (user + assistant + possibly tool results), so the effective window is even smaller.

**Fix:**
- Increase to 20-30 messages
- Better: implement a sliding window with summarization — when history exceeds N messages, summarize older messages into a context block
- Track token count rather than message count

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

## 10. Thinker Doesn't Store Tool Results Back Into Context Properly

**File:** `Thinker/src/agent/loop.ts:370-412`

**Problem:** When the LLM doesn't generate a text response (only tool calls), the fallback logic (lines 374-412) tries to extract text from steps and tool results. But it:
- Only looks at search results specifically (checking for `.results` array)
- Doesn't handle other tool types (memory, calendar, email results)
- Falls back to "I apologize, but I was unable to generate a response" for non-search tools

This means if the agent calls `list_events` or `list_facts` and the LLM doesn't produce a final text response, the user gets an apology instead of results.

**Fix:** Make the fallback more generic — serialize any non-empty tool result as a formatted response, or better yet, make a final LLM call with the tool results to generate a proper summary.

**Impact:** Directly reduces "sorry I couldn't help" responses that frustrate users.

---

## Priority Order for Implementation

| # | Improvement | Effort | Impact |
|---|-------------|--------|--------|
| 1 | Increase maxSteps from 2 to 6-8 | 5 min | Transformative |
| 5 | Add date/time/timezone to system prompt | 15 min | High |
| 8 | Increase conversation history window | 5 min | High |
| 6 | Improve tool descriptions across all MCPs | 2-3 hrs | High |
| 2 | Wire Guardian security scanning in stdio mode | 1-2 hrs | Critical (security) |
| 10 | Fix tool result fallback in Thinker | 1 hr | Medium |
| 4 | Add memory deduplication and consolidation | 2-3 hrs | High (long-term) |
| 3 | Wire skills to Inngest cron scheduler | 3-4 hrs | High (unlocks proactivity) |
| 9 | Add MCP health monitoring and auto-restart | 2 hrs | Medium (reliability) |
| 7 | Clean up dead HTTP-mode execute() code | 30 min | Low (code quality) |

## Verification

After implementing changes:
1. **maxSteps**: Send a multi-step request via Telegram ("search for weather in Krakow and then check my calendar for today") — should complete both actions
2. **Date/time**: Ask "what day is it?" — should answer without web search
3. **Guardian**: Check Orchestrator logs for scan_content calls on incoming messages
4. **Skills**: Create a skill with `store_skill`, verify Inngest dashboard shows the cron function, wait for execution
5. **Memory**: Store duplicate facts and verify deduplication works
6. **Tool descriptions**: Use Claude Desktop and ask ambiguous queries — observe correct tool selection
