# Architecture Guardian Review: Orchestrator, Thinker, Memorizer, Filer

## Context

Comprehensive architectural review of the four core Hexa-Puffs components (Orchestrator, Thinker, Memorizer-MCP, Filer-MCP) plus the Shared package. The goal is to identify architectural flaws, inconsistencies, and improvement opportunities — not to implement changes.

This is a **read-only assessment**. No code changes proposed — only findings and recommendations for future work.

---

## Overall Verdict

The architecture is **fundamentally sound**. The four-tier design (Orchestrator > Thinker > MCPs > Shared) with MCP protocol as the process boundary is the right call. Each component has clear responsibility. The system is well-tested (~90+ test files total) and has genuine production-grade features (health monitoring, cost controls, auto-restart, Guardian security, audit logging).

That said, there are **real flaws** worth addressing. Below are the findings ranked by severity.

---

## Critical Findings

### 1. Four conflicting `ValidationError` classes

**Files:**
- `Shared/Types/errors.ts:31` — `ValidationError extends BaseError` (code-based)
- `Shared/Types/tools.ts:42` — `ValidationError extends Error` (carries `zodError` field)
- `Orchestrator/src/utils/errors.ts:61` — `ValidationError extends OrchestratorError`
- `Memorizer-MCP/src/utils/errors.ts:32` — `ValidationError extends MemoryError`

**Problem:** The `tools.ts` version does NOT extend `BaseError`, so `instanceof BaseError` checks fail on it. A catch block checking `instanceof ValidationError` produces different results depending on which import is used. The `zodError` field is lost when `createErrorFromException` handles it as a plain `Error`.

**Recommendation:** Rename `tools.ts:ValidationError` to `SchemaValidationError` (or `ZodValidationError`). Make it extend `BaseError`. All four classes coexist intentionally (component-scoped hierarchies are fine) — only the `tools.ts` outlier needs fixing.

### 2. Three different env-parsing patterns

**Files:**
- `Shared/Utils/config.ts` — provides `getEnvString()`, `getEnvNumber()`, `getEnvBoolean()`, `getEnvFloat()`
- `Thinker/src/config.ts:147-168` — re-implements `parseBoolean()`, `parseInteger()`, `parseNumber()` locally
- `Filer-MCP/src/utils/config.ts:57` — raw `parseInt()` calls, no Zod validation

The Shared utilities exist but Thinker and Filer don't use them. The Thinker's local helpers are functionally identical to Shared's.

**Recommendation:** Replace Thinker's `parseBoolean/parseInteger/parseNumber` with imports from `@mcp/shared/Utils/config.js`. Add Zod config validation to Filer-MCP (it's the only package without it).

### 3. Filer-MCP hand-rolled YAML parsing

**File:** `Filer-MCP/src/utils/config.ts:82-98`

Instead of using a proper YAML library, the code parses `fileops-mcp.yaml` using regex pattern matching (`content.match(/grants:\s*\n((?:\s+-[^\n]+\n?)+)/)`). It reads the raw file as a string and uses regex to extract `path:` and `permission:` values. This will break on valid YAML features like comments on value lines, quoted strings, multi-line values, or non-standard whitespace.

**Recommendation:** Either use the `yaml` package (already a dependency in Thinker) or migrate grant config to env vars / JSON.

---

## High-Priority Findings

### 4. Hardcoded tool names create hidden coupling

**Files:**
- `Thinker/src/orchestrator/client.ts` — hardcodes `telegram_send_message`, `memory_store_fact`, `memory_retrieve_memories`, `memory_get_profile`, `memory_store_conversation`, etc.
- `Orchestrator/src/core/orchestrator.ts` — calls `toolRouter.routeToolCall('memory_store_conversation', ...)` directly

If the Orchestrator's namespace prefix or separator changes, all these break silently. No type safety across the MCP boundary.

**Recommendation:** Create a `ToolNames` constants object in Shared (or at least in each consumer) that centralizes canonical tool names. This makes renames a single-point change.

### 5. No retry for critical `memory_store_conversation` call

**File:** `Orchestrator/src/core/orchestrator.ts` (~line 521)

When the Orchestrator dispatches a message to Thinker and gets a response, it stores the conversation via a single `toolRouter.routeToolCall('memory_store_conversation', ...)`. If Memorizer-MCP is temporarily down, the conversation data is **permanently lost** with no retry.

**Recommendation:** Add retry-with-backoff for this specific side-effect call, or queue it for later if Memorizer is unavailable.

### 6. `MCPMetadata` defined/diverged in multiple places

The type exists in:
- `Shared/Discovery/types.ts`
- `Orchestrator/src/config/schema.ts` (Zod schema, adds `projectDiscovery.listToolArgs`)
- `Thinker/src/orchestrator/types.ts`

**Recommendation:** Single source of truth in Shared. Orchestrator extends it if needed.

### 7. Filer-MCP has no typed error hierarchy

Filer-MCP throws plain `Error` objects (`throw new Error("Path traversal (..) not allowed")`). All errors become `INTERNAL_ERROR` when caught by `createErrorFromException`. Memorizer-MCP and Orchestrator both have proper typed hierarchies extending `BaseError`.

**Recommendation:** Create `FilerError extends BaseError` with subtypes: `PathSecurityError`, `GrantError`, `WorkspaceError`. Follow the Memorizer-MCP pattern.

### 8. Duplicate `expandHome` / `expandPath`

- `Filer-MCP/src/utils/config.ts:37-42` — `expandHome()`
- `Shared/Utils/config.ts:11-16` — `expandPath()`
- Thinker does inline `replace(/^~/, homedir())` in loop.ts

All three are functionally identical.

