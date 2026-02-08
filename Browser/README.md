# Browser MCP

Headless Chromium browser automation for Annabelle agents via `@playwright/mcp`.

## Phase 1 (Current)

Single shared browser instance. One Orchestrator-managed stdio MCP process wrapping `@playwright/mcp`. All agents share the same Chromium instance and browser state (cookies, tabs, localStorage).

**Limitation:** Only one agent should use browser tools at a time. Concurrent browsing from multiple agents will cause session conflicts. Restrict access via `allowedTools` in `agents.json`.

### Tools Provided

All tools are registered automatically by `@playwright/mcp` (~20 tools):

| Tool | Description |
| --- | --- |
| `browser_navigate` | Go to a URL |
| `browser_snapshot` | Get accessibility tree snapshot (structured text with element refs) |
| `browser_click` | Click an element by ref number |
| `browser_type` | Type text into an input by ref number |
| `browser_screenshot` | Capture viewport or full-page screenshot |
| `browser_go_back` / `browser_go_forward` | Navigate history |
| `browser_hover` | Hover over an element |
| `browser_select_option` | Select dropdown option |
| `browser_press_key` | Press keyboard key |
| `browser_tab_new` / `browser_tab_close` / `browser_tab_list` | Tab management |
| `browser_wait` | Wait for condition |
| `browser_pdf_save` | Export page as PDF |

### Proxy Configuration

Proxy is **off by default**. To enable:

```bash
BROWSER_PROXY_ENABLED=true
BROWSER_PROXY_SERVER=http://p.webshare.io:80
BROWSER_PROXY_USERNAME=your-username
BROWSER_PROXY_PASSWORD=your-password
BROWSER_PROXY_BYPASS=localhost,127.0.0.1   # optional, this is the default
```

Both `BROWSER_PROXY_ENABLED=true` and `BROWSER_PROXY_SERVER` must be set for proxy to activate.

### Build

```bash
cd Browser
npm install
npx playwright install chromium
npm run build
```

## Phase 2 (Future)

Per-agent browser instances via an Orchestrator `perAgent` flag. Each agent that has `browser_*` in its `allowedTools` gets its own dedicated Browser MCP process with its own Chromium instance and proxy configuration.

**The Browser MCP code does not change.** Only the Orchestrator learns to spawn multiple instances (~60-80 lines across 4 Orchestrator files). See `browser-mcp-plan.md` and `browserplan.md` for the full architecture analysis.

### What Changes in Phase 2

- `Orchestrator/src/config/scanner.ts` -- new `perAgent` manifest field
- `Orchestrator/src/core/http-handlers.ts` -- extract `X-Agent-Id` header (already sent by Thinker, currently ignored)
- `Orchestrator/src/core/tool-router.ts` -- agent-aware routing for perAgent MCPs
- `Orchestrator/src/core/orchestrator.ts` -- spawn N browser instances for N agents

## Why No Shared Components

Unlike every other MCP in the Annabelle ecosystem, the Browser MCP does **not** use:

- `@mcp/shared` (StandardResponse, registerTool)
- Custom tool definitions
- The shared `registerTool()` wrapper

**This is intentional.** `@playwright/mcp` is a battle-tested Microsoft package that provides ~20 browser tools with complex internals:

- Accessibility tree parsing with element ref tracking
- Dialog interception and handling
- File upload choreography
- Network request capture
- Console message buffering
- Tab lifecycle management
- Screenshot encoding and viewport management

Reimplementing these as custom tools using `registerTool()` would be 800-1500 lines of code with ongoing maintenance burden. Instead, we wrap the library in a thin entry point (~30 lines) and let it handle all MCP protocol, tool registration, and browser automation.

The tradeoff: we lose `StandardResponse` consistency but gain a maintained, production-quality browser automation layer that receives upstream bug fixes and new features automatically.
