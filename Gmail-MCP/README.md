# Gmail MCP

An MCP (Model Context Protocol) server that provides full Gmail access to AI assistants. Part of the Annabelle AI assistant system, it allows Thinker to check, send, and manage emails via Telegram commands.

## Installation

### Prerequisites

- Node.js >= 22
- A Google Cloud project with the Gmail API enabled

### 1. Install dependencies

```bash
npm install
```

### 2. Set up Google Cloud credentials

1. Go to the [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select an existing one
3. Navigate to **APIs & Services > Library** and enable the **Gmail API**
4. Go to **APIs & Services > Credentials**
5. Click **Create Credentials > OAuth 2.0 Client ID**
6. Select **Web application** as the application type
7. Add `http://localhost:9090/oauth2callback` as an authorized redirect URI
8. Download the JSON file and save it to `~/.annabelle/gmail/credentials.json`

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` if you need to change any defaults. The defaults work out of the box for stdio transport.

### 4. Authenticate with Gmail

```bash
npm run setup-oauth
```

This opens your browser to Google's consent screen. After granting access, the refresh token is saved to `~/.annabelle/gmail/token.json`. You only need to do this once.

### 5. Build and start

```bash
npm run build
npm start
```

Or for development:

```bash
npm run dev
```

## Usage

### Transport modes

The server supports two transport modes, configured via the `TRANSPORT` env var:

- **stdio** (default) -- communicates over stdin/stdout, used when the Orchestrator spawns this as a child process
- **sse/http** -- runs an HTTP server on `PORT` with SSE, health check, and direct tool call endpoints

### As part of the Annabelle system

The Orchestrator spawns Gmail MCP as a stdio child process and routes tool calls to it. No manual startup is needed once configured in the Orchestrator's MCP list.

Typical flow: **Telegram message -> Thinker -> Orchestrator -> Gmail MCP -> Gmail API**

### Direct tool calls (HTTP mode)

When running in HTTP mode, you can call tools directly:

```bash
# Health check
curl http://localhost:8008/health

# List recent emails
curl -X POST http://localhost:8008/tools/call \
  -H "Content-Type: application/json" \
  -d '{"name": "list_emails", "arguments": {"max_results": 5}}'

# Send an email
curl -X POST http://localhost:8008/tools/call \
  -H "Content-Type: application/json" \
  -d '{"name": "send_email", "arguments": {"to": "someone@example.com", "subject": "Hello", "body": "Hi there"}}'
```

### Email polling

Set `GMAIL_POLLING_ENABLED=true` to enable background polling. New inbox emails are stored in an in-memory queue (max 100) accessible via the `get_new_emails` tool. Polling uses the Gmail History API for efficiency.

When `GMAIL_NOTIFY_TELEGRAM=true` is also set, new emails trigger a notification to the configured Telegram chat via the Orchestrator.

## Tools

### Messages

| Tool | Description |
|------|-------------|
| `list_emails` | List emails with Gmail search query and filters |
| `get_email` | Get full email content by ID |
| `send_email` | Send a new email |
| `reply_email` | Reply to an existing thread |
| `delete_email` | Move an email to trash |
| `mark_read` | Mark an email as read or unread |
| `modify_labels` | Add or remove labels from an email |
| `get_new_emails` | Get emails from the polling queue |

### Drafts

| Tool | Description |
|------|-------------|
| `list_drafts` | List all drafts |
| `create_draft` | Create a new draft |
| `update_draft` | Update an existing draft |
| `send_draft` | Send a draft |
| `delete_draft` | Delete a draft |

### Labels

| Tool | Description |
|------|-------------|
| `list_labels` | List all labels (system and user-created) |
| `create_label` | Create a new label |
| `delete_label` | Delete a user-created label |

### Attachments

| Tool | Description |
|------|-------------|
| `list_attachments` | List attachments for an email |
| `get_attachment` | Download an attachment (base64) |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TRANSPORT` | `stdio` | Transport mode: `stdio`, `sse`, or `http` |
| `PORT` | `8008` | HTTP server port (SSE/HTTP mode only) |
| `GMAIL_CREDENTIALS_PATH` | `~/.annabelle/gmail/credentials.json` | Path to OAuth credentials JSON |
| `GMAIL_TOKEN_PATH` | `~/.annabelle/gmail/token.json` | Path to stored OAuth token |
| `GMAIL_POLLING_ENABLED` | `false` | Enable background email polling |
| `GMAIL_POLLING_INTERVAL_MS` | `60000` | Polling interval in milliseconds |
| `GMAIL_NOTIFY_TELEGRAM` | `false` | Send Telegram notifications for new emails |
| `GMAIL_TELEGRAM_CHAT_ID` | | Telegram chat ID for notifications |
| `ORCHESTRATOR_URL` | `http://localhost:8010` | Orchestrator URL for sending notifications |
| `LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |

## Project structure

```
src/
├── index.ts              # Entry point, transport setup
├── server.ts             # MCP server, ListTools/CallTool handlers
├── config/
│   ├── index.ts          # Config loader
│   └── schema.ts         # Zod config validation
├── gmail/
│   ├── auth.ts           # OAuth2 token management
│   ├── client.ts         # Gmail API wrapper
│   ├── polling.ts        # Background email polling
│   └── notifications.ts  # Telegram notifications
├── tools/
│   ├── index.ts          # Tool registry (18 tools)
│   ├── messages.ts       # Email tools
│   ├── drafts.ts         # Draft tools
│   ├── labels.ts         # Label tools
│   └── attachments.ts    # Attachment tools
├── types/
│   ├── gmail.ts          # Gmail types
│   └── responses.ts      # StandardResponse
└── utils/
    ├── logger.ts         # Logging (stderr to keep stdout clean)
    └── config.ts         # Env var helpers
```
