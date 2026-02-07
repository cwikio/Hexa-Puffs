# Browser MCP — Implementation Plan

## Overview

A Browser MCP that gives Annabelle agents the ability to navigate websites, interact with page elements, fill forms, take screenshots, and extract data — all through a headless Chromium instance routed through a proxy (Webshare) for IP privacy.

## Why

Current agents can only interact with the world through MCP tools (Telegram, Gmail, files, search, memory). Many real tasks require a browser:

- **Web interactions with no API** — booking restaurants, filling government forms, submitting support tickets
- **Authenticated web sessions** — dashboards, internal tools, SaaS apps behind login walls
- **JavaScript-rendered pages** — SPAs that return empty HTML to a simple HTTP fetch
- **Form filling** — job applications, expense reports, event registrations
- **Visual verification** — "what does our landing page look like?", screenshot capture
- **Price monitoring / competitor research** — structured scraping beyond Brave Search

## Architecture

```
Browser/                          ← New sibling directory (like Telegram/, Guardian/, etc.)
├── package.json                  ← annabelle manifest for auto-discovery
├── tsconfig.json
├── src/
│   └── index.ts                  ← ~30 lines: configures Playwright MCP with proxy
├── dist/
│   └── index.js                  ← compiled entry point
```

### How It Fits

```
Orchestrator auto-discovers Browser/ (annabelle.mcpName = "browser")
       ↓
Spawns: node Browser/dist/index.js (stdio)
       ↓
Browser MCP starts, reads proxy config from env vars
       ↓
Launches headless Chromium through Webshare proxy
       ↓
Registers tools: browser_navigate, browser_click, browser_type, browser_snapshot, etc.
       ↓
Orchestrator discovers tools via ToolRouter
       ↓
Guardian wraps the MCP (sensitive: true → input + output scanning)
       ↓
Agents with browser_* in allowedTools can now browse the web
```

### No Orchestrator Changes Needed

The Orchestrator's auto-discovery, Guardian wrapping, tool policy enforcement, and per-agent filtering all work automatically. The Browser MCP is just another stdio MCP — same pattern as Filer, Memory, or Telegram.

## Implementation

### Technology Choice: Playwright via `@playwright/mcp`

Microsoft's official `@playwright/mcp` npm package provides:

- Full MCP protocol support (stdio transport)
- All browser tools pre-implemented (navigate, click, type, snapshot, screenshot, etc.)
- Accessibility tree snapshots (structured text, not vision-based — faster, cheaper, more reliable)
- Headless and headed modes
- Multi-browser support (Chromium, Firefox, WebKit)

We wrap it in a thin `Browser/` directory for auto-discovery and proxy configuration.

### `package.json`

```json
{
  "name": "browser-mcp",
  "version": "1.0.0",
  "main": "dist/index.js",
  "type": "module",
  "annabelle": {
    "mcpName": "browser",
    "sensitive": true,
    "timeout": 60000
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts"
  },
  "dependencies": {
    "@playwright/mcp": "^0.1.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "tsx": "^4.0.0"
  }
}
```

Key manifest fields:

- `sensitive: true` — Guardian scans both inputs (URLs the agent navigates to) and outputs (page content returned)
- `timeout: 60000` — browser operations can be slow (page loads, JS rendering), 60s timeout instead of default 30s

### `src/index.ts`

```typescript
import { createServer } from '@playwright/mcp';

const proxyServer = process.env.BROWSER_PROXY_SERVER;

const server = createServer({
  launchOptions: {
    headless: true,
    proxy: proxyServer
      ? {
          server: proxyServer,
          username: process.env.BROWSER_PROXY_USERNAME,
          password: process.env.BROWSER_PROXY_PASSWORD,
          bypass: process.env.BROWSER_PROXY_BYPASS,
        }
      : undefined,
  },
});

server.listen({ transport: 'stdio' });
```

That's the entire custom code. `@playwright/mcp` handles all tool definitions, browser lifecycle, and MCP protocol.

### After `npm install`

Run `npx playwright install chromium` to download the headless Chromium binary (~200MB). This is a one-time step.

## Proxy Configuration (Webshare)

### Environment Variables

```bash
BROWSER_PROXY_SERVER=http://p.webshare.io:80
BROWSER_PROXY_USERNAME=your-webshare-username
BROWSER_PROXY_PASSWORD=your-webshare-password
BROWSER_PROXY_BYPASS=localhost,127.0.0.1
```

### How Webshare Works

- **Rotating endpoint**: `p.webshare.io:80` assigns a different residential IP per request
- **Sticky sessions**: Use `username-session-abc123` format to keep the same IP for the duration of a browsing session (important for multi-page flows)
- **Country targeting**: Configured via Webshare dashboard or API
- **Protocols**: HTTP (port 80) or SOCKS5 (different port) — HTTP is sufficient for browser traffic

### Credential Security (Future Enhancement)

Instead of env vars, fetch Webshare credentials from 1Password at startup:

```typescript
// Browser MCP calls 1Password via Orchestrator's tool API
const creds = await orchestratorClient.callTool('onepassword_get', {
  item: 'Webshare Proxy',
  fields: ['username', 'password', 'server'],
});
```

This keeps credentials out of config files, env vars, and process listings. Deferred to v2 — env vars work fine for v1.

