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
- **Session compaction** — summarize old turns, keep last 10
- **Subagent spawning** — single-level depth, cascade-kill, auto-kill timers
- **TypeScript strict mode** enabled globally via `tsconfig.base.json`
- **Test coverage** across 12/12 packages (133+ test files)
- **Localhost binding** — Orchestrator, Searcher, Inngest, dual-transport all bind `127.0.0.1`
- **Per-session auth token** — `ANNABELLE_TOKEN` generated per session, enforced on Orchestrator HTTP

---

## Carried Over — Unresolved (from previous review)

### 1. Adopt Workspace Tooling (High Impact, Medium Effort)

**Status:** Not started

**Problem:** Each package is fully independent with its own `node_modules`. No dependency graph, no shared lockfile, duplicated dependencies across 12 packages. Uses `file:../Shared` linking.

**Proposal:** Adopt **pnpm workspaces** (or npm workspaces):

- Single lockfile, deduped `node_modules`
- `pnpm --filter` to build/test individual packages
- Formal dependency graph (`@mcp/shared` as a workspace dependency)
- Drop `rebuild.sh` in favor of `pnpm -r run build` (topologically ordered)
- Turborepo optional on top for caching

### 4. Replace Keyword-Based Tool Selection (Medium Impact, Medium Effort)

**Status:** Not started

**Problem:** Thinker's `tool-selector.ts` uses hardcoded regex (`/search|weather|news/`) to decide which tool groups to expose. Brittle — new MCPs' tools won't be selected unless someone updates the regex map.

**Options:**

- **Short-term:** Auto-include new MCPs' tools in a "default" group
- **Long-term:** Embedding-based classifier (nomic-embed already available via Ollama)

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

#### A1. StandardResponse duplication in Gmail (Low)

**File:** `Gmail-MCP/src/types/responses.ts:5-9`

Gmail defines a local `StandardResponse` missing `errorCode` and `errorDetails` fields from `@mcp/shared`. Functionally works but creates two sources of truth.

**Fix:** Import from `@mcp/shared` like other MCPs. Part of the deferred Phase 3-5 migration.

#### A2. Channel extensibility is limited (Medium)

Telegram is hardcoded as the primary channel. A generic channel adapter exists (`Orchestrator/src/channels/adapters/generic-channel-adapter.ts`) but there's no "channel manifest" like MCPs have. Adding Discord or Slack requires writing a custom adapter in the Orchestrator codebase.

**Fix:** Define a channel plugin interface (similar to MCP auto-discovery). Low priority — Telegram is the only channel needed currently.

#### A3. No versioning strategy (Low-Medium)

All packages are at `1.0.0` (or `0.1.0` for Thinker). No changelog, no compatibility matrix, no semantic versioning. `@mcp/shared` is referenced via `file:../Shared` with no version constraint.

**Mitigating factor:** Single developer, single deployment. Versioning adds overhead without current benefit.

**Fix:** Adopt SemVer when workspace tooling (Item 1) is implemented. Not needed before that.

#### A4. Type safety gaps — 168 uses of `Record<string, unknown>` (Low-Medium)

The `registerTool()` handler receives `Record<string, unknown>` (by design in `Shared/Utils/register-tool.ts:50`). Callers must cast to their specific input type. This is a limitation of the SDK's type system — Zod validates at runtime, but TypeScript doesn't carry the validated type into the handler.

**Impact:** No IDE autocomplete for tool inputs inside handlers. Easy to access non-existent properties.

**Fix:** Consider a generic `registerTool<T>()` that passes `T` to the handler. Moderate effort, affects all MCPs.

#### A5. Test helper duplication across packages (Low)

MCP testing harnesses (`tests/helpers/mcp-client.ts`) are duplicated in Guardian, Searcher, and others. Each implements `Client` + `StdioClientTransport` setup independently.

**Fix:** Extract into `@mcp/shared/testing` when workspace tooling is adopted.

#### A6. Zod version drift across packages (Low)

| Package | Zod Version |
|---------|-------------|
| Shared | `^3.24.0` |
| Thinker | `^3.23.0` |
| Memorizer | `^3.22.0` |
| Others | `^3.24.0` |

All within 3.x semver range. Unlikely to cause issues but creates maintenance noise.

**Fix:** Unify to `^3.24.0` across all packages. Trivial fix, can be done anytime.

#### A7. Node engine constraints are inconsistent (Low)

| Package | Node Engines |
|---------|-------------|
| Orchestrator, Shared | `>=18.0.0` |
| Most MCPs | `>=20.0.0` |
| Gmail, Telegram | `>=22.0.0` |

No enforcement at build time. Deploying on Node 20 silently breaks Gmail/Telegram.

**Fix:** Unify to `>=20.0.0` or add an `.nvmrc` at the repo root. Low priority.

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

### Tier 4: Architecture (Higher effort, long-term benefit)

| # | Improvement | Effort | Impact |
|---|-------------|--------|--------|
| 1 | Workspace tooling (pnpm) | Medium | High |
| 4 | Better tool selection in Thinker | Medium | Medium |
| A4 | Generic `registerTool<T>()` for type safety | Medium | Medium |
| A2 | Channel plugin interface | Medium | Medium |
| A1 | StandardResponse dedup in Gmail | Low | Low |

### Tier 5: Housekeeping — ✅ PARTIAL

| # | Improvement | Status |
|---|-------------|--------|
| S3 | ~~Warn on missing `ANNABELLE_TOKEN`~~ | ✅ Done |
| S5 | ~~Add rate limiting~~ | ✅ Done |
| R4 | ~~Exponential backoff for agent restart~~ | ✅ Done |
| R2 | ~~Deep health checks~~ | ✅ Done |
| A6 | Unify Zod versions | Not started |
| A7 | Unify Node engine constraints | Not started |
| A5 | Extract shared test helpers | Not started |

### Design decisions (no action needed now)

| # | Topic | Notes |
|---|-------|-------|
| S6 | Indirect prompt injection | Architectural tradeoff — scanning outputs adds latency. Revisit if attack surface grows. |
| A3 | Versioning strategy | Adopt with workspace tooling (Item 1). No benefit before that. |
