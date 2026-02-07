# MCP Monorepo Refactoring: `registerTool()` + Annotations

## Goal
Migrate all MCPs from deprecated `server.tool()` / `server.setRequestHandler()` to `McpServer.registerTool()` (SDK 1.25.3), add tool annotations, enhance descriptions, and update tests.

## Key Design Decisions

1. **No service-prefixed tool names** — Orchestrator's ToolRouter already handles namespacing; prefixing would cause double-namespacing and break existing references
2. **Shared `registerTool` helper** — thin wrapper standardizing StandardResponse wrapping + error handling; uses structural `McpServerLike` interface to avoid SDK version conflicts across packages
3. **Orchestrator stays on low-level `Server`** — it proxies tools, doesn't register them; only type updates needed
4. **Guardian response shape changes** — currently returns raw JSON, will switch to StandardResponse (tests must update)

---

## Phase 0: Shared Package Foundation ✅ DONE
- [x] `Shared/Types/tools.ts` — Add `annotations?: ToolAnnotations` to `ToolDefinition`
- [x] `Shared/Utils/register-tool.ts` (NEW) — Shared wrapper around `McpServer.registerTool()`
- [x] `Shared/package.json` — Add `zod` as peer dependency
- [x] `Orchestrator/src/mcp-clients/types.ts` — Add optional `annotations` to `MCPToolDefinition`
- [x] Verify: `cd Shared && npx tsc --noEmit && npm run build`

---

## Phase 1: Pilot — Guardian (2 tools) + 1Password (4 tools) ✅ DONE

### Guardian (`Guardian/src/server.ts`)
- [x] Replace 2 `server.tool()` calls with shared `registerTool()`
- [x] Add annotations: `readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false`
- [x] Remove manual `safeParse` (SDK does it)
- [x] Wrap in StandardResponse
- [x] Add `@mcp/shared` dependency to `package.json`
- [x] Update Guardian test helper to unwrap StandardResponse
- [ ] Add annotation verification test (deferred — requires running server)
- [x] Verify: `cd Guardian && npx tsc --noEmit`

### 1Password (`Onepassword-MCP/src/server.ts`)
- [x] Replace 4 `server.tool()` calls with shared `registerTool()`
- [x] All tools: `readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false`
- [x] Verify: `cd Onepassword-MCP && npx tsc --noEmit`

---

## Phase 2: Searcher (2 tools) + Filer (13 tools) ✅ DONE

### Searcher (`Searcher-MCP/src/server.ts`)
- [x] Remove inline `registerTool()` function
- [x] Import from `@mcp/shared/Utils/register-tool.js`
- [x] Both tools: `readOnlyHint: true, openWorldHint: true`
- [x] Add `@mcp/shared` dependency to `package.json`
- [ ] Add annotation verification test (deferred — requires running server)
- [x] Verify: `cd Searcher-MCP && npx tsc --noEmit`

### Filer (`Filer-MCP/src/server.ts`)
- [x] Remove inline `registerTool()` + debug logging
- [x] Import from `@mcp/shared/Utils/register-tool.js`
- [x] Add `@mcp/shared` dependency to `package.json`
- [x] Add annotations per tool:
  - read_file, list_files, search_files, check_grant, list_grants, get_workspace_info, get_audit_log: `readOnlyHint: true`
  - create_file, request_grant: `readOnlyHint: false, destructiveHint: false`
  - update_file, delete_file, move_file, copy_file: `readOnlyHint: false, destructiveHint: true`
- [ ] Add annotation verification test (deferred — requires running server)
- [x] Verify: `cd Filer-MCP && npx tsc --noEmit`

---

## Phase 3: Gmail (30 tools) + Telegram (16 tools) + Memorizer (17 tools) ✅ DONE

All three MCPs migrated from `Server` + `setRequestHandler()` to `McpServer` + shared `registerTool()`.

### Memorizer (`Memorizer-MCP/src/server.ts`)
- [x] Change `Server` → `McpServer`
- [x] Remove `setRequestHandler()` + switch/case dispatcher
- [x] Register 17 tools via shared `registerTool()` with annotations
- [x] All tools: `openWorldHint: false` (local SQLite)
- [x] Export Zod schemas from all tool files
- [x] Migrate `index.ts` to shared `startTransport()`
- [x] Add server unit test (InMemoryTransport, 8 tests)
- [x] Verify: `npx tsc --noEmit` ✅ `npx vitest run tests/unit/` ✅ (8/8)

