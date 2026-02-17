# Outlook MCP

MCP server for reading and sending emails via Microsoft Graph API. Built for Microsoft 365 / Exchange accounts where the Gmail API isn't available (e.g., Google Workspace with Exchange email routing).

## Why This Exists

Google Workspace accounts that route email through Microsoft Exchange cannot use the Gmail API — it returns `failedPrecondition`. Calendar works fine via Google Calendar API, but emails live in Exchange and must be accessed through Microsoft Graph.

## Tools (v1)

| Tool | Description |
|------|-------------|
| `list_emails` | List or search emails with folder filtering, search queries, and OData filters |
| `get_email` | Get full email details (body, attachments info, headers) by message ID |
| `send_email` | Send a new email (to, subject, body; optional cc, bcc) |
| `reply_email` | Reply to an existing email thread |
| `mark_read` | Mark an email as read or unread |
| `list_folders` | List mail folders (Inbox, Sent Items, Drafts, etc.) |

## Setup

See [SETUP.md](SETUP.md) for the full guide: Azure app registration, permissions, and authentication.

**Quick start** (after Azure app is registered):

```bash
npm install
npm run setup-oauth   # authenticate via device code flow
npm run build
```

The Orchestrator auto-discovers this MCP via the `hexa-puffs` field in package.json.

## Architecture

```
src/
├── index.ts              # Entry point (loadEnvSafely → initializeServer → startTransport)
├── server.ts             # McpServer + tool registration
├── config/
│   ├── schema.ts         # Zod config schema
│   └── index.ts          # Singleton getConfig()
├── outlook/
│   ├── auth.ts           # MSAL device code flow + file-based token cache
│   └── client.ts         # Microsoft Graph API calls
├── tools/
│   ├── messages.ts       # list_emails, get_email, send_email, reply_email, mark_read
│   ├── folders.ts        # list_folders
│   └── index.ts          # allTools[] aggregation
├── types/
│   └── outlook.ts        # EmailMessage, EmailSummary, MailFolder, etc.
└── utils/
    ├── logger.ts         # Shared Logger wrapper
    └── config.ts         # expandPath, getEnvString, etc.
```

## Testing

```bash
npm test              # all tests (43 total)
npm run test:unit     # unit tests only (33 tests)
npm run test:e2e      # e2e health check (2 tests)
npm run typecheck     # tsc --noEmit
```

## Future Enhancements

Potential additions for v2+:

- **Drafts** — `create_draft`, `update_draft`, `list_drafts`, `send_draft`
- **Attachments** — `list_attachments`, `get_attachment`, `add_attachment`
- **Categories / Labels** — `list_categories`, `categorize_email`
- **Mail Rules** — `list_rules`, `create_rule`
- **Focused Inbox** — filter by focused vs other
- **Folder management** — `create_folder`, `move_email`, `delete_email`
- **Search enhancements** — KQL search syntax, date range helpers
- **Batch operations** — mark multiple emails read, bulk move
