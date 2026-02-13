# Next Steps — Annabelle Improvement Roadmap

**Updated:** 2026-02-12

---

## 1. Telegram `console.log` Fix (CRITICAL)

**File:** `Telegram-MCP/src/index.ts:7`

Global `console.log = () => {}` kills all logging from every dependency to prevent GramJS noise from corrupting stdio transport. This makes debugging nearly impossible.

**Fix:** Replace global suppression with targeted GramJS log interception. GramJS exposes a `Logger` class that can be overridden — route its output to stderr via the shared logger, leaving `console.log` intact for all other dependencies.

**Effort:** Small (~20 lines)
**Impact:** Unblocks debugging across all Telegram MCP dependencies

---

## 2. Signal Handler Stacking (MEDIUM)

**File:** `Shared/Transport/dual-transport.ts:212-217`

SIGINT/SIGTERM handlers use `process.on()` — they stack if `startTransport()` is called multiple times, causing duplicate cleanup on shutdown.

**Fix:** Switch to `process.once()` or guard with a `registered` boolean flag before adding handlers.

**Effort:** Tiny (~3 lines)
**Impact:** Prevents duplicate cleanup and potential resource leaks on shutdown

---

## 3. Trace Log Rotation (LOW)

**Files:** `Thinker/src/tracing/logger.ts`

JSONL trace logs at `~/.annabelle/logs/` append indefinitely with no rotation or archival. On long-running deployments, disk usage grows without bound.

**Fix:** Daily rotation — rename current file to `traces-YYYY-MM-DD.jsonl`, optionally gzip old files, delete files older than 7-14 days (configurable via `TRACE_LOG_RETENTION_DAYS`). Check at write time whether the date has rolled over.

**Effort:** Small (~30-40 lines)
**Impact:** Prevents disk exhaustion on long-running systems

---

## 4. Cost Monitor: Dollars Instead of Tokens (MEDIUM)

**File:** `Thinker/src/cost/monitor.ts`

Spike detection and hard caps are token-based, but actual cost varies dramatically by model. A provider switch (e.g., Groq free tier → paid model) could blow through dollar budgets while staying under token caps.

**Fix:** Add a pricing lookup table mapping `(provider, model) → $/1K input tokens, $/1K output tokens`. Multiply token counts by the per-token rate. Set hard caps in actual currency (e.g., `hardCapDollarsPerHour: 1.00`). Keep token-based caps as fallback for unknown models.

**Effort:** Small (~50 lines — lookup table + multiplication)
**Impact:** Accurate cost safety regardless of model choice

---

## 5. Voice MCP — Phase 1: STT (Groq Whisper)

**New package:** `Voice-MCP/` (stdio, auto-discovered)
**Full spec:** `_todos/voice-feature.md` (7 phases, all detailed)

**Phase 1 scope:** STT only (Groq Whisper, free tier, `whisper-large-v3-turbo`). User sends voice message in Telegram, Annabelle transcribes and processes as text. No TTS response yet.

**Effort:** Medium (~400 lines for Voice MCP + ~100 lines across modified files)
**Impact:** Major feature — voice input across all channels. Groq Whisper is free, so zero ongoing cost.

---

## 6. Tool Output Scanning — PARTIALLY DONE

**File:** `Orchestrator/src/config/guardian.ts`

Guardian output scanning is enabled for Searcher and Gmail but **not Telegram**. An attacker could embed prompt injection in a Telegram message that flows back to Thinker unscanned.

**Remaining:** Enable output scanning for Telegram. Test latency impact and consider async scanning (scan in parallel with response delivery, block only if flagged).

**Effort:** Small (~5 lines config + latency testing)
**Impact:** Closes the remaining security gap for indirect prompt injection via Telegram messages.

---

## 7. Parallel Tool Execution in Thinker

**File:** `Thinker/src/agent/loop.ts` (tool execution section)

When the LLM returns multiple tool calls in a single ReAct step, they run sequentially via `for` loop. Independent tool calls (e.g., `web_search` + `list_facts`) could run in parallel.

**Fix:** Wrap the tool executor to detect independent tool calls within the same step and `Promise.all()` them. Tools that write to the same resource would need a dependency check, but most multi-tool steps are read-only.

**Effort:** Small (~20 lines)
**Impact:** Reduces wall-clock time for multi-tool responses. Especially impactful for subagent parallel research patterns.

---

## 8. Memory Confidence Decay

**Files:** `Memorizer-MCP/src/db/index.ts`, new Inngest job in Orchestrator

Facts are stored with confidence scores but never decay over time. As the fact store grows, old irrelevant facts pollute context and reduce tool selection quality.

**Fix:** Add a weekly Inngest cron job that:
1. Reduces confidence by a small delta (e.g., 0.05) on facts not referenced in the last 30 days
2. Prunes facts that fall below a minimum threshold (e.g., confidence < 0.2)
3. Logs pruned facts to an archive table for recovery

Also add a `last_referenced_at` timestamp column to the facts table, updated whenever a fact is returned by `retrieve_memories` or `list_facts`.

