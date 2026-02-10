# Architecture Review - Annabelle MCP Ecosystem

**Date:** 2026-02-10

## System Overview

Hub-and-spoke system: **Orchestrator** (8010) auto-discovers and manages **9 MCPs** (stdio + HTTP), spawns **Thinker** agent processes. Thinker is an autonomous LLM agent (Vercel AI SDK + ReAct loop) that calls MCP tools via Orchestrator. Inngest provides cron/job scheduling.

```
                    ┌─────────────────┐
                    │  Telegram User   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Telegram MCP    │ :8002 (HTTP)
                    └────────┬────────┘
                             │ poll
                    ┌────────▼────────┐    ┌────────────┐
                    │   Orchestrator   │◄──►│   Inngest   │ :8288
                    │     :8010        │    └────────────┘
                    └──┬───┬───┬───┬──┘
          ┌────────────┤   │   │   ├────────────┐
          ▼            ▼   ▼   ▼   ▼            ▼
     Guardian    Filer  Memory 1Pass  Searcher  Gmail
     (stdio)    (stdio)(stdio)(stdio) (:8007)  (:8008)
                    │
                    ▼
               Thinker :8006 (child process)
```

## Strengths

- **Auto-discovery** — drop a folder with `annabelle` manifest and restart
- **`registerTool()` wrapper** — consistent error handling and MCP formatting
- **StandardResponse** contract across all tools
- **Guardian-as-gatekeeper** with content hashing (privacy-preserving)
- **Cost controls** — sliding window anomaly detection + hard cap
- **Thinker graceful degradation** — retry → rephrase → text-only fallback
- **Embedding-based tool selection** — semantic matching via nomic-embed, regex fallback
- **Session compaction** — summarize old turns, keep last 10
- **Subagent spawning** — single-level depth, cascade-kill, auto-kill timers
- **TypeScript strict mode** enabled globally via `tsconfig.base.json`
- **Test coverage** across 12/12 packages (170+ test files)
- **Localhost binding** — Orchestrator, Searcher, Inngest, dual-transport all bind `127.0.0.1`
- **Per-session auth token** — `ANNABELLE_TOKEN` generated per session, enforced on Orchestrator HTTP

---

## Carried Over — Unresolved (from previous review)

### ~~1. Adopt Workspace Tooling~~ ❌ DECLINED

**Status:** Declined — independent packages are a deliberate design choice.

**Rationale:** The "drop a folder and it works" auto-discovery model is more valuable than workspace tidiness. Each MCP being fully self-contained (own `node_modules`, own lockfile) means new MCPs can be added by simply pasting a folder. pnpm workspaces would couple all packages to a shared lockfile and require root-level `pnpm install` for any new MCP — breaking plug-and-play flexibility.

### ~~4. Replace Keyword-Based Tool Selection~~ ✅ DONE

**Status:** Implemented — embedding-based tool selection with regex fallback.

**What was done:**
- Extracted embedding infrastructure from Memorizer-MCP to `@mcp/shared/Embeddings/` (provider interface, Ollama provider, new HuggingFace provider, cosine similarity, factory with `extraProviders` extension point)
- Built `EmbeddingToolSelector` in Thinker — embeds all tool descriptions at startup via `embedBatch()`, selects per-message via cosine similarity (configurable threshold/topK/minTools)
- `selectToolsWithFallback()` orchestration: tries embeddings first, falls back to regex on error or when disabled
- Integrated into `loop.ts` at both call sites (`processMessage` + `processProactiveTask`)
- **Zero changes** to existing `tool-selector.ts` — remains as automatic fallback
- Configured: `EMBEDDING_PROVIDER=ollama` in Thinker `.env`
- Verified with live Ollama integration tests: correct semantic routing across 7 domains (search, email, calendar, files, code, memory, passwords)
- 32 new tests (21 Shared + 11 Thinker)

**Key files:**
- `Shared/Embeddings/{provider,config,math,ollama-provider,huggingface-provider,index}.ts`
- `Thinker/src/agent/{embedding-tool-selector,embedding-config,tool-selection}.ts`
- `Memorizer-MCP/src/embeddings/index.ts` (refactored to import from Shared)

---

## New Findings

### Security

#### ~~S1. CORS `*` in Guardian, Filer, 1Password HTTP mode~~ ✅ DONE

