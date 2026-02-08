# Browser MCP — Option A Execution Plan

## Context

Add a Browser MCP to the Annabelle ecosystem. Wraps Microsoft's `@playwright/mcp` in a thin entry point with proxy support. Auto-discovered by Orchestrator as a stdio MCP like Filer, Memorizer, etc.

**Architecture decision:** Option A (single shared browser) for now. Option B (per-agent browser instances via Orchestrator `perAgent` flag) is the upgrade path — documented in `browser-mcp-plan.md` for when multi-agent browsing is needed. The Browser MCP code is identical for both — only the Orchestrator changes in Option B.

**What's different from other MCPs:** The Browser MCP does NOT use `@mcp/shared`, `registerTool()`, or `StandardResponse`. The `@playwright/mcp` package creates its own MCP server with ~20 pre-registered tools. Our wrapper just configures proxy and launches it. This is intentional — we use the battle-tested library rather than reimplementing browser automation.

---

## What Was Implemented

### Files Created

```
Browser/
├── package.json              ← annabelle manifest (mcpName: "browser", sensitive: true, timeout: 60000)
├── tsconfig.json             ← extends ../tsconfig.base.json
├── README.md                 ← architecture decisions, phase plan, why no shared components
├── browserplan.md            ← this file
├── src/
│   └── index.ts              ← ~30 lines: createConnection + StdioServerTransport + proxy config
├── dist/
│   └── index.js              ← compiled entry point
```

### API Discovery

The `@playwright/mcp` package (v0.0.64) exports `createConnection()`, not `createServer()`:

```typescript
createConnection(config?: Config): Promise<Server>
```

- Returns an MCP SDK `Server` instance
- Config uses `browser.launchOptions` (not top-level `launchOptions`)
- We connect it to `StdioServerTransport` from `@modelcontextprotocol/sdk`
- Required adding `@modelcontextprotocol/sdk` as an explicit dependency

### Thinker Integration

Added `browser` group to `Thinker/src/agent/tool-selector.ts`:
- `TOOL_GROUPS.browser = ['browser_*']`
- Keyword route: `/browse|website|navigate|webpage|screenshot|login.*site|fill.*form|open.*page|scrape|web.*page/i`

---

## Verification

### 1. Auto-discovery
Restart Orchestrator. Check logs for browser MCP discovery.

### 2. Tool listing
```bash
curl http://localhost:8010/tools/list | jq '.[] | select(.name | startswith("browser_"))'
```

### 3. Functional test
```bash
curl -X POST http://localhost:8010/tools/call \
  -H "Content-Type: application/json" \
  -d '{"name": "browser_navigate", "arguments": {"url": "https://example.com"}}'

curl -X POST http://localhost:8010/tools/call \
  -H "Content-Type: application/json" \
  -d '{"name": "browser_snapshot", "arguments": {}}'
```

### 4. Things to watch for

1. **Tool name prefixing** — Orchestrator prefixes with `{mcpName}_`. If `@playwright/mcp` already names tools `browser_navigate`, we may get `browser_browser_navigate`. Check ToolRouter behavior.
2. **Response format** — `@playwright/mcp` returns MCP content blocks (text/image), not StandardResponse JSON. Verify Thinker handles this.
3. **Chromium binary** — stored in `~/Library/Caches/ms-playwright/`, shared across all Playwright installations.

---

## Future: Option B Upgrade Path

When multi-agent browsing is needed, the Browser MCP code stays identical. Only the Orchestrator changes (~60-80 lines across 4 files):

1. `Orchestrator/src/config/scanner.ts` — add `perAgent?: boolean` to manifest schema
2. `Browser/package.json` — add `"perAgent": true` to annabelle field
3. `Orchestrator/src/core/http-handlers.ts` — extract `X-Agent-Id` header (already sent by Thinker, currently ignored)
4. `Orchestrator/src/core/tool-router.ts` — agent-aware routing for perAgent MCPs
5. `Orchestrator/src/core/orchestrator.ts` — spawn one Browser MCP instance per agent with `browser_*` in allowedTools

Full analysis in `browser-mcp-plan.md`.
