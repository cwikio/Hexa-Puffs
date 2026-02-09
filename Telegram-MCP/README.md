# Telegram MCP Server

MCP server for Telegram using MTProto protocol. Enables AI agents to send messages, manage chats, contacts, and media.

---

## Quick Start

### 1. Install

```bash
cd Telegram-MCP
npm install
npm run build
```

### 2. Get Telegram API Credentials

1. Go to https://my.telegram.org
2. Log in with your phone number
3. Click "API development tools"
4. Create an app → get `api_id` and `api_hash`

### 3. Generate Session

```bash
# Create .env file
cp .env.example .env

# Add your api_id and api_hash to .env, then run:
npm run setup
```

Follow the prompts:

- Enter phone number (e.g., `+1234567890`)
- Enter verification code (sent to your Telegram)
- Enter 2FA password (if enabled)

Copy the output `TELEGRAM_SESSION=...` to your `.env` file.

### 4. Configure Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "telegram": {
      "command": "node",
      "args": ["<repo-root>/Telegram-MCP/dist/src/index.js"],
      "env": {
        "TELEGRAM_API_ID": "<your_api_id>",
        "TELEGRAM_API_HASH": "<your_api_hash>",
        "TELEGRAM_SESSION": "<your_session_string>"
      }
    }
  }
}
```

Replace `<repo-root>` with the absolute path to your cloned repository.

### 5. Restart Claude Desktop

Quit completely (Cmd+Q) and reopen.

---

## Available Tools (16)

### Standard Tools (14)

| Tool              | Description                           |
| ----------------- | ------------------------------------- |
| `send_message`    | Send text message to a chat           |
| `get_messages`    | Get message history                   |
| `search_messages` | Search messages (in chat or globally) |
| `delete_messages` | Delete messages                       |
| `list_chats`      | List all dialogs/chats                |
| `get_chat`        | Get chat/user info                    |
| `create_group`    | Create a new group                    |
| `list_contacts`   | List saved contacts                   |
| `add_contact`     | Add contact by phone                  |
| `search_users`    | Search users globally                 |
| `send_media`      | Send photo/document                   |
| `download_media`  | Download media from message           |
| `get_me`          | Get current account info              |
| `mark_read`       | Mark messages as read                 |

### Real-Time Tools (2)

| Tool              | Description                                          |
| ----------------- | ---------------------------------------------------- |
| `get_new_messages`| Get messages received since last call (clears queue) |
| `subscribe_chat`  | Manage chat subscriptions for filtering              |

---

## Real-Time Message Handling

The Telegram MCP supports real-time message capture using GramJS event handlers.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Telegram Servers                          │
└─────────────────────────┬───────────────────────────────────┘
                          │ MTProto (encrypted)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   GramJS Client                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │            NewMessage Event Handler                  │    │
│  │                                                      │    │
│  │  • Captures all incoming messages instantly          │    │
│  │  • Filters by subscribed chats (optional)           │    │
│  │  • Adds to in-memory queue (max 1000)               │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   Message Queue                              │
│                                                              │
│  • In-memory storage (up to 1000 messages)                  │
│  • FIFO - oldest messages dropped when full                 │
│  • Cleared when retrieved via get_new_messages              │
└─────────────────────────────────────────────────────────────┘
```

### How It Works

1. **Event Registration** - When the client connects, it registers a `NewMessage` event handler
2. **Message Capture** - Every incoming message triggers the handler instantly
3. **Queue Storage** - Messages are formatted and added to an in-memory queue
4. **Subscription Filter** - If chats are subscribed, only those messages are queued
5. **Retrieval** - Call `get_new_messages` to retrieve and clear the queue

### Usage Examples

#### Get new messages (clears queue)

```json
{
  "name": "get_new_messages",
  "arguments": {}
}
```

Returns:
```json
{
  "messages": [
    {
      "id": 12345,
      "chatId": "123456789",
      "text": "Hello!",
      "date": "2024-01-15T10:30:00Z",
      "isOutgoing": false,
      "receivedAt": "2024-01-15T10:30:01Z"
    }
  ],
  "count": 1,
  "cleared": true
}
```

