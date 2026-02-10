# Architecture Review - Annabelle MCP Ecosystem

**Date:** 2026-02-09

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

---

## Proposed Improvements

### 1. Adopt Workspace Tooling (High Impact, Medium Effort)

**Problem:** Each package is fully independent with its own `node_modules`. No dependency graph, no shared lockfile, duplicated dependencies across 11 packages.

**Now:** `rebuild.sh` manually builds Shared first, then parallelizes everything. No way to express "Orchestrator depends on Shared."

**Proposal:** Adopt **pnpm workspaces** (or npm workspaces):
- Single lockfile, deduped `node_modules`
- `pnpm --filter` to build/test individual packages
- Formal dependency graph (`@mcp/shared` as a workspace dependency)
- Drop `rebuild.sh` in favor of `pnpm -r run build` (topologically ordered)
- Turborepo optional on top for caching

### 2. Eliminate Duplicate Discovery Logic (Medium Impact, Medium Effort)

**Problem:** MCP discovery implemented **twice**: `start-all.sh` (bash + inline Node.js) and `Orchestrator/src/config/scanner.ts` (TypeScript). They can drift.

**Proposal:** Extract discovery into a small CLI in Shared (e.g. `npx @mcp/shared discover`). Both `start-all.sh` and Orchestrator invoke the same logic.

### 3. Clean Up Legacy References in `test.sh` (Medium Impact, Low Effort)

**Problem:** `test.sh` still checks legacy HTTP ports (8000, 8003, 8004, 8005) for MCPs that no longer expose those ports.

**Proposal:** Remove legacy health checks and curl tests. Current architecture only has HTTP on ports 8002, 8007, 8008, 8010.

### 4. Replace Keyword-Based Tool Selection (Medium Impact, Medium Effort)

**Problem:** Thinker's `tool-selector.ts` uses hardcoded regex (`/search|weather|news/`) to decide which tool groups to expose. Brittle — new MCPs' tools won't be selected unless someone updates the regex map.

**Options:**
- **Short-term:** Auto-include new MCPs' tools in a "default" group
- **Long-term:** Embedding-based classifier (nomic-embed already available via Ollama)

### 5. Adopt Shared Error Types Consistently (Low Impact, Low Effort)

**Problem:** `Shared/Types/errors.ts` defines `ConfigurationError`, `ValidationError`, `DatabaseError`, `NetworkError`, `TimeoutError` — but most MCPs just throw plain `Error`.

**Proposal:** Either use them or delete them. If keeping, `registerTool` wrapper should detect error subtypes and include `code` in StandardResponse.

### 6. Add Tests for Shared Package (High Impact, Low Effort)

**Problem:** `@mcp/shared` has zero tests. It contains `registerTool()`, `dual-transport`, `StandardResponse`, and logger — all critical infrastructure.

**Proposal:** Unit tests for `registerTool()`, `dual-transport`, `StandardResponse` helpers.

### 7. Consolidate Duplicated StandardResponse Types (Medium Impact, Low Effort)

**Problem:** Memorizer-MCP has its own `src/types/responses.ts` with `createSuccess()`, `createError()`, `createErrorFromException()`, and ~15 data type interfaces. Duplicates Shared.

**Proposal:** Keep Memorizer's response **data types** but import base `StandardResponse` + helpers from `@mcp/shared`.

### 8. Tighten HTTP Transport Security (High Impact, Low Effort)

**Problem:** `dual-transport.ts` sets `Access-Control-Allow-Origin: *` and has no auth on any endpoint.

**Proposal:**
- Bind to `127.0.0.1` explicitly
- Add shared secret token (`X-Annabelle-Token` header), generated per-session
- Restrict CORS to `localhost` origins

### 9. Standardize Logging (Low-Medium Impact, Low Effort)

**Problem:** Inconsistent logging. Shared has structured `Logger`, but Thinker uses raw `console.log`/`console.error`, and MCPs mix approaches.

**Proposal:** All packages use Shared `Logger` with consistent context prefix. JSONL logger in `Shared/Logging/jsonl.ts` is already there — underused.

### 10. Recover CodeExec-MCP Source (High Impact, Medium Effort)

**Problem:** Only `dist/` exists for CodeExec-MCP. Source lost or in another repo. Security-sensitive component.

**Proposal:** Reconstruct source or rebuild from scratch.

### 11. Formalize Orchestrator Internal Boundaries (Medium Impact, Medium Effort)

**Problem:** Orchestrator (~55 source files) handles discovery, routing, agent lifecycle, slash commands, halt management, Inngest jobs, Telegram polling, cost monitoring, and tool policy. Single point of failure.

**Proposal:** Split into clearer internal modules:
- `core/` — Express server, health, HTTP handlers
- `discovery/` — scanner + config schema
- `routing/` — ToolRouter + policy enforcement
- `agents/` — AgentManager + ThinkerClient
- `jobs/` — Inngest functions + cron
- `channels/` — Telegram polling + dispatch
- `commands/` — Slash command handlers

### 12. Add Structured Status Endpoint (Low Impact, Low Effort)

**Problem:** Monitoring requires checking individual `/health` endpoints on 4+ ports.

**Proposal:** Add `/status` on Orchestrator returning structured JSON with state of all MCPs, agents, Inngest, and Guardian.

---

## Priority Ranking

| # | Improvement | Effort | Impact |
|---|---|---|---|
| 1 | Workspace tooling (pnpm) | Medium | High |
| 3 | Clean up legacy test refs | Low | Medium |
| 7 | Consolidate StandardResponse dupes | Low | Medium |
| 6 | Shared package tests | Low | High |
| 2 | Deduplicate discovery logic | Medium | Medium |
| 10 | Recover CodeExec source | Medium | High |
| 4 | Better tool selection | Medium | Medium |
| 8 | HTTP transport security | Low | High |
| 11 | Split Orchestrator modules | Medium | Medium |
| 9 | Standardize logging | Low | Low-Medium |
| 5 | Use shared error types | Low | Low |
| 12 | Health dashboard endpoint | Low | Low |
