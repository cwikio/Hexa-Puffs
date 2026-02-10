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

#### S3. Auth bypass when `ANNABELLE_TOKEN` is unset (Low-Medium)

**File:** `Orchestrator/src/index.ts:68`
```typescript
if (ANNABELLE_TOKEN && req.headers['x-annabelle-token'] !== ANNABELLE_TOKEN) {
```

If the env var is missing or empty, the condition short-circuits and **all requests are accepted**. The `start-all.sh` script always generates a token, so this only affects manual/dev startup.

**Fix:** Either fail startup if `ANNABELLE_TOKEN` is not set in HTTP mode, or log a prominent warning at boot.

#### S4. HTTP request body has no size limit (Medium)

**File:** `Orchestrator/src/core/http-handlers.ts:99-101`
```typescript
req.on('data', (chunk) => {
  body += chunk;
});
```

Same pattern in `Filer-MCP/src/index.ts:119-120` and `Onepassword-MCP/src/index.ts:37-39`. No `MAX_BODY_SIZE` check. A malicious or buggy client can send unbounded data, exhausting memory.

**Fix:** Add a size limit (e.g., 10 MB) and reject with 413 if exceeded.

#### S5. No rate limiting on any HTTP endpoint (Low)

No rate limiting on `/tools/call`, `/process-message`, `/execute-skill`, or any other endpoint across Orchestrator, Thinker, Searcher, or Gmail.

**Mitigating factor:** All services bind `127.0.0.1` (except Thinker — see S2), so only local processes can reach them.

**Fix:** Low priority since traffic is local. Consider adding basic rate limiting if any service is ever exposed externally.

#### S6. Indirect prompt injection — tool outputs not scanned (Design Limitation)

Guardian scans **incoming user input** for prompt injection. However, tool outputs (web search results from Searcher, email content from Gmail, Telegram messages) are fed back to the LLM without re-scanning.

**Attack path:** Attacker sends malicious content via email or Telegram → tool fetches it → Thinker feeds it to LLM unscanned → injected prompt executes.

**Fix:** This is an architectural choice (scanning outputs adds latency and cost). Consider: (a) scanning tool outputs from external-facing MCPs (Searcher, Gmail, Telegram) only, or (b) adding output sanitization hints to the system prompt.

---

### Performance

#### P1. No retry logic on HTTP MCP calls (Medium)

**File:** `Orchestrator/src/mcp-clients/base.ts:79-131`

`callMCP()` makes a single HTTP request with `AbortSignal.timeout()`. On timeout or transient failure, the call fails immediately. No retry with exponential backoff.

**Impact:** Intermittent network issues or brief MCP restarts cause permanent tool call failures.

**Fix:** Add retry (2-3 attempts) with exponential backoff for transient errors (timeouts, 503s, connection refused). Don't retry 4xx errors.

#### P2. No HTTP connection pooling (Low-Medium)

**Files:**
- `Orchestrator/src/mcp-clients/base.ts:92` — fresh `fetch()` per call
- `Thinker/src/orchestrator/client.ts:49-54` — same pattern

Each tool call creates a new TCP connection. No HTTP keep-alive or agent reuse.

**Impact:** Extra latency per call. Under high throughput, TCP TIME_WAIT state accumulates.

**Fix:** Use Node.js `http.Agent` with `keepAlive: true` or the `undici` pool. Low priority — current throughput doesn't stress this.

#### P3. No SQLite `busy_timeout` in Memorizer (Low-Medium)

**File:** `Memorizer-MCP/src/db/index.ts:24-27`

WAL mode and foreign keys are set, but no `PRAGMA busy_timeout`. Under concurrent access (multiple tool calls to Memorizer), SQLite returns `SQLITE_BUSY` immediately instead of retrying.

**Fix:** `db.pragma('busy_timeout = 5000')` after WAL mode — gives 5 seconds of retry.

#### P4. Tool discovery cache in Thinker never invalidated (Low)

**File:** `Thinker/src/orchestrator/client.ts:84-88`

Tools are cached in a Map after first discovery. If an MCP restarts and its tool set changes, Thinker uses stale definitions until restarted.

**Fix:** Add a TTL (e.g., 10 minutes) or invalidate on tool call error.

#### P5. Session JSONL files grow without auto-compaction (Low)

**File:** `Thinker/src/session/store.ts`

Sessions append to JSONL files. `compact()` method exists but is only called manually. Long-running sessions accumulate many lines.

**Mitigating factor:** Session compaction (summarize old turns) happens at the conversation level in the agent loop, limiting how much actually accumulates.

**Fix:** Low priority. Consider auto-compacting when file exceeds a size threshold.

---

### Reliability

#### R1. Guardian not re-registered with tool router after restart (Medium)