Applied localhost-only CORS regex + `X-Annabelle-Token` header support + `127.0.0.1` binding in all three MCPs' HTTP mode.

#### ~~S2. Thinker binds `0.0.0.0`~~ ✅ DONE

Bound Thinker to `127.0.0.1` in `Thinker/src/index.ts`.

#### ~~S3. Auth bypass when `ANNABELLE_TOKEN` is unset~~ ✅ DONE

Added prominent warning log at startup when `ANNABELLE_TOKEN` is unset in HTTP mode (`Orchestrator/src/index.ts`).

#### ~~S4. HTTP request body has no size limit~~ ✅ DONE

Added 10 MB body size limit with 413 rejection in `Orchestrator/src/core/http-handlers.ts`.

#### ~~S5. No rate limiting on any HTTP endpoint~~ ✅ DONE

Added in-memory sliding-window rate limiter (120 req/min per IP) to Orchestrator's `handleCallTool` with periodic cleanup.

#### S6. Indirect prompt injection — tool outputs not scanned (Design Limitation)

Guardian scans **incoming user input** for prompt injection. However, tool outputs (web search results from Searcher, email content from Gmail, Telegram messages) are fed back to the LLM without re-scanning.

**Attack path:** Attacker sends malicious content via email or Telegram → tool fetches it → Thinker feeds it to LLM unscanned → injected prompt executes.

**Fix:** This is an architectural choice (scanning outputs adds latency and cost). Consider: (a) scanning tool outputs from external-facing MCPs (Searcher, Gmail, Telegram) only, or (b) adding output sanitization hints to the system prompt.

---

### Performance

#### ~~P1. No retry logic on HTTP MCP calls~~ ✅ DONE

Added retry loop (2 retries, 500ms/1s exponential backoff) for transient errors (timeouts, ECONNREFUSED, 502/503/504). 4xx errors are not retried. `Orchestrator/src/mcp-clients/base.ts`.

#### ~~P2. No HTTP connection pooling~~ ✅ DONE

Added shared `http.Agent` with `keepAlive: true, maxSockets: 10` to `BaseMCPClient`. All HTTP MCP calls reuse connections.

#### ~~P3. No SQLite `busy_timeout` in Memorizer~~ ✅ DONE

Added `db.pragma('busy_timeout = 5000')` in `Memorizer-MCP/src/db/index.ts`.

#### ~~P4. Tool discovery cache in Thinker never invalidated~~ ✅ DONE

Added 10-minute TTL to tool cache with `getCachedToolsOrRefresh()` method in `Thinker/src/orchestrator/client.ts`.

#### ~~P5. Session JSONL files grow without auto-compaction~~ ✅ ALREADY IMPLEMENTED

Verified: `shouldCompact()` is already called after every `saveTurn()` in the agent loop (`Thinker/src/agent/loop.ts`). No change needed.

---

### Reliability

#### ~~R1. Guardian not re-registered with tool router after restart~~ ✅ VERIFIED OK

`StdioGuardianClient` holds a reference to `StdioMCPClient`. On restart, `StdioMCPClient.restart()` creates a new `client` + `transport` on the same object — the guardian scanner automatically uses the new connection. No fix needed.

#### ~~R2. Health checks are shallow~~ ✅ DONE

Enhanced Thinker health endpoint with Orchestrator connectivity check (cached 30s). Added `checkOrchestratorHealth()` to Agent class and `orchestratorConnected` field to health response.

#### ~~R3. Graceful shutdown doesn't flush Thinker sessions~~ ✅ DONE

Added proper shutdown handler: `cleanupOldConversations(0)` clears all timers, `server.close()` drains connections, 5-second force-exit timeout. `Thinker/src/index.ts`.

#### ~~R4. Agent restart uses fixed cooldown, not exponential backoff~~ ✅ DONE

Changed fixed 10s cooldown to `10s * 2^restartCount` (10s, 20s, 40s, 80s, 160s). `Orchestrator/src/agents/agent-manager.ts`.

---

### Architecture / Flexibility

#### ~~A1. StandardResponse duplication in Gmail~~ ✅ DONE

Replaced Gmail's local `StandardResponse` (missing `errorCode`/`errorDetails`) with canonical import from `@mcp/shared/Types/StandardResponse.js` in all 6 tool files + test helper. Local `responses.ts` now re-exports from Shared for backwards compatibility.

#### ~~A2. Channel extensibility is limited~~ ✅ DONE