**Effort:** Medium (~80-100 lines across Memorizer + Inngest job)
**Impact:** Keeps memory relevant over time. Prevents context pollution as the system accumulates months of facts.

---

## 9. Web Content Extraction Tool

**File:** New tool in `Searcher-MCP/src/tools/`

Brave Search returns snippets, but Thinker often needs full article content from a URL. Currently this requires spinning up the full Browser MCP Playwright session, which is heavy.

**Fix:** Add a lightweight `web_fetch` tool that takes a URL, fetches the page, and returns cleaned text/markdown. Use `cheerio` + `@mozilla/readability` (or similar) for content extraction. No headless browser needed — pure HTTP fetch with HTML parsing.

**Effort:** Small (~50-60 lines)
**Impact:** Fills a real usability gap. Enables Thinker to read full articles, documentation pages, and reference material without the overhead of Playwright.

---

## 10. Tool Count Reduction for Groq/Llama (from OpenClaw analysis)

**File:** `Thinker/src/agent/tool-selection.ts`

The tool selector uses a global `MAX_TOOLS` (default: 25) regardless of provider. Groq/Llama models have a known weakness — the more tools you give them, the more likely they ignore them or pick the wrong one.

**Fix:** Check `config.llmProvider` and use tighter budgets for Groq (topK 8-10, hard cap 12). After embedding + keyword merge, keep core tools + highest-scoring embedding matches, drop lowest-scoring keyword additions.

**Effort:** Small (~20 lines)
**Impact:** Directly improves tool calling reliability on Groq/Llama. The #1 remaining tool-calling improvement after today's history validation + hallucination guard fixes.

---

## 11. Groq Provider Investigation (from OpenClaw analysis)

Test same Llama 3.3 70B via Together AI or Fireworks to determine if tool calling quirks are Groq-specific:
- Does `toolChoice: 'required'` still crash on step 2+?
- Do leaked tool calls (JSON in text instead of structured API) still happen?
- If better: switch provider or add as fallback.

**Effort:** Small (API key + env var change + testing)
**Impact:** Could eliminate entire categories of recovery code if provider is the root cause.

---

## 12. Tool Description Enrichment (from OpenClaw analysis)

Add concrete parameter examples to key tool descriptions (OpenClaw SKILL.md pattern). Focus on tools with complex parameters: calendar events, search queries, browser navigation.

**Effort:** Small (documentation only)
**Impact:** Helps Groq/Llama models construct correct tool calls by seeing examples.

---

## 13. Recovery Code Cleanup (from OpenClaw analysis)

After today's conversation history validation + hallucination guard fixes, monitor whether:
- Leaked tool calls still occur
- Hallucination guard still triggers frequently
- `stripHallucinatedParams()` and `coerceStringBooleans()` still needed

If failures drop significantly, simplify recovery code. Keep Groq-specific safety nets regardless.

**Effort:** Low (monitoring + selective removal)
**Impact:** Reduces code complexity and maintenance burden.

---

## Priority Order

| # | Item | Effort | Impact | Category |
|---|------|--------|--------|----------|
| 1 | Telegram console.log fix | Small | High | Debugging |
| 2 | Signal handler stacking | Tiny | Medium | Reliability |
| 3 | Trace log rotation | Small | Medium | Operations |
| 4 | Cost monitor dollars | Small | High | Safety |
| 5 | Voice MCP Phase 1 (STT) | Medium | High | Feature |
| 6 | Tool output scanning (Telegram) | Small | High | Security |
| 7 | Parallel tool execution | Small | Medium | Performance |
| 8 | Memory confidence decay | Medium | Medium | Quality |
| 9 | Web content extraction | Small | Medium | Feature |
| 10 | Tool count reduction for Groq | Small | High | Tool calling |
| 11 | Groq provider investigation | Small | High | Tool calling |
| 12 | Tool description enrichment | Small | Medium | Tool calling |
| 13 | Recovery code cleanup | Low | Low | Maintenance |

**Suggested grouping:**
- **Quick wins (1-2 days):** Items 1, 2, 3, 4 — all small, high cumulative impact
- **Tool calling sprint (1-2 days):** Items 10, 11, 12, 13 — validate today's fixes + push further
- **Feature sprint (3-5 days):** Item 5 (Voice Phase 1) — biggest single feature gain
- **Hardening pass (2-3 days):** Items 6, 7, 8, 9 — security + performance + quality

## Completed (Feb 12, 2026)

- ~~Conversation history validation~~ — `history-repair.ts` validates tool call/result pairing, inserts synthetic errors for orphaned calls
- ~~Hallucination guard improvements~~ — broader patterns, pre-emptive `toolChoice: 'required'` when embedding score > 0.7
- ~~Tool result truncation~~ — `truncateHistoryToolResults()` in history-repair, 2000 char limit in error recovery
- ~~Response message persistence~~ — `buildRetryMessages()` faithfully reconstructs tool call/result structure
- ~~Playbook tool name fixes~~ — all 13 broken playbooks corrected
- ~~Persona/playbook deduplication~~ — overlapping sections removed from instructions.md
- ~~TOOL_PREAMBLE consolidation~~ — removed from loop.ts, instructions.md is single source of truth
