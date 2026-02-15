# MCP Reference

> What each MCP does, its tools, transport, configuration, dependencies, and common failure modes.

## Guardian

**Purpose:** Prompt injection scanning using IBM Granite Guardian.
**Transport:** Stdio | **Role:** `guardian` (always initialized first)

**Tools:**
- `scan_content` — Recursively scan strings/objects/arrays for prompt injection
- `get_scan_log` — Retrieve audit log of past scans

**Configuration:**
- Provider connection configured via Guardian config (host, port, API key)
- `failMode: 'open'` — allow through if Guardian errors; `'closed'` — block

**Dependencies:** External Granite Guardian API or compatible provider

**Common failures:**
- Provider unreachable → All downstream tool calls blocked (if failMode=closed) or unscanned (if open)
- False positives → Check `/security` for recent threat logs

---

## 1Password

**Purpose:** Read-only access to 1Password vaults and secrets.
**Transport:** Stdio | **Sensitive:** Yes

**Tools:**
- `list_vaults` — List accessible vaults
- `list_items` — List items in a vault (supports category filter)
- `get_item` — Full item details
- `read_secret` — Read secret value via `op://` URI

**Configuration:**
- Requires `op` CLI installed and authenticated
- `TRANSPORT` env: "stdio" (default) or "http"

**Dependencies:** 1Password CLI (`op` command)

**Common failures:**
- `op` CLI not authenticated → Health returns "degraded", all tools fail
- Fix: Run `eval $(op signin)` to re-authenticate

---

## Filer

**Purpose:** File operations with workspace isolation and permission grants.
**Transport:** Stdio | **Sensitive:** Yes

**Tools:**

*File operations:*
- `create_file`, `read_file`, `list_files`, `update_file`, `delete_file`, `move_file`, `copy_file`, `search_files`

*Grants:*
- `check_grant`, `request_grant`, `list_grants`

*Info:*
- `get_workspace_info`, `get_audit_log`

**Configuration:**
- `WORKSPACE_PATH` — Root workspace (default: `~/Downloads/AI-Workspace/`)
- `GRANTS_DB_PATH` — Grant storage (default: `~/.annabelle/data/grants.db`)
- `TEMP_CLEANUP_DAYS` — Auto-cleanup threshold (default: 7)

**Dependencies:** SQLite (grants DB), filesystem

**Security:**
- Relative paths resolve within workspace (always accessible)
- Absolute paths need grants (except forbidden paths)
- Forbidden: `~/.ssh/`, `~/.gnupg/`, `~/.aws/`, `~/.config/`, `/etc/`, `/var/`, `~/.annabelle/data/`
- System grants auto-created for `~/.annabelle/documentation/` and `~/.annabelle/logs/`

**Common failures:**
- "No access grant for path" → Path is outside workspace and not granted. Use `request_grant` or check `list_grants`.
- "Path traversal not allowed" → Input contains `..`
- "Access forbidden" → Path is in the forbidden list (cannot be granted)

---

## Memorizer

**Purpose:** Persistent memory — facts, conversations, profiles, skills, contacts, projects.
**Transport:** Stdio | **Sensitive:** No | **MCP Name:** `memory`

**Tools:**

*Facts:* `store_fact`, `list_facts`, `delete_fact`, `update_fact`
*Memory:* `retrieve_memories`, `get_memory_stats`
*Conversations:* `store_conversation`, `search_conversations`
*Profile:* `get_profile`, `update_profile`
*Skills:* `store_skill`, `list_skills`, `get_skill`, `update_skill`, `delete_skill`
*Contacts:* `create_contact`, `list_contacts`, `update_contact`
*Projects:* `create_project`, `list_projects`, `update_project`
*Timeline:* `query_timeline` — cross-source temporal queries across facts, conversations, profile changes, skills, contacts, and projects
*Maintenance:* `backfill_embeddings`, `export_memory`, `import_memory`

**Configuration:**
- `EMBEDDING_PROVIDER` — `ollama`, `lmstudio`, `groq`, or `none` (default: `none`)
- `OLLAMA_BASE_URL` — Ollama server (if provider is ollama)
- `LMSTUDIO_HOST` — LM Studio server (if provider is lmstudio)

**Dependencies:** SQLite (better-sqlite3), sqlite-vec extension, embedding provider (optional)

**Common failures:**
- Search returns no results → See `memory-system.md` for 3-tier search diagnostics
- Embedding provider unreachable → Falls back to FTS5 only (degraded but functional)
- `SQLITE_BUSY` → Usually transient; check for duplicate Memorizer processes

---

## Telegram

**Purpose:** Telegram messaging via MTProto protocol.
**Transport:** Stdio | **Sensitive:** Yes | **Role:** `channel`

**Tools:**

*Messages:* `send_message`, `get_messages`, `search_messages`, `delete_messages`, `mark_read`, `get_new_messages`, `subscribe_chat`
*Chats:* `list_chats`, `get_chat`, `create_group`
*Contacts:* `list_contacts`, `add_contact`, `search_users`
*Media:* `send_media`, `download_media`
*Info:* `get_me`

