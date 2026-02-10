# Codebase Review — Annabelle MCP Ecosystem

**Date:** 2026-02-09
**Scope:** Full monorepo review (Orchestrator, Thinker, Guardian, 1Password, Searcher, Filer, Memorizer, Telegram, Gmail, CodeExec, Shared)

---

## CRITICAL

### 1. Telegram `console.log` suppression
- **File:** `Telegram-MCP/src/index.ts:7`
- `console.log = () => {}` globally kills all console.log output to prevent GramJS noise from corrupting stdio transport. This silences logging from every dependency, making debugging nearly impossible.
- **Fix:** Targeted GramJS log interception instead of global suppression.

### ~~2. Filer path traversal weakness~~ ✅
- ~~**File:** `Filer-MCP/src/utils/paths.ts`~~
- ~~`hasPathTraversal` only checks for `..` substring. Doesn't handle encoded traversal (`%2e%2e`), and paths are resolved *before* checking forbidden directories, so symlinks could bypass protections.~~
- ~~**Fix:** Resolve path first, then check against allowlist. Handle URL-encoded sequences.~~ *(hasPathTraversal now decodes URL-encoded sequences; resolvePath resolves symlinks via realpathSync and re-checks forbidden/workspace boundaries.)*

### ~~3. Filer grants race condition~~ ✅
- ~~**File:** `Filer-MCP/src/db/grants.ts`~~
- ~~`recordAccess` does read-modify-save without locking. Concurrent tool calls can silently lose grant updates.~~
- ~~**Fix:** Add SQLite transaction or mutex around grant operations.~~ *(saveGrants now serialized via Promise queue; generateGrantId uses crypto.randomUUID.)*

---

## HIGH

### ~~4. Missing tests — 1Password MCP~~ ✅
- ~~No test files, no test script in package.json.~~
- ~~**Fix:** Add at least basic integration tests for `op` CLI wrapper.~~

### ~~5. Inconsistent dotenv handling~~ ✅
- ~~Only CodeExec and Guardian check `existsSync()` before loading dotenv. All others load unconditionally — dotenv v17 writes debug messages to stdout, corrupting stdio transport.~~
- ~~**Fix:** Apply CodeExec pattern (`existsSync` + `quiet: true`) to all MCPs.~~ *(Applied `existsSync` + `quiet: true` pattern to Guardian, Filer, Memorizer, Searcher, Gmail, Orchestrator, and Thinker.)*

### ~~6. Gmail token validation — warn instead of fail~~ ✅
- ~~**File:** `Gmail-MCP/src/index.ts:30-33`~~
- ~~Missing/expired OAuth token only logs a warning. MCP continues accepting tool calls that will fail.~~
- ~~**Fix:** Fail fast or report unhealthy on missing token.~~ *(Health endpoint now returns `status: 'degraded'` when token missing. Tool calls fail early with clear auth error. Startup logs at error level.)*

### ~~7. Searcher — no Brave API rate limiting~~ ✅
- ~~No client-side rate limiting. Under heavy Thinker multi-step loops, API keys could get rate-limited with no backoff.~~
- ~~**Fix:** Add rate limiter (e.g., token bucket or simple delay).~~ *(1 req/sec delay gate in `Searcher-MCP/src/services/brave.ts`.)*

### ~~8. Duplicate `StandardResponse` definitions~~ ✅
- ~~Searcher and Filer both have local `types/shared.ts` with their own `StandardResponse` instead of importing from `@mcp/shared`.~~
- ~~**Fix:** Remove local copies, import from shared package.~~

---

## MEDIUM

### ~~9. `register-tool` type safety gap (Shared)~~ ✅
- ~~**File:** `Shared/Utils/register-tool.ts`~~
- ~~Handler signature is `Record<string, unknown>` — every MCP handler must cast with `as FooInput`. No compile-time safety for tool inputs.~~
- ~~**Fix:** Investigate generic type parameter on `registerTool` to propagate input type.~~

### 10. Shared dual-transport signal handler stacking
- **File:** `Shared/Utils/dual-transport.ts`
- SIGINT/SIGTERM handlers are added each time `startTransport()` is called. Multiple invocations stack handlers, causing duplicate cleanup.
- **Fix:** Guard against duplicate registration or use `process.once()`.

### ~~11. Silent migration error swallowing~~ ✅
- ~~**Files:** `Filer-MCP/src/db/index.ts`, `Memorizer-MCP/src/db/index.ts`~~
- ~~Both catch all errors during SQLite migrations and ignore them ("column likely exists"). Can hide real schema corruption.~~
- ~~**Fix:** Check for specific "column already exists" error instead of catch-all.~~ *(Migration catch now checks for "duplicate column name" / "already exists"; unexpected errors re-throw as DatabaseError. Filer uses JSON storage, not affected.)*