**Recommendation:** Delete Filer-MCP's `expandHome`, import `expandPath` from `@mcp/shared`.

---

## Medium-Priority Findings

### 9. Orchestrator's `orchestrator.ts` is a God Object (~1163 lines, 30+ methods)

Handles: MCP init, Guardian wrapping, health monitoring, agent management, channel polling, message dispatch, slash commands, startup diff, notifications, hot-reload, project recognition, external MCP watcher.

**Recommendation:** Extract `NotificationService`, `HotReloadManager`, `ProjectRecognitionService` as the existing `AgentManager`, `HaltManager`, and `ChannelPoller` patterns already demonstrate good decomposition.

### 10. Thinker's `loop.ts` is similarly oversized (~1641 lines)

The recent extraction of `ToolSelector`, `ResponseGenerator`, `ToolRecovery` into components is the right direction but only partially done.

**Recommendation:** Continue extracting: `HallucinationGuard`, `FactExtractionTimer`, `ContextBuilder` are coherent units.

### 11. No contract tests between Orchestrator and Thinker

The HTTP interface (`/process-message`, `/tools/call`) is tested in isolation on each side but never as a pair. A schema mismatch between `ProcessingResponse` (Orchestrator expects) and `ProcessingResult` (Thinker returns) would not be caught.

**Recommendation:** Add a shared Zod schema for the Orchestrator-Thinker HTTP contract. Both sides import it. Alternatively, add one integration test that validates a full round-trip.

### 12. Singleton pattern overuse

- `getOrchestrator()` — async singleton with hidden init ordering
- `getConfig()` in Filer-MCP — mutable module-level
- `getEmbeddingProvider()` in Memorizer-MCP

Makes unit testing harder (must reset state between tests).

**Recommendation:** Prefer explicit dependency injection. Pass config/db/clients as constructor arguments.

### 13. Circuit breaker in Thinker never auto-resets

Five consecutive errors trip it permanently. Recovery requires process restart (Orchestrator will restart it, so this works in practice).

**Recommendation:** Add a half-open state with configurable cooldown (try one request after 60s of being tripped).

### 14. Inconsistent handler return conventions

- **Memorizer-MCP:** handlers return `StandardResponse` directly (can return errors without throwing)
- **Filer-MCP:** handlers return raw data, server wraps with `createSuccess()` (must throw to signal errors)

**Recommendation:** Standardize on the Memorizer pattern (handlers return `StandardResponse`). More flexible, more explicit.

### 15. Tool group definitions hardcoded in two places

- `Orchestrator/src/routing/tool-router.ts` (~lines 54-139): `DEFAULT_TOOL_GROUPS` for description tagging
- `Thinker/src/agent/tool-selector.ts` (~lines 11-40): `TOOL_GROUPS` for message-based selection

Different purposes but overlapping tool name lists. Adding a new tool requires updating both.

**Recommendation:** Accept as intentional (different concerns) but add cross-reference comments and consider a shared tool name registry.

---

## Low-Priority / Acknowledged

### 16. ToolRouter contains business logic (skill normalization, cron validation)

The routing layer should be a pure routing table. Skill normalization belongs in a middleware/interceptor.

### 17. Leaked tool call recovery is an LLM workaround

The `tool-recovery.ts` module exists because Groq/Llama sometimes emit tool calls as text. Well-implemented but should be tracked for removal as providers improve.

### 18. `any` type usage in Thinker's loop.ts

`(step: any)` casts and `toolChoice` casting bypass type safety. The Vercel AI SDK types don't align perfectly with usage.

### 19. Filer-MCP grant storage race condition (JSON file)

Multiple concurrent tool calls could read stale grant data. Acceptable for single-user system, but SQLite would be more robust.

### 20. Orchestrator HTTP API has weak authentication

`X-Agent-Id` and optional `X-Hexa-Puffs-Token` headers. Any local process can impersonate any agent. Acceptable for single-machine deployment.

---

## What's Done Well

- **MCP protocol as process boundary** — genuine decoupling, MCPs are independently deployable
- **Auto-discovery** — drop a new MCP folder, add `hexa-puffs` to package.json, restart
- **Cost controls** — sophisticated sliding-window anomaly detection with tunable thresholds
- **Guardian security** — defense in depth with per-MCP and per-agent scan overrides
- **Filer path security** — traversal detection, forbidden paths, symlink resolution, extension restrictions
- **Health monitoring** — 60s checks, auto-restart with backoff, tool rediscovery on recovery
- **Error hierarchy pattern** — `BaseError > ComponentError > SpecificError` is clean and consistent (except the `tools.ts` outlier)
- **Testing volume** — 90+ test files across the monorepo with unit + integration coverage
- **StandardResponse pattern** — consistent API contracts across all MCPs
- **No over-engineering** — the complexity matches actual operational needs

---

## Recommended Priority Order

If addressing these findings, tackle in this order:

1. **Fix `ValidationError` conflict in `Shared/Types/tools.ts`** (5 min, high impact)
2. **Add Zod config validation to Filer-MCP** (30 min, eliminates a class of bugs)
3. **Replace Filer YAML regex with proper parser or JSON** (15 min)
4. **Delete duplicate `expandHome`, use Shared's `expandPath`** (5 min)
5. **Replace Thinker's local env parsers with Shared imports** (10 min)
6. **Add typed error hierarchy to Filer-MCP** (20 min)
7. **Create shared tool name constants** (30 min, reduces coupling risk)
8. **Add retry for `memory_store_conversation`** (20 min)
9. **Consolidate `MCPMetadata` to single source in Shared** (30 min)
10. **Standardize handler return convention** (1 hr, touches all Filer handlers)