**Configuration:**
- `TELEGRAM_SESSION` — MTProto session string (required)
- `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` — App credentials from telegram.org

**Dependencies:** Telegram servers, `telegram` npm package (MTProto)

**Common failures:**
- Session expired → Need to re-authenticate and regenerate `TELEGRAM_SESSION`
- Connection timeout → Telegram servers may be temporarily unreachable
- "degraded" health → Client not yet connected (connects on first tool call)

---

## CodeExec

**Purpose:** Sandboxed code execution in Python, Node.js, and Bash.
**Transport:** Stdio | **Sensitive:** Yes

**Tools:**

*Execution:* `execute_code` (one-shot), `start_session`, `send_to_session`, `close_session`, `list_sessions`
*Packages:* `install_package`
*Scripts:* `save_script`, `get_script`, `list_scripts`, `search_scripts`, `run_script`, `save_and_run_script`, `delete_script`

**Configuration:**
- `SANDBOX_DIR` — Temp execution directory
- `LOG_DIR` — Execution logs
- `SCRIPTS_DIR` — Saved scripts library

**Dependencies:** Python, Node.js, Bash interpreters

**Security:** Environment variables are **stripped** before executing user code — no `GROQ_API_KEY`, `TELEGRAM_SESSION`, etc. leak to sandboxed code.

**Common failures:**
- Interpreter not found → Python/Node not on PATH
- Timeout → Long-running code killed after configured timeout
- Session cleanup → Sessions auto-close on Filer shutdown (SIGTERM/SIGINT)

---

## Searcher

**Purpose:** Web search, news search, image search, URL fetch.
**Transport:** Stdio | **Sensitive:** No

**Tools:**
- `web_search` — Web search via Brave Search API
- `news_search` — Recent news articles
- `image_search` — Image search
- `web_fetch` — Fetch URL, extract content as markdown

**Configuration:**
- `BRAVE_API_KEY` — Required API key from api.search.brave.com

**Dependencies:** Brave Search API, `linkedom`, `turndown`, `@mozilla/readability`

**Common failures:**
- "BRAVE_API_KEY not configured" → Missing env var, Searcher won't start
- Rate limits → Brave API has per-minute rate limits; errors returned to caller
- `web_fetch` timeouts → Some sites block or are slow; timeout after configured limit

---

## Gmail

**Purpose:** Gmail and Google Calendar integration.
**Transport:** Stdio | **Sensitive:** Yes

**Tools:**

*Email:* `list_emails`, `get_email`, `send_email`, `reply_email`, `delete_email`, `mark_read`, `modify_labels` (accepts label names or IDs), `get_new_emails`
*Drafts:* `list_drafts`, `create_draft`, `update_draft`, `send_draft`, `delete_draft`
*Labels:* `list_labels`, `create_label`, `delete_label`
*Attachments:* `list_attachments`, `get_attachment`
*Calendar:* `list_calendars`, `list_events`, `get_event`, `create_event`, `update_event`, `delete_event`, `quick_add_event`, `find_free_time`
*Filters:* `list_filters`, `get_filter`, `create_filter`, `delete_filter`

**Configuration:**
- OAuth token auto-created via `npm run setup-oauth` in Gmail-MCP directory
- `GMAIL_NOTIFY_TELEGRAM` — Send Telegram notifications for new emails
- `GMAIL_TELEGRAM_CHAT_ID` — Telegram chat ID for notifications

**Dependencies:** Google APIs (`googleapis` npm), OAuth credentials

**Common failures:**
- OAuth token expired → Health returns "degraded". Fix: `cd Gmail-MCP && npm run setup-oauth`
- Insufficient scopes → Re-run OAuth setup with correct API scopes
- Calendar API not enabled → Enable in Google Cloud Console

---

## Browser (Web)

**Purpose:** Headless Chromium browser automation.
**Transport:** Stdio | **Sensitive:** Yes | **MCP Name:** `web` | **Timeout:** 60,000ms

**Tools:** Provided by `@playwright/mcp` — page navigation, element interaction, screenshots, HTML extraction.

**Configuration:**
- `BROWSER_PROXY_SERVER` — Optional proxy server URL
- `BROWSER_PROXY_USERNAME`, `BROWSER_PROXY_PASSWORD` — Proxy auth

**Dependencies:** Chromium engine (installed via Playwright)

**Common failures:**
- Chromium not installed → Run `npx playwright install chromium`
- Timeout (60s) → Complex pages may take too long to load
- "offline" in `/status` → Browser MCP not responding; may need restart

---

## Key Files

| File | Purpose |
|------|---------|
| Each MCP's `package.json` | `"annabelle"` manifest (mcpName, transport, sensitive, role) |
| Each MCP's `src/server.ts` | Tool registrations |
| Each MCP's `src/index.ts` | Startup, health check, graceful shutdown |
| `Orchestrator/src/mcp-clients/stdio-client.ts` | How Orchestrator spawns and communicates with stdio MCPs |
