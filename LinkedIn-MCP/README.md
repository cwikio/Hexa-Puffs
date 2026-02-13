# LinkedIn MCP Server

LinkedIn integration for the Annabelle AI Assistant. Provides profile viewing, messaging, post creation, search, and connection management via the unofficial LinkedIn API.

**Transport:** Stdio (spawned by Orchestrator)
**Language:** Python 3.11+ (FastMCP)

## Quick Start

```bash
# 1. Create and activate virtual environment
uv sync --extra dev

# 2. Configure credentials
cp .env.example .env
# Edit .env with your LinkedIn credentials

# 3. Run
.venv/bin/python src/main.py
```

The Orchestrator auto-discovers this MCP via the `"annabelle"` field in `package.json` and spawns it as `.venv/bin/python src/main.py`.

## Tools

### Profile

| Tool | Description |
|------|-------------|
| `get_profile` | View a LinkedIn user's profile by public ID |
| `get_own_profile` | View the authenticated user's own profile |

### Messaging

| Tool | Description |
|------|-------------|
| `get_conversations` | List recent inbox conversations |
| `get_conversation` | Get messages from a specific conversation |
| `send_message` | Send a message to a LinkedIn user |

### Posts

| Tool | Description |
|------|-------------|
| `get_feed` | Get recent posts from the LinkedIn feed |
| `create_post` | Create a new LinkedIn post |

### Search

| Tool | Description |
|------|-------------|
| `search_people` | Search for LinkedIn users by keywords |
| `search_companies` | Search for companies |

### Network

| Tool | Description |
|------|-------------|
| `get_connections` | List your connections |
| `send_connection_request` | Send a connection request to a user |

## Authentication

The MCP supports two auth modes, tried in order:

### Option 1: Browser cookies (preferred)

Extract `li_at` and `JSESSIONID` from your browser (DevTools → Application → Cookies → linkedin.com) and set them in `.env`:

```bash
LINKEDIN_COOKIES_LI_AT=<li_at value>
LINKEDIN_COOKIES_JSESSIONID=<JSESSIONID value, without surrounding quotes>
```

**Important:** Browser cookies expire. When they do, all API calls fail with redirect loops. Re-extract from your browser and restart.

### Option 2: Email/password

```bash
LINKEDIN_EMAIL=your_email@example.com
LINKEDIN_PASSWORD=your_password
```

Uses the `linkedin-api` library's Android-based login flow. LinkedIn actively detects this (Android auth headers vs Chrome API headers mismatch) and may restrict endpoints — messaging, feed, and profile views often return 401/403/999.

### Session validation

On first use, the client calls `/me` to verify the session is valid. If email/password auth loads stale cached cookies (from `~/.linkedin_api/cookies/`), they're auto-deleted and a fresh login is attempted.

### Known limitations

- **TLS fingerprinting:** LinkedIn uses Cloudflare bot management. Python `requests` has a distinctive TLS fingerprint (JA3/JA4) that doesn't match a real browser. This causes endpoint-specific failures even with valid cookies.
- **Endpoint-specific detection:** `/me` may work while search, messaging, feed, and profile endpoints are blocked. Different endpoints fail in different ways (empty body, redirect loops, 999 bot detection).
- **Cookie expiry:** Browser cookies are invalidated by LinkedIn after automated usage is detected. The `Set-Cookie: li_at=delete me` response confirms active revocation.
- **Next step:** Migrate to Playwright-based browser automation (`@playwright/mcp` or similar) to get a real browser TLS fingerprint and automatic cookie management.

## Dependencies

- **[FastMCP](https://github.com/jlowin/fastmcp)** >= 2.0.0 — Python MCP framework (stdio transport)
- **[linkedin-api](https://github.com/tomquirk/linkedin-api)** >= 2.2.0 — Unofficial LinkedIn API client (Voyager API wrapper)
- **pydantic** >= 2.0.0 — Data validation
- **python-dotenv** >= 1.0.0 — Environment loading

## Testing

```bash
# Unit tests (no LinkedIn credentials needed)
.venv/bin/pytest tests/ -v --ignore=tests/e2e

# End-to-end tests (requires real LinkedIn credentials)
.venv/bin/pytest tests/e2e/ -v -m e2e
```

## Architecture

```
LinkedIn-MCP/
├── src/
│   ├── main.py              # Entry point — FastMCP server, tool registration
│   ├── linkedin_client.py   # Client singleton, session management
│   ├── response.py          # success_response() / error_response() helpers
│   └── tools/
│       ├── messaging.py     # Conversations, send/receive messages
│       ├── profile.py       # Profile viewing
│       ├── posts.py         # Feed and post creation
│       ├── search.py        # People and company search
│       └── network.py       # Connections, connection requests
├── tests/
│   ├── unit/                # Mocked unit tests
│   ├── integration/         # MCP stdio transport tests
│   └── e2e/                 # Live API tests (requires credentials)
├── package.json             # Annabelle manifest (mcpName: "linkedin")
└── pyproject.toml           # Python project config (uv/hatch)
```

## Common Failures

- **Redirect loops / `TooManyRedirects`** — Browser cookies expired or revoked. LinkedIn responds with `Set-Cookie: li_at=delete me`. Re-extract cookies from browser.
- **`LINKEDIN_API_RESTRICTED`** — Session expired or account restricted. Re-authenticate by clearing cookies and restarting.
- **`status: 999`** — LinkedIn bot detection. Happens on `get_profile`. The `requests` library's TLS fingerprint doesn't match a real browser.
- **`status: 401`** — Stale cached cookies. The client auto-deletes `~/.linkedin_api/cookies/*.jr` and retries.
- **Search returns empty** — LinkedIn rate-limits search aggressively. The `send_message` tool has a 4-strategy resolution: keyword search → first/last name search → broad search → conversation participant scan.
- **`LINKEDIN_SEND_FAILED`** — `send_message` returned non-201 status. Account may be restricted. Note: the library returns `True` for error, `False` for success (inverted convention).
- **`status: 429`** — Rate limited. Wait and retry. The library adds a 2–5s random delay per request (`default_evade`).