## Tools Provided by `@playwright/mcp`

The following tools are registered automatically:

| Tool | Description |
| --- | --- |
| `browser_navigate` | Go to a URL |
| `browser_go_back` | Navigate back |
| `browser_go_forward` | Navigate forward |
| `browser_snapshot` | Get accessibility tree snapshot (structured text with element refs) |
| `browser_screenshot` | Capture viewport or full-page screenshot |
| `browser_click` | Click an element by ref number |
| `browser_type` | Type text into an input by ref number |
| `browser_hover` | Hover over an element |
| `browser_select_option` | Select dropdown option |
| `browser_drag` | Drag element to target |
| `browser_press_key` | Press keyboard key |
| `browser_upload_file` | Upload file to input |
| `browser_handle_dialog` | Accept/dismiss dialogs |
| `browser_tab_new` | Open new tab |
| `browser_tab_close` | Close current tab |
| `browser_tab_list` | List all tabs |
| `browser_console` | Get console messages |
| `browser_pdf_save` | Export page as PDF |
| `browser_wait` | Wait for condition |
| `browser_resize` | Change viewport size |
| `browser_network` | Get network requests |
| `browser_storage` | Manage cookies/localStorage |

### How Agents Use These Tools

The agent workflow is snapshot-based, not vision-based:

1. Agent calls `browser_navigate({ url: "https://example.com/login" })`
2. Agent calls `browser_snapshot()` — gets structured text:
   ```
   [1] heading "Log In"
   [2] textbox "Email" [focused]
   [3] textbox "Password"
   [4] button "Sign In"
   [5] link "Forgot password?"
   ```
3. Agent calls `browser_type({ ref: 2, text: "user@example.com" })`
4. Agent calls `browser_type({ ref: 3, text: "password123" })`
5. Agent calls `browser_click({ ref: 4 })`
6. Agent calls `browser_snapshot()` — sees the dashboard after login

No vision model, no screenshots for navigation. Fast, cheap, deterministic.

## Security

### Guardian Scanning

With `sensitive: true` in the manifest:

- **Input scanning**: Guardian scans URLs and form data before the browser navigates (catches prompt injection in URLs, blocks malicious domains)
- **Output scanning**: Guardian scans page content returned to the agent (catches data exfiltration attempts)

### Tool Policy

Agents must have `browser_*` in their `allowedTools` to use browser tools:

```json
{
  "agentId": "research-assistant",
  "allowedTools": ["browser_*", "memory_*", "filer_*"],
  "deniedTools": ["browser_upload_file"]
}
```

An agent without `browser_*` in its allowed tools cannot see or call any browser tools — enforced at the Orchestrator level.

### Headless Only in Production

Headless mode means no visible browser window — no risk of the agent's browsing being observed on screen, and no display server required.

### No JS Eval by Default

The `@playwright/mcp` server can be configured to disable `browser.evaluate()` (arbitrary JavaScript execution in the page). Recommended for v1 — an agent executing arbitrary JS in a browser is a significant security surface.

## Resource Footprint

| Resource | Cost |
| --- | --- |
| Chromium binary | ~200MB disk (one-time install) |
| Running browser instance | ~100-300MB RAM |
| Headless vs headed | Headless saves ~30% RAM |
| Webshare proxy | From $2.99/mo (datacenter) or $3.50/mo (residential) |

The browser instance is shared across tool calls (Playwright manages a browser pool). It's not one browser per navigation — the same instance handles all requests until the MCP process restarts.

## Future Enhancements

### v2: 1Password Credential Fetch

Fetch Webshare proxy credentials from 1Password at startup instead of env vars.

### v2: URL Allowlisting

Restrict which domains the browser can navigate to:

```typescript
const ALLOWED_DOMAINS = ['example.com', 'github.com', '*.google.com'];
// Reject navigation to domains not on the list
```

Prevents a runaway agent from browsing arbitrary sites (which could contain prompt injection payloads in page content).

### v2: Session Persistence

Save/restore browser cookies between restarts. Useful for maintaining login sessions across MCP process restarts.

### v2: Screenshot Storage

Save screenshots to Filer MCP instead of returning them inline (which consumes agent context window). Return a file path instead.

### v3: Per-Agent Browser Profiles

Different agents get different browser profiles (separate cookies, localStorage, sessions). Prevents cross-agent session leakage.

### v3: Sticky Session Management

Auto-generate Webshare session IDs per browsing session to maintain the same proxy IP throughout a multi-page flow.

## Verification

1. Create `Browser/` directory with `package.json` and `src/index.ts`
2. `cd Browser && npm install && npx playwright install chromium && npm run build`
3. Restart Orchestrator — verify "browser" appears in MCP discovery logs
4. Verify tools appear in `GET /tools/list` (should see `browser_navigate`, `browser_snapshot`, etc.)
5. Test: call `browser_navigate` with a public URL, then `browser_snapshot` — verify structured output
6. Test with proxy: set `BROWSER_PROXY_SERVER` env var, navigate to `https://httpbin.org/ip` — verify returned IP is not your home IP
7. Test tool policy: verify an agent without `browser_*` in `allowedTools` cannot call browser tools
8. Test Guardian: verify input/output scanning works on browser tool calls