#### Peek without clearing

```json
{
  "name": "get_new_messages",
  "arguments": { "peek": true }
}
```

#### Subscribe to specific chat

```json
{
  "name": "subscribe_chat",
  "arguments": { "action": "subscribe", "chat_id": "123456789" }
}
```

#### List subscriptions

```json
{
  "name": "subscribe_chat",
  "arguments": { "action": "list" }
}
```

#### Clear subscriptions (receive all)

```json
{
  "name": "subscribe_chat",
  "arguments": { "action": "clear" }
}
```

### Integration with Orchestrator

The Orchestrator includes an Inngest job that polls `get_new_messages` every 10 seconds:

1. Fetches new messages from Telegram MCP
2. Skips outgoing messages (your own)
3. Logs each message to Memory MCP
4. Clears the queue after processing

This enables near-real-time message awareness without constant polling from the AI.

---

## Environment Variables

| Variable            | Required | Description                  |
| ------------------- | -------- | ---------------------------- |
| `TELEGRAM_API_ID`   | Yes      | From my.telegram.org         |
| `TELEGRAM_API_HASH` | Yes      | From my.telegram.org         |
| `TELEGRAM_SESSION`  | Yes      | Generated by `npm run setup` |
| `TRANSPORT`         | No       | `stdio` (default) or `http`  |
| `PORT`              | No       | HTTP port (default: 3000)    |

---

## Usage Examples

### Send a message

```
Send "Hello!" to chat 123456789
```

### List chats

```
List my Telegram chats
```

### Search messages

```
Search for "meeting" in my Telegram messages
```

### Get chat info

```
Get info about @username on Telegram
```

---

## File Structure

```
Telegram/
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # MCP server setup
│   ├── telegram/
│   │   ├── client.ts         # GramJS wrapper + event registration
│   │   ├── events.ts         # Real-time event handler & queue
│   │   ├── session.ts        # Session management
│   │   └── types.ts          # TypeScript interfaces
│   └── tools/                # Tool implementations
│       ├── messages/
│       ├── chats/
│       ├── contacts/
│       ├── media/
│       ├── utility/
│       └── realtime/         # Real-time tools
│           ├── get-new-messages.ts
│           └── subscribe-chat.ts
├── scripts/
│   ├── setup-session.ts      # Auth setup CLI
│   └── test-connection.ts    # Connection test
├── dist/                     # Compiled output
├── run.sh                    # Launcher script
├── .env                      # Credentials (git-ignored)
└── package.json
```

---

## Development

### Rebuild after changes

```bash
npm run build
```

### Type check

```bash
npm run typecheck
```

### Test connection

```bash
npm run test
```

### Run locally (without Claude)

```bash
npm start
```

---

## Troubleshooting

### "TELEGRAM_SESSION is required"

Run `npm run setup` to generate a session string.

### "FloodWaitError"

You're being rate limited by Telegram. Wait the specified time.

### "Session expired"

Generate a new session with `npm run setup`. This can happen if you log out from Telegram's "Active Sessions".

### Tool calls timeout

Check your internet connection. The first request after startup takes 2-3 seconds to connect.

### Finding chat IDs

Use `list_chats` tool to see all your chats with their IDs. Use these IDs with other tools.

---

## Docker (Optional)

Docker has networking issues with Telegram's MTProto on macOS. Use `run.sh` instead.

If you need Docker (e.g., on Linux):

```bash
# Build
docker build -t telegram-mcp .

# Run (stdio mode)
docker run -i --rm --env-file .env telegram-mcp
```

---

## Security Notes

- **Session string** grants full account access - keep it private
- **API credentials** should never be shared
- `.env` file is git-ignored
- Session persists until revoked in Telegram's "Active Sessions"

---

## Technology Stack

- **Language**: TypeScript
- **Telegram Library**: GramJS (MTProto)
- **MCP SDK**: @modelcontextprotocol/sdk
- **Validation**: Zod
- **Runtime**: Node.js 22+

---

## License

MIT