Removed hardcoded `telegram_send` and `onepassword_get` from `sensitiveTools` config. Now derived dynamically from MCP manifest `sensitive: true` flag via prefix patterns. `ToolExecutor.isSensitive()` supports both exact tool names and `${mcpName}_` prefix matching. `GenericChannelAdapter` already handles any channel MCP following the `send_message`/`get_messages` convention.

#### ~~A3. No versioning strategy~~ ✅ DONE

Implemented two-layer versioning:
- **System version**: `VERSION` file at repo root (starting at `1.0.0`), exposed in Orchestrator `/health` and `/status` endpoints
- **Per-MCP SemVer**: Individual `package.json` version fields (standard semver discipline)
- **Changelog**: Root `CHANGELOG.md` organized by system version with per-MCP sections
- **Tooling**: `version.sh` helper script for bumping system/package versions
- **Git tags**: `v1.0.0` convention for releases

#### ~~A4. Type safety gaps — `Record<string, unknown>` in registerTool~~ ✅ DONE

Made `registerTool` generic: `registerTool<T extends z.AnyZodObject>()`. The handler now receives `z.infer<T>` instead of `Record<string, unknown>`. The single centralised cast lives inside the wrapper (`args as z.infer<T>`). Removed 47 `as FooInput` casts and unused type imports across 6 MCPs (CodeExec, Searcher, Filer, Onepassword, Guardian, Telegram). Gmail and Memorizer already had no casts.

#### ~~A5. Test helper duplication across packages~~ ✅ DONE

Extracted shared `MCPTestClient` base class and test utilities into `Shared/Testing/`. Migrated Orchestrator, Filer, Searcher, Memorizer, and Telegram test helpers to import from `@mcp/shared/Testing/`. Guardian stays local (stdio transport).

#### ~~A6. Zod version drift across packages~~ ✅ DONE

Unified Memorizer (`^3.22.0`), Orchestrator (`^3.22.0`), and Thinker (`^3.23.0`) to `^3.24.0`. All packages now consistent.

#### ~~A7. Node engine constraints are inconsistent~~ ✅ DONE

Unified all 12 packages to `"node": ">=22.0.0"` matching the existing `.nvmrc`. Added missing `engines` field to Shared and Thinker.

---

## Priority Ranking

### Tier 1: Quick security wins — ✅ ALL DONE

| # | Improvement | Status |
|---|-------------|--------|
| S2 | ~~Bind Thinker to `127.0.0.1`~~ | ✅ Done |
| S4 | ~~Add HTTP body size limit~~ | ✅ Done |
| P3 | ~~Add SQLite `busy_timeout`~~ | ✅ Done |

### Tier 2: Reliability improvements — ✅ ALL DONE

| # | Improvement | Status |
|---|-------------|--------|
| P1 | ~~Add retry logic with backoff to HTTP MCP calls~~ | ✅ Done |
| R1 | ~~Verify Guardian client reconnects after restart~~ | ✅ Verified OK |
| R3 | ~~Flush Thinker sessions on shutdown~~ | ✅ Done |
| S1 | ~~Fix CORS in Guardian/Filer/1Password HTTP mode~~ | ✅ Done |

### Tier 3: Performance — ✅ ALL DONE

| # | Improvement | Status |
|---|-------------|--------|
| P2 | ~~HTTP connection pooling~~ | ✅ Done |
| P4 | ~~Tool cache invalidation in Thinker~~ | ✅ Done |
| P5 | ~~Session JSONL auto-compaction~~ | ✅ Already implemented |

### Tier 4: Architecture — ✅ ALL DONE

| # | Improvement | Effort | Status |
|---|-------------|--------|--------|
| 4 | ~~Embedding-based tool selection~~ | Medium | ✅ Done |
| 1 | ~~Workspace tooling (pnpm)~~ | Medium | ❌ Declined |
| A4 | ~~Generic `registerTool<T>()` for type safety~~ | Medium | ✅ Done |
| A2 | ~~Channel plugin interface~~ | Medium | ✅ Done |
| A1 | ~~StandardResponse dedup in Gmail~~ | Low | ✅ Done |
| A3 | ~~Versioning strategy~~ | Low-Medium | ✅ Done |

### Tier 5: Housekeeping — ✅ ALL DONE

