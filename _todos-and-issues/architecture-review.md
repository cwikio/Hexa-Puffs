# Architecture Review - Annabelle MCP Ecosystem

**Date:** 2026-02-09
**Last updated:** 2026-02-10

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
- **Test coverage** across 11/12 packages (133 test files)

---

## Original Proposed Improvements

### ~~2. Eliminate Duplicate Discovery Logic~~ ✅ DONE

**Problem:** MCP discovery implemented **twice**: `start-all.sh` (bash + inline Node.js) and `Orchestrator/src/config/scanner.ts` (TypeScript). They can drift.

**Resolved:** Discovery unified into shared scanner. Both scripts invoke the same logic. (`723ce6b`)

### ~~3. Clean Up Legacy References in `test.sh`~~ ✅ DONE

**Problem:** `test.sh` still checks legacy HTTP ports (8000, 8003, 8004, 8005) for MCPs that no longer expose those ports.

**Resolved:** Legacy health checks and curl tests removed. (`e85ed09`)

### ~~5. Adopt Shared Error Types Consistently~~ ✅ DONE

**Problem:** `Shared/Types/errors.ts` defines `ConfigurationError`, `ValidationError`, `DatabaseError`, etc. — but most MCPs just threw plain `Error`.

**Resolved:** Orchestrator and Memorizer now extend `BaseError` from `@mcp/shared` with custom error hierarchies. (`276f1c7`)

### ~~6. Add Tests for Shared Package~~ ✅ DONE

**Problem:** `@mcp/shared` had zero tests. It contains `registerTool()`, `dual-transport`, `StandardResponse`, and logger — all critical infrastructure.

**Resolved:** Unit tests added for config, dual-transport, errors, logger, scanner, register-tool, and standard-response. (`ea8c5e4`)

### ~~7. Consolidate Duplicated StandardResponse Types~~ ✅ DONE

**Problem:** Memorizer-MCP had its own `src/types/responses.ts` with `createSuccess()`, `createError()`, `createErrorFromException()`, duplicating Shared.

**Resolved:** Memorizer now imports base `StandardResponse` + helpers from `@mcp/shared`. Local `types/responses.ts` only contains domain-specific data shapes. (`276f1c7`)

### ~~10. Recover CodeExec-MCP Source~~ ✅ DONE

**Problem:** Only `dist/` existed for CodeExec-MCP. Source lost or in another repo.

**Resolved:** Full source reconstructed in `src/` with config, executor, logging, sessions, tools, and utils modules. (`c3eb76e`)

### ~~11. Formalize Orchestrator Internal Boundaries~~ ✅ DONE

**Problem:** Orchestrator (~55 source files) handled everything in a flat structure. Single point of failure.

**Resolved:** Split into `core/`, `discovery/`, `routing/`, `agents/`, `jobs/`, `channels/`, `commands/` modules. (`5b812d9`)

### ~~12. Add Structured Status Endpoint~~ ✅ DONE

**Problem:** Monitoring required checking individual `/health` endpoints on 4+ ports.

**Resolved:** `/status` endpoint on Orchestrator returns structured JSON with state of all MCPs, agents, Inngest, and Guardian. (`b1c8f0c`)

---

## Remaining Items (from original list)

### 1. Adopt Workspace Tooling (High Impact, Medium Effort)

**Status:** Not started

**Problem:** Each package is fully independent with its own `node_modules`. No dependency graph, no shared lockfile, duplicated dependencies across 11 packages. Uses `file:../Shared` linking.

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

### ~~8. Tighten HTTP Transport Security~~ ✅ DONE

**Problem:** `dual-transport.ts` sets `Access-Control-Allow-Origin: *`, binds `0.0.0.0` (all interfaces), and has no auth on any endpoint. Exposes `/tools/call`, `/sse`, `/message` to anyone on the network.

**Resolved:** All HTTP servers (dual-transport, Searcher, Orchestrator, Inngest) bind `127.0.0.1`. CORS restricted to `localhost`/`127.0.0.1` origins. `start-all.sh` generates a per-session `ANNABELLE_TOKEN` (saved to `~/.annabelle/annabelle.token`), passed to all services. Non-`/health` requests require `X-Annabelle-Token` header. Orchestrator's `BaseMCPClient` sends the token on all outgoing HTTP calls. `test.sh` reads the token from file.

### 9. Standardize Logging (Low-Medium Impact, Low Effort)

**Status:** Partially done

**Current state:** Orchestrator (100% shared Logger, 0 console.log), Guardian, Filer, Memorizer all use shared Logger. **Thinker is the outlier** — 110 `console.log` occurrences across 13 files vs 13 shared Logger calls.

**Remaining:** Migrate Thinker from `console.log`/`console.error` to shared `Logger`.

---

## New Findings (2026-02-10 review)