### Telegram (`Telegram-MCP/src/server.ts`)
- [x] Change `Server` → `McpServer`
- [x] Remove `setRequestHandler()` + switch/case dispatcher
- [x] Register 16 tools via shared `registerTool()` with annotations
- [x] All tools: `openWorldHint: true` (external Telegram API)
- [x] Export Zod schemas from all tool files
- [x] Migrate `index.ts` to shared `startTransport()`
- [x] Add server unit test (InMemoryTransport, 8 tests)
- [x] Verify: `npx tsc --noEmit` ✅ `npx vitest run tests/unit/` ✅ (8/8)

### Gmail (`Gmail-MCP/src/server.ts`)
- [x] Change `Server` → `McpServer`
- [x] Remove `setRequestHandler()` handlers
- [x] Register 30 tools via shared `registerTool()` with annotations
- [x] All tools: `openWorldHint: true` (external Gmail/Calendar API)
- [x] Export/create 30 Zod schemas across 6 tool files
- [x] Rewrite `filters.ts` with proper Zod validation + safeParse + StandardResponse (previously had none)
- [x] Migrate `index.ts` to shared `startTransport()` (preserving polling lifecycle)
- [x] Update API test for new filter StandardResponse return type
- [x] Add server unit test (InMemoryTransport, 8 tests)
- [x] Verify: `npx tsc --noEmit` ✅ `npx vitest run tests/unit/` ✅ (8/8)

### Shared fix during Phase 3
- [x] `Shared/Utils/register-tool.ts` — Changed `McpServer` concrete type → `McpServerLike` structural interface to fix SDK version mismatch (Gmail had SDK 1.26.0 vs Shared's 1.25.3)

---

## Phase 4: Orchestrator Passthrough Verification
**TODO** — Run after Phase 3.

- [ ] `Orchestrator/src/tools/status.ts` — add annotations to `get_status`
- [ ] Verify `listTools` includes annotations for proxied tools
- [ ] `cd Orchestrator && npx vitest run`
- [ ] `./test-all.sh` — full stack regression

---

## Phase 5: Description Enhancement Pass
**DEFERRED** — Documentation pass, no structural changes.

- [ ] Enhance all 80+ tool descriptions with Args/Returns/Examples/Errors format

---

## Known Issue: Legacy Integration Tests

Filer, Memorizer, Guardian, and Gmail now run as **stdio processes** spawned by the Orchestrator — they no longer expose standalone HTTP ports. The following test suites still target dead ports and need migration:

| Test Suite | Dead Port | Fix |
|---|---|---|
| `Filer-MCP/tests/integration/` | 8004 | Route through Orchestrator (8010) or convert to InMemoryTransport unit tests |
| `Memorizer-MCP/tests/integration/` | 8005 | Same |
| `Gmail-MCP/src/test/api/` | 8008 | Same |
| `Orchestrator/tests/integration/filer.test.ts` | 8004 | Route through Orchestrator (8010) |
| `Orchestrator/tests/integration/memory.test.ts` | 8005 | Route through Orchestrator (8010) |
| `Orchestrator/tests/integration/orchestrator.test.ts` | 8002/8004/8005 | Route through Orchestrator (8010) |
| `Orchestrator/tests/integration/workflow-filer-memory.test.ts` | 8004/8005 | Route through Orchestrator (8010) |
| `Orchestrator/tests/integration/workflow-guardian-telegram.test.ts` | 8003 | Route through Orchestrator (8010) |
| `Orchestrator/tests/integration/workflow-jobs.test.ts` | — | `create_job` tool not registered in Orchestrator |

Tests that still work as-is: `stdio-mode.test.ts` (8010), `telegram.test.ts` (8002), `searcher.test.ts` (8007), `thinker.test.ts` (8006).

---

## Execution Order

```
Phase 0 (Shared)                                    ✅ DONE
  └→ Phase 1 (Guardian + 1Password)                 ✅ DONE
      └→ Phase 2 (Searcher + Filer)                 ✅ DONE
          └→ Phase 3 (Gmail + Telegram + Memorizer)  ✅ DONE
              └→ Phase 4 (Orchestrator verification)  ← NEXT
                  └→ Phase 5 (Description pass)       ← LATER
```

## Verification
After all phases:
1. `npx tsc --noEmit` in every package ✅ (all packages pass)
2. Unit tests via InMemoryTransport ✅ (Memorizer 8/8, Telegram 8/8, Gmail 8/8)
3. `npx vitest run` integration tests (requires running servers + legacy test migration)
4. `./test-all.sh` full stack (requires legacy test migration)
5. Manual: connect via Claude Code, verify `listTools` shows annotations
6. Manual: call a read-only tool and a destructive tool, confirm annotation behavior