| # | Improvement | Status |
|---|-------------|--------|
| S3 | ~~Warn on missing `ANNABELLE_TOKEN`~~ | ✅ Done |
| S5 | ~~Add rate limiting~~ | ✅ Done |
| R4 | ~~Exponential backoff for agent restart~~ | ✅ Done |
| R2 | ~~Deep health checks~~ | ✅ Done |
| A6 | ~~Unify Zod versions~~ | ✅ Done |
| A7 | ~~Unify Node engine constraints~~ | ✅ Done |
| A5 | ~~Extract shared test helpers~~ | ✅ Done |

### Design decisions (no action needed now)

| # | Topic | Notes |
|---|-------|-------|
| S6 | Indirect prompt injection | Architectural tradeoff — scanning outputs adds latency. Revisit if attack surface grows. |

---

## What's Next — Remaining Improvements

### ~~N1. Tool re-embedding on MCP hot-reload~~ ✅ DONE

**What was done:**
- Added `refreshToolsIfNeeded()` method to Agent class in `loop.ts`
- Calls `getCachedToolsOrRefresh()` (10-min TTL), compares tool name sets, rebuilds tools + re-initializes embedding selector only when changes detected
- Called at the start of both `processMessage()` and `processProactiveTask()`
- Re-initialization is fast thanks to N6 cache (only truly new tools need embedding)

### ~~N2. Embedding selector observability~~ ✅ DONE

**What was done:**
- Added `ToolSelectionStats` interface and `getLastSelectionStats()` getter to `EmbeddingToolSelector`
- Enhanced info log: `"12/45 tools (top: 0.82, cutoff: 0.31, above threshold: 8)"`; debug log shows top 5 tools with scores
- `selectToolsWithFallback()` now logs `method=embedding` or `method=regex` after every selection
- At debug level, runs regex selector in parallel and logs overlap comparison
- Added `getEmbeddingSelectorStatus()` to Agent class, exposed in Thinker `/health` endpoint (enabled, initialized, toolCount, lastSelection stats)
- 5 new tests in `tool-selection.test.ts`, 3 new tests in `embedding-tool-selector.test.ts` (stats getter, re-initialization)

### ~~N3. Workspace tooling — pnpm~~ ❌ DECLINED

See Item 1 above. Independent packages preserved for plug-and-play flexibility.

### ~~N6. Embedding cache persistence~~ ✅ DONE

**What was done:**
- Added cache I/O to `EmbeddingToolSelector` with base64-encoded Float32Array serialization (compact vs JSON arrays)
- `initialize()` loads cache, splits tools into cached vs uncached, only calls `embedBatch()` for new tools, atomically saves updated cache (write `.tmp` + rename)
- Cache file at `~/.annabelle/data/embedding-cache.json` with provider/model validation (auto-discards on mismatch)
- Added `embeddingCacheDir` config field (default `~/.annabelle/data`, env `EMBEDDING_CACHE_DIR`)
- `loop.ts` passes `cachePath`, `providerName`, `modelName` to selector config
- 5 integration tests in `embedding-cache.test.ts` (full lifecycle, incremental embedding, cache invalidation, hot-reload + cache, no-cache fallback)

**Key files:**
- `Thinker/src/agent/embedding-tool-selector.ts` (cache persistence, stats, enhanced logging)
- `Thinker/src/agent/tool-selection.ts` (method logging, debug regex comparison)
- `Thinker/src/agent/loop.ts` (refreshToolsIfNeeded, cache config passthrough, health API)
- `Thinker/src/config.ts` (embeddingCacheDir)
- `Thinker/src/index.ts` (embeddingSelector in /health response)
- `Thinker/tests/integration/embedding-cache.test.ts` (new)

### Completed

- ~~**N1** — Tool re-embedding on hot-reload~~ ✅ Done
- ~~**N2** — Embedding selector observability~~ ✅ Done
- ~~**N4** — Phase 3-5 MCP migration~~ ✅ All three MCPs (Gmail, Memorizer, Telegram) use `McpServer` + `registerTool()` with annotations and `StandardResponse` from `@mcp/shared`. 47 redundant `safeParse()` calls remain in Gmail/Memorizer handlers (defense-in-depth, optional cleanup).
- ~~**N5** — Generic `registerTool<T>()`~~ ✅ Done as A4. Handler receives `z.infer<T>`, 47 casts removed across 6 MCPs.
- ~~**N6** — Embedding cache persistence~~ ✅ Done