**File:** `Orchestrator/src/core/orchestrator.ts:413-417`

The health check loop restarts crashed Guardian, but intentionally skips re-registering it with the tool router (comment: "don't re-register guardian"). This is correct — Guardian is used internally by `StdioGuardianClient`, not as a passthrough MCP.

**However:** If the `StdioGuardianClient` holds a reference to the old transport/connection, the restarted Guardian process may not receive scan requests through the old handle. Need to verify the client reconnects after restart.

**Fix:** Verify that `StdioGuardianClient` detects the restart and re-establishes the connection. If not, add reconnection logic.

#### R2. Health checks are shallow (Low-Medium)

**Files:**
- `Orchestrator/src/mcp-clients/base.ts:67-77` — HTTP health: just `GET /health`, checks `response.ok`
- `Orchestrator/src/mcp-clients/stdio-client.ts` — stdio health: calls `listTools()`

HTTP health checks only verify the process is listening. They don't test database connectivity (Memorizer), API key validity (Guardian/Searcher), or tool execution.

**Mitigating factor:** Stdio health via `listTools()` is deeper (verifies MCP protocol works). Most MCPs run as stdio.

**Fix:** Low priority. Add deep health checks (e.g., Memorizer tests a simple query) if reliability becomes an issue.

#### R3. Graceful shutdown doesn't flush Thinker sessions (Low-Medium)

**File:** `Thinker/src/index.ts:272-280`

SIGINT/SIGTERM handlers just call `process.exit(0)`. In-flight conversation state and active extraction timers are lost. `restart.sh` sends SIGKILL (`-9`) which bypasses handlers entirely.

**Fix:** Add `await agent.flushSessions()` before exit. In `restart.sh`, send SIGTERM first, wait 5 seconds, then SIGKILL.

#### R4. Agent restart uses fixed cooldown, not exponential backoff (Low)

**File:** `Orchestrator/src/agents/agent-manager.ts:84-85`

Max 5 restarts with fixed 10-second cooldown. If an agent fails due to a persistent issue, it burns through all retries in 50 seconds.

**Fix:** Use exponential backoff (10s, 20s, 40s, 80s, 160s). Low priority — current restart behavior is adequate for the common case (transient crashes).

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

### Tier 1: Quick security wins (Low effort, real risk reduction)

| # | Improvement | Effort | Impact |
|---|-------------|--------|--------|
| S2 | Bind Thinker to `127.0.0.1` | 1 line | High |
| S4 | Add HTTP body size limit | Low | Medium |
| P3 | Add SQLite `busy_timeout` | 1 line | Medium |

### Tier 2: Reliability improvements (Low-Medium effort)

| # | Improvement | Effort | Impact |
|---|-------------|--------|--------|
| P1 | Add retry logic with backoff to HTTP MCP calls | Low-Med | High |
| R1 | Verify Guardian client reconnects after restart | Low | Medium |
| R3 | Flush Thinker sessions on shutdown | Low | Medium |
| S1 | Fix CORS in Guardian/Filer/1Password HTTP mode | Low | Low-Med |

### Tier 3: Performance (Medium effort, measurable improvement)

| # | Improvement | Effort | Impact |
|---|-------------|--------|--------|
| P2 | HTTP connection pooling | Medium | Medium |
| P4 | Tool cache invalidation in Thinker | Low | Low |
| P5 | Session JSONL auto-compaction | Low | Low |

### Tier 4: Architecture (Higher effort, long-term benefit)

| # | Improvement | Effort | Impact |
|---|-------------|--------|--------|
| 1 | Workspace tooling (pnpm) | Medium | High |
| 4 | Better tool selection in Thinker | Medium | Medium |
| A4 | Generic `registerTool<T>()` for type safety | Medium | Medium |
| A2 | Channel plugin interface | Medium | Medium |
| A1 | StandardResponse dedup in Gmail | Low | Low |

### Tier 5: Housekeeping (Low effort, low impact)

| # | Improvement | Effort | Impact |
|---|-------------|--------|--------|
| A6 | Unify Zod versions | Trivial | Low |
| A7 | Unify Node engine constraints | Trivial | Low |
| A5 | Extract shared test helpers | Low | Low |
| S3 | Warn on missing `ANNABELLE_TOKEN` | Low | Low |
| S5 | Add rate limiting (if exposed) | Low | Low |
| R4 | Exponential backoff for agent restart | Low | Low |
| R2 | Deep health checks | Low | Low |

### Design decisions (no action needed now)

| # | Topic | Notes |
|---|-------|-------|
| S6 | Indirect prompt injection | Architectural tradeoff — scanning outputs adds latency. Revisit if attack surface grows. |
| A3 | Versioning strategy | Adopt with workspace tooling (Item 1). No benefit before that. |
