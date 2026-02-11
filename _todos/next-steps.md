# Next Steps — Annabelle Improvement Roadmap

**Created:** 2026-02-11 00:30 UTC

---

## 1. Telegram `console.log` Fix (#1 — CRITICAL)

**File:** `Telegram-MCP/src/index.ts:7`

Global `console.log = () => {}` kills all logging from every dependency to prevent GramJS noise from corrupting stdio transport. This makes debugging nearly impossible.

**Fix:** Replace global suppression with targeted GramJS log interception. GramJS exposes a `Logger` class that can be overridden — route its output to stderr via the shared logger, leaving `console.log` intact for all other dependencies.

**Effort:** Small (~20 lines)
**Impact:** Unblocks debugging across all Telegram MCP dependencies

---

## 2. Signal Handler Stacking (#10 — MEDIUM)

**File:** `Shared/Utils/dual-transport.ts`

SIGINT/SIGTERM handlers are added each time `startTransport()` is called. Multiple invocations stack handlers, causing duplicate cleanup on shutdown.

**Fix:** Switch to `process.once()` or guard with a `registered` boolean flag before adding handlers.

**Effort:** Tiny (~3 lines)
**Impact:** Prevents duplicate cleanup and potential resource leaks on shutdown

---

## 3. Trace Log Rotation (#24 — LOW)

**Files:** `Thinker/src/tracing/logger.ts`

JSONL trace logs at `~/.annabelle/logs/` append indefinitely with no rotation or archival. On long-running deployments, disk usage grows without bound.

**Fix:** Daily rotation — rename current file to `traces-YYYY-MM-DD.jsonl`, optionally gzip old files, delete files older than 7-14 days (configurable via `TRACE_LOG_RETENTION_DAYS`). Check at write time whether the date has rolled over.

**Effort:** Small (~30-40 lines)
**Impact:** Prevents disk exhaustion on long-running systems

---

## 4. Cost Monitor: Dollars Instead of Tokens (#16 — MEDIUM)

**File:** `Thinker/src/cost/monitor.ts`

Spike detection and hard caps are token-based, but actual cost varies dramatically by model. A provider switch (e.g., Groq free tier → paid model) could blow through dollar budgets while staying under token caps.

**Fix:** Add a pricing lookup table mapping `(provider, model) → $/1K input tokens, $/1K output tokens`. Multiply token counts by the per-token rate. Set hard caps in actual currency (e.g., `hardCapDollarsPerHour: 1.00`). Keep token-based caps as fallback for unknown models.

**Effort:** Small (~50 lines — lookup table + multiplication)
**Impact:** Accurate cost safety regardless of model choice

---

## 5. Voice MCP — Phase 1: STT (Groq Whisper)

**New package:** `Voice-MCP/` (stdio, auto-discovered)
**Modified files:**
- `Telegram-MCP/src/telegram/types.ts` — add `mediaSubtype`, `mediaDuration` to `MessageInfo`
- `Telegram-MCP/src/tools/media/send-media.ts` — add `as_voice` boolean param
- `Orchestrator/src/core/channel-poller.ts` — allow voice messages through (line 146 filter), download audio, call `voice_transcribe`, inject transcribed text
- `Orchestrator/src/core/orchestrator.ts` — voice response path in `dispatchMessage()` (~line 592)
- `Orchestrator/src/core/agent-types.ts` — add `voice` metadata to `IncomingAgentMessageSchema`
- `Orchestrator/src/config/agents.ts` — add `voiceConfig` to `AgentDefinitionSchema`

**Phase 1 scope:** STT only (Groq Whisper, free tier, `whisper-large-v3-turbo`). User sends voice message in Telegram, Annabelle transcribes and processes as text. No TTS response yet.

**Full spec:** `_todos/voice-feature.md` (7 phases, all detailed)

**Effort:** Medium (~400 lines for Voice MCP + ~100 lines across modified files)
**Impact:** Major feature — voice input across all channels. Groq Whisper is free, so zero ongoing cost.

---

## 6. Tool Output Scanning (S6 — Security Gap)

**File:** `Orchestrator/src/config/guardian.ts`

Guardian scans inputs going to MCPs, but tool outputs from external-facing MCPs (Searcher, Gmail, Telegram) flow back to Thinker's LLM context unscanned. An attacker could embed prompt injection in an email body or web search result.

**Fix:** Enable output scanning selectively for the three external-facing MCPs. The `GuardedMCPClient` decorator already supports output scanning — the `output` config in `guardian.ts` just needs to be toggled on for `searcher`, `gmail`, and `telegram`. Test latency impact and consider async scanning (scan in parallel with response delivery, block only if flagged).

**Effort:** Small for enabling (~5 lines of config change), medium for latency testing and async scanning (~100 lines)
**Impact:** Closes the biggest remaining security gap. Prevents indirect prompt injection via external content.

---

## 7. Parallel Tool Execution in Thinker

**File:** `Thinker/src/agent/loop.ts` (tool execution section)

When the LLM returns multiple tool calls in a single ReAct step, Vercel AI SDK's `execute` functions run sequentially by default. Independent tool calls (e.g., `web_search` + `list_facts`) could run in parallel.

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

**File:** New tool in `Searcher-MCP/src/tools/` or `Browser-MCP/src/tools/`

Brave Search returns snippets, but Thinker often needs full article content from a URL. Currently this requires spinning up the full Browser MCP Playwright session, which is heavy.

**Fix:** Add a lightweight `web_fetch` tool that takes a URL, fetches the page, and returns cleaned text/markdown. Use `cheerio` + `@mozilla/readability` (or similar) for content extraction. No headless browser needed — pure HTTP fetch with HTML parsing.

**Best location:** Searcher MCP (it already handles web content and has HTTP transport). Add as a third tool alongside `web_search` and `news_search`.

**Effort:** Small (~50-60 lines)
**Impact:** Fills a real usability gap flagged in the OpenClaw comparison. Enables Thinker to read full articles, documentation pages, and reference material without the overhead of Playwright.

---

## Priority Order

| # | Item | Effort | Impact | Category |
|---|------|--------|--------|----------|
| 1 | Telegram console.log fix | Small | High | Debugging |
| 2 | Signal handler stacking | Tiny | Medium | Reliability |
| 3 | Trace log rotation | Small | Medium | Operations |
| 4 | Cost monitor dollars | Small | High | Safety |
| 5 | Voice MCP Phase 1 (STT) | Medium | High | Feature |
| 6 | Tool output scanning | Small-Medium | High | Security |
| 7 | Parallel tool execution | Small | Medium | Performance |
| 8 | Memory confidence decay | Medium | Medium | Quality |
| 9 | Web content extraction | Small | Medium | Feature |

**Suggested grouping:**
- **Quick wins (1-2 days):** Items 1, 2, 3, 4 — all small, high cumulative impact
- **Feature sprint (3-5 days):** Item 5 (Voice Phase 1) — biggest single feature gain
- **Hardening pass (2-3 days):** Items 6, 7, 8, 9 — security + performance + quality