### ~~12. Memorizer — weak ID generation~~ ✅
- ~~**File:** `Memorizer-MCP/src/db/index.ts`~~
- ~~Uses `Date.now() + Math.random()` for IDs. Not collision-proof under rapid concurrent inserts (e.g., batch fact extraction).~~
- ~~**Fix:** Use `nanoid` or `crypto.randomUUID()`.~~ *(Now uses `crypto.randomUUID()`, same pattern as Filer-MCP's `generateGrantId()`.)*

### ~~13. Memorizer — silent vector search degradation~~ ✅
- ~~If `sqlite-vec` fails to load, vector search is silently disabled. Only a warning log. Users may not realize they're getting LIKE fallback.~~
- ~~**Fix:** Expose vector search status in health endpoint.~~ *(`get_memory_stats` now returns `search_capabilities` with sqlite-vec status, embedding provider, FTS5 availability, and active search mode.)*

### ~~14. Dependency version inconsistency~~ ✅
- ~~`dotenv` v16 in Memorizer vs v17 elsewhere. `zod` 3.22 vs 3.24.~~
- ~~**Fix:** Align versions across all packages.~~ *(dotenv unified to ^17.2.4 across all 9 packages. Zod previously unified to ^3.24.0 in architecture review A6.)*

### ~~15. Tool selector — keyword-only routing (Thinker)~~ ✅
- ~~**File:** `Thinker/src/agent/tool-selector.ts`~~
- ~~Regex patterns only. No fuzzy/semantic matching — synonyms or indirect references miss (e.g., "look up my passwords" won't match unless "password" is in the regex).~~
- ~~**Fix:** Consider embedding-based classification or expanded keyword sets.~~ *(Embedding-based semantic selector implemented in `embedding-tool-selector.ts` using Ollama + cosine similarity. Regex selector kept as fallback. Tests in `embedding-tool-selector.test.ts`.)*

### 16. Cost monitor tracks tokens, not dollars (Thinker)
- **File:** `Thinker/src/cost/monitor.ts`
- Spike detection is token-based, but actual cost varies dramatically by model. A model switch could blow through budgets while staying under token caps.
- **Fix:** Add model pricing table and track estimated cost.

### ~~17. CodeExec — no fork bomb protection~~ ✅
- ~~No process limits or cgroup constraints. Executed code could spawn unlimited processes.~~
- ~~**Fix:** Add `ulimit` or cgroup constraints to subprocess spawning.~~ *(Commands now wrapped with `ulimit -u` (max processes) and `-f` (max file size) via bash. Applied to both one-shot execution and REPL sessions. Configurable via `CODEXEC_MAX_PROCESSES` and `CODEXEC_MAX_FILE_SIZE_BYTES`.)*

### ~~18. 1Password — health check doesn't validate~~ ✅
- ~~`/health` returns OK without verifying `op` CLI is accessible or authenticated.~~
- ~~**Fix:** Run `op whoami` or similar in health check.~~ *(Health endpoint now calls `op whoami` via `checkAuth()`. Returns `opCli: "authenticated"` with account info, or `"unauthenticated"` with 503 status.)*

---

## LOW / TECH DEBT

### ~~19. `any` types across MCPs~~ ✅
- ~~Searcher, Filer, and Telegram toolHandler maps use `any` with eslint-disable.~~
- ~~**Fix:** Replace with proper generics or `unknown` + type guards.~~ *(Added `ToolMapEntry` + `toolEntry<T>()` helper to `@mcp/shared`. Searcher/Filer use `toolEntry(schema, handler)` for compile-time type safety. Telegram uses `createToolEntry()` + derives `toolHandlers` from `allTools`. Zero `any` remaining, zero eslint-disable comments.)*

### ~~20. No unified logging strategy~~ ✅
- ~~Some MCPs use shared logger, others use raw `console.error`, Telegram kills `console.log`. No consistent approach.~~
- ~~**Fix:** Migrate all MCPs to shared logger.~~

### ~~21. Health check inconsistency~~ ✅
- ~~Guardian validates provider connection; most others return static `{ status: "healthy" }`.~~
- ~~**Fix:** Standardize health checks to validate actual functionality.~~ *(All MCPs now validate: 1Password checks `op whoami`, Searcher checks Brave API key, Filer checks workspace dir, Telegram reports GramJS connection status, Memorizer checks SQLite + sqlite-vec. All return `healthy`/`degraded` with 200/503.)*

### 22. Thinker session compaction loses metadata
- After compaction, `toolsUsed` and exact token counts from older turns are lost.
- **Fix:** Preserve metadata summary in compaction output.

### ~~23. Thinker fact extraction — no semantic dedup~~ ✅
- ~~Deduplication is string comparison only. "Tomasz likes coffee" and "User enjoys coffee" would both be stored.~~
- ~~**Fix:** Use embedding similarity for dedup.~~ *(Now uses LLM-based dedup — passes known facts to extraction prompt to prevent duplicates.)*

### 24. Thinker trace logs grow unbounded
- JSONL append-only logs in `~/.annabelle/logs/` have no rotation or archival.
- **Fix:** Add log rotation (e.g., daily files, max retention).

### ~~25. Gmail — large monolithic `server.ts`~~ ✅
- ~~301-line `createServer` function with all tool definitions inline.~~
- ~~**Fix:** Split into per-tool modules.~~ *(Tools now in `/tools/` subdirectory with separate modules.)*

### ~~26. 1Password — incomplete SSE endpoint~~ ✅
- ~~`/messages` POST just returns `{status: "ok"}` without handling the message. Dead stub code.~~
- ~~**Fix:** Remove or implement.~~ *(Now implemented — reads request body and returns proper response.)*

---

## Cross-cutting patterns

| Pattern | Good examples | Bad examples |
|---|---|---|
| dotenv safety | CodeExec, Guardian | Searcher, Filer, Telegram, Gmail |
| StandardResponse | Guardian, Memorizer, Searcher, Filer | ~~Searcher (local dupe), Filer (local dupe)~~ |
| Test coverage | Memorizer, CodeExec, Gmail, 1Password | ~~1Password (none)~~, Telegram (minimal) |
| Health validation | Guardian, ~~1Password~~, ~~Searcher~~, ~~Filer~~, Gmail, Telegram, Memorizer | ~~1Password, Searcher, Filer~~ |

---

## Summary

- ~~3~~ **1 critical** issue remaining (Telegram logging) — ✅ 2 fixed (Filer path traversal, Filer grants race condition)
- ~~5~~ **0 high** issues remaining — ✅ 5 fixed (1Password tests, dotenv, token validation, rate limiting, StandardResponse dupes)
- ~~10~~ **3 medium** issues remaining (#10 signal handlers, #16 cost monitor) — ✅ 7 fixed (+tool selector, fork bomb, 1Password health)
- ~~8~~ **2 low** issues remaining (#22 compaction metadata, #24 log rotation) — ✅ 6 fixed (+health consistency, any types)

---

## Status Snapshot (2026-02-10)

| # | Severity | Item | Status |
|---|---|---|---|
| 1 | CRITICAL | Telegram `console.log` suppression | Open |
| 2 | CRITICAL | Filer path traversal | ✅ Fixed |
| 3 | CRITICAL | Filer grants race condition | ✅ Fixed |
| 4 | HIGH | 1Password tests | ✅ Fixed |
| 5 | HIGH | dotenv handling | ✅ Fixed |
| 6 | HIGH | Gmail token validation | ✅ Fixed |
| 7 | HIGH | Searcher rate limiting | ✅ Fixed |
| 8 | HIGH | StandardResponse dupes | ✅ Fixed |
| 9 | MEDIUM | register-tool type safety | ✅ Fixed |
| 10 | MEDIUM | Signal handler stacking | Open |
| 11 | MEDIUM | Migration error swallowing | ✅ Fixed |
| 12 | MEDIUM | Memorizer weak ID generation | ✅ Fixed |
| 13 | MEDIUM | Memorizer vector search degradation | ✅ Fixed |
| 14 | MEDIUM | Dependency version inconsistency | ✅ Fixed |
| 15 | MEDIUM | Tool selector keyword-only routing | ✅ Fixed |
| 16 | MEDIUM | Cost monitor tokens not dollars | Open |
| 17 | MEDIUM | CodeExec fork bomb protection | ✅ Fixed |
| 18 | MEDIUM | 1Password health check | ✅ Fixed |
| 19 | LOW | `any` types across MCPs | ✅ Fixed |
| 20 | LOW | Unified logging strategy | ✅ Fixed |
| 21 | LOW | Health check inconsistency | ✅ Fixed |
| 22 | LOW | Session compaction metadata loss | Open (accepted) |
| 23 | LOW | Fact extraction semantic dedup | ✅ Fixed |
| 24 | LOW | Trace logs grow unbounded | Open |
| 25 | LOW | Gmail monolithic server.ts | ✅ Fixed |
| 26 | LOW | 1Password incomplete SSE | ✅ Fixed |

**Score: 20/26 fixed (77%) — 6 remaining (1 critical, 2 medium, 1 accepted, 2 low)**