### ~~A. rebuild.sh uses `require()` in ESM context~~ ✅ DONE

**Problem:** `rebuild.sh` uses inline `require('package.json')` in Node.js snippets, but the entire codebase is ESM-only (`"type": "module"`). This will break when Node enforces ESM strictly.

**Resolved:** Replaced `node -e "require(...)"` with `grep -q '"build"\s*:'` — no Node invocation needed.

### ~~B. restart.sh `pkill` pattern is too broad~~ ✅ DONE

**Problem:** `pkill -f "node dist"` kills **any** node process with "dist" in argv — could nuke unrelated processes.

**Resolved:** Replaced with 3-layer kill: SIGTERM saved PIDs from `~/.annabelle/annabelle.pids`, then SIGKILL by infrastructure ports, then SIGKILL by discovered HTTP MCP ports.

### ~~C. start-all.sh has no error propagation~~ ✅ DONE

**Problem:** No `set -e`. If a service fails to start, the script carries on and reports "ready" with broken services. Health checks warn but don't fail the script.

**Resolved:** Added `kill -0` process-alive checks after each service start. Orchestrator death aborts the script; HTTP MCPs and Inngest warn on immediate death.

### ~~D. start-all.sh legacy port cleanup~~ ✅ DONE

**Problem:** Lines 82-84 kill processes on ports 8000, 8004, 8005 — legacy from when Filer/Memorizer were HTTP MCPs. Dead code, and `kill -9` on unknown PIDs is a risk.

**Resolved:** Removed legacy port cleanup lines. Updated tip to reference `./restart.sh` instead of `pkill -f "node dist"`.

### E. 1Password-MCP has zero tests (Medium Impact, Low Effort)

**Problem:** Only package with no test files (11/12 have tests). Has `vitest.config.ts` but no actual tests. Read-only MCP but still untested.

**Fix:** Add integration tests for vault listing and item retrieval tools.

### F. Guardian still uses plain `Error` (Low Impact, Low Effort)

**Problem:** Orchestrator and Memorizer extend `BaseError` from shared. Guardian still uses `throw new Error()` in 3 files (groq/safeguard-client.ts, groq/client.ts, ollama/client.ts).

**Fix:** Extend shared error types in Guardian.

### G. Deprecated `Server` class in Gmail, Telegram, Memorizer (Low Impact, Medium Effort)

**Problem:** Phase 3-5 of the `McpServer` migration is still deferred. These packages use the old `Server` class from SDK (deprecated in 1.25.3). Not broken, but deprecated.

**Fix:** Migrate to `McpServer` class per `new-mcp-plan.md`.

### H. TESTING.md references legacy ports (Low Impact, Low Effort)

**Problem:** TESTING.md (lines 34-38) still references ports 8003, 8004, 8005 for Guardian, Filer, and Memorizer. Stale docs.

**Fix:** Update TESTING.md to reflect current architecture.

---

## Updated Priority Ranking

### ~~Tier 1: Broken / real risk~~ ✅ ALL DONE

| #   | Improvement                              | Effort | Impact | Status |
| --- | ---------------------------------------- | ------ | ------ | ------ |
| ~~A~~ | ~~Fix `require()` in rebuild.sh (ESM)~~  | Low  | High   | ✅ |
| ~~B~~ | ~~Fix broad `pkill` in restart.sh~~      | Low  | High   | ✅ |
| ~~C~~ | ~~Add error propagation to start-all.sh~~| Low  | Medium | ✅ |
| ~~D~~ | ~~Remove legacy port cleanup in start-all~~| Low | Low   | ✅ |

### ~~Tier 2: Security~~ ✅ ALL DONE

| #   | Improvement                              | Effort | Impact | Status |
| --- | ---------------------------------------- | ------ | ------ | ------ |
| ~~8~~ | ~~HTTP transport security (CORS, bind, auth)~~ | Low  | High   | ✅ |

### Tier 3: Test gaps

| #   | Improvement                              | Effort | Impact |
| --- | ---------------------------------------- | ------ | ------ |
| E   | Add tests for 1Password-MCP             | Low    | Medium |

### Tier 4: Consistency

| #   | Improvement                              | Effort | Impact |
| --- | ---------------------------------------- | ------ | ------ |
| 9   | Thinker logging (console → Logger)       | Low    | Low-Med |
| F   | Guardian shared error types              | Low    | Low    |
| H   | Fix stale TESTING.md                     | Low    | Low    |
| G   | Server → McpServer migration (3 MCPs)   | Medium | Low    |

### Tier 5: Structural (park until pain is felt)

| #   | Improvement                              | Effort | Impact |
| --- | ---------------------------------------- | ------ | ------ |
| 1   | Workspace tooling (pnpm)                 | Medium | High   |
| 4   | Better tool selection in Thinker         | Medium | Medium |
