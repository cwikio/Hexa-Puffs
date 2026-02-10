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

### 5. Inconsistent dotenv handling
- Only CodeExec and Guardian check `existsSync()` before loading dotenv. All others load unconditionally — dotenv v17 writes debug messages to stdout, corrupting stdio transport.
- **Fix:** Apply CodeExec pattern (`existsSync` + `quiet: true`) to all MCPs.

### 6. Gmail token validation — warn instead of fail
- **File:** `Gmail-MCP/src/index.ts:30-33`
- Missing/expired OAuth token only logs a warning. MCP continues accepting tool calls that will fail.
- **Fix:** Fail fast or report unhealthy on missing token.

### 7. Searcher — no Brave API rate limiting
- No client-side rate limiting. Under heavy Thinker multi-step loops, API keys could get rate-limited with no backoff.
- **Fix:** Add rate limiter (e.g., token bucket or simple delay).

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

### 11. Silent migration error swallowing
- **Files:** `Filer-MCP/src/db/index.ts`, `Memorizer-MCP/src/db/index.ts`
- Both catch all errors during SQLite migrations and ignore them ("column likely exists"). Can hide real schema corruption.
- **Fix:** Check for specific "column already exists" error instead of catch-all.

### 12. Memorizer — weak ID generation
- **File:** `Memorizer-MCP/src/db/index.ts`
- Uses `Date.now() + Math.random()` for IDs. Not collision-proof under rapid concurrent inserts (e.g., batch fact extraction).
- **Fix:** Use `nanoid` or `crypto.randomUUID()`.

### 13. Memorizer — silent vector search degradation
- If `sqlite-vec` fails to load, vector search is silently disabled. Only a warning log. Users may not realize they're getting LIKE fallback.
- **Fix:** Expose vector search status in health endpoint.

### 14. Dependency version inconsistency
- `dotenv` v16 in Memorizer vs v17 elsewhere. `zod` 3.22 vs 3.24.
- **Fix:** Align versions across all packages.

### 15. Tool selector — keyword-only routing (Thinker)
- **File:** `Thinker/src/agent/tool-selector.ts`
- Regex patterns only. No fuzzy/semantic matching — synonyms or indirect references miss (e.g., "look up my passwords" won't match unless "password" is in the regex).
- **Fix:** Consider embedding-based classification or expanded keyword sets.

### 16. Cost monitor tracks tokens, not dollars (Thinker)
- **File:** `Thinker/src/cost/monitor.ts`
- Spike detection is token-based, but actual cost varies dramatically by model. A model switch could blow through budgets while staying under token caps.
- **Fix:** Add model pricing table and track estimated cost.

### 17. CodeExec — no fork bomb protection
- No process limits or cgroup constraints. Executed code could spawn unlimited processes.
- **Fix:** Add `ulimit` or cgroup constraints to subprocess spawning.

### 18. 1Password — health check doesn't validate
- `/health` returns OK without verifying `op` CLI is accessible or authenticated.
- **Fix:** Run `op whoami` or similar in health check.

---

## LOW / TECH DEBT

### 19. `any` types across MCPs
- Searcher, Filer, and Telegram toolHandler maps use `any` with eslint-disable.
- **Fix:** Replace with proper generics or `unknown` + type guards.

### ~~20. No unified logging strategy~~ ✅
- ~~Some MCPs use shared logger, others use raw `console.error`, Telegram kills `console.log`. No consistent approach.~~
- ~~**Fix:** Migrate all MCPs to shared logger.~~

### 21. Health check inconsistency
- Guardian validates provider connection; most others return static `{ status: "healthy" }`.
- **Fix:** Standardize health checks to validate actual functionality.

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
| Health validation | Guardian | 1Password, Searcher, Filer |

---

## Summary

- ~~3~~ **1 critical** issue remaining (Telegram logging) — ✅ 2 fixed (Filer path traversal, Filer grants race condition)
- ~~5~~ **3 high** issues remaining (dotenv, token validation, rate limiting) — ✅ 2 fixed (1Password tests, StandardResponse dupes)
- ~~10~~ **9 medium** issues remaining — ✅ 1 fixed (register-tool generics)
- ~~8~~ **5 low** issues remaining — ✅ 3 fixed (unified logging, fact dedup, Gmail split, 1Password SSE)
