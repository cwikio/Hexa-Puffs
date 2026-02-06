# MCP Monorepo Refactoring: `registerTool()` + Annotations

## Goal
Migrate all MCPs from deprecated `server.tool()` / `server.setRequestHandler()` to `McpServer.registerTool()` (SDK 1.25.3), add tool annotations, enhance descriptions, and update tests.

## Key Design Decisions

1. **No service-prefixed tool names** — Orchestrator's ToolRouter already handles namespacing; prefixing would cause double-namespacing and break existing references
2. **Shared `registerTool` helper** — thin wrapper standardizing StandardResponse wrapping + error handling
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

## Phase 3: Gmail (27 tools) + Telegram (~16 tools) + Memorizer (17 tools)
**DEFERRED** — These use low-level `Server` + `setRequestHandler()`. Migration to `McpServer` is higher risk.

### Gmail (`Gmail-MCP/src/server.ts`)
- [ ] Change `Server` → `McpServer`
- [ ] Remove `setRequestHandler()` handlers
- [ ] Loop through `allTools`, call `server.registerTool()` for each
- [ ] Add `annotations` field to each tool entry in `Gmail-MCP/src/tools/index.ts`
- [ ] Update Gmail unit test mocks for `McpServer`
- [ ] Verify: `cd Gmail-MCP && npx tsc --noEmit && npx vitest run`

### Telegram (`Telegram-MCP/src/server.ts`)
- [ ] Same pattern as Gmail — `Server` → `McpServer`, loop allTools, add annotations
- [ ] Verify: `cd Telegram-MCP && npx tsc --noEmit && npx vitest run`

### Memorizer (`Memorizer-MCP/src/server.ts`)
- [ ] Change `Server` → `McpServer`
- [ ] Remove `setRequestHandler()` + switch/case dispatcher
- [ ] Create `allTools` array, register each via `server.registerTool()`
- [ ] All tools: `openWorldHint: false` (local SQLite)
- [ ] Update `startTransport()` call in index.ts
- [ ] Verify: `cd Memorizer-MCP && npx tsc --noEmit && npx vitest run`

---

## Phase 4: Orchestrator Passthrough Verification
**DEFERRED** — Run after Phase 3.

- [ ] `Orchestrator/src/tools/status.ts` — add annotations to `get_status`
- [ ] Verify `listTools` includes annotations for proxied tools
- [ ] `cd Orchestrator && npx vitest run`
- [ ] `./test-all.sh` — full stack regression

---

## Phase 5: Description Enhancement Pass
**DEFERRED** — Documentation pass, no structural changes.

- [ ] Enhance all 80+ tool descriptions with Args/Returns/Examples/Errors format

---

## Execution Order

```
Phase 0 (Shared)                                    ✅ DONE
  └→ Phase 1 (Guardian + 1Password)                 ✅ DONE
      └→ Phase 2 (Searcher + Filer)                 ✅ DONE
          └→ Phase 3 (Gmail + Telegram + Memorizer)  ← LATER
              └→ Phase 4 (Orchestrator verification)  ← LATER
                  └→ Phase 5 (Description pass)       ← LATER
```

## Verification
After all phases:
1. `npx tsc --noEmit` in every package ✅ (Shared, Guardian, 1Password, Searcher, Filer, Orchestrator all pass)
2. `npx vitest run` in every package (requires running servers — manual step)
3. `./test-all.sh` full stack (requires running servers — manual step)
4. Manual: connect via Claude Code, verify `listTools` shows annotations
5. Manual: call a read-only tool and a destructive tool, confirm annotation behavior
