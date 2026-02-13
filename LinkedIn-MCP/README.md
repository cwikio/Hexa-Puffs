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

## Configuration

Environment variables (`.env`):

```bash
LINKEDIN_USERNAME=your_email@example.com
LINKEDIN_PASSWORD=your_password
```

Authentication uses the `linkedin-api` library which logs in via username/password and maintains a session cookie.

## Dependencies

- **[FastMCP](https://github.com/jlowin/fastmcp)** >= 2.0.0 — Python MCP framework (stdio transport)
- **[linkedin-api](https://github.com/tomquirk/linkedin-api)** >= 2.2.0 — Unofficial LinkedIn API client
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

- **`LINKEDIN_API_RESTRICTED`** — LinkedIn session expired or account restricted. Re-authenticate by clearing cookies and restarting.
- **Search returns empty** — LinkedIn aggressively rate-limits search. The messaging module has a `_resolve_via_conversations()` fallback that looks up participants from recent conversations.
- **`status: 429`** — Rate limited. Wait and retry. Avoid rapid successive searches.
