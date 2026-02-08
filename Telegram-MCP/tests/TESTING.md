# Telegram MCP Testing Plan

## Overview

This document outlines the integration testing strategy for the Telegram MCP server (port 8002).

The Telegram MCP provides messaging capabilities via the MTProto protocol, enabling:
- Sending and receiving messages
- Managing chats and groups
- Contact management
- Media uploads and downloads
- Real-time message subscriptions

## Testing Philosophy

We focus on **integration tests against the real MCP server** rather than unit tests with mocks because:
1. MCP clients are thin HTTP wrappers - little logic to unit test
2. Real value is verifying actual Telegram API behavior
3. Mocking HTTP responses only tests the mocks, not reality

---

## Test Environment Setup

### Prerequisites
- Telegram MCP server running locally (via `npm run dev` or `start-all.sh`)
- Valid Telegram credentials configured

### Environment Variables
```bash
TELEGRAM_API_ID=<your_api_id>
TELEGRAM_API_HASH=<your_api_hash>
TELEGRAM_SESSION=<session_string>
TRANSPORT=http
PORT=8002
```

### Test Data
- A test chat/group ID (extracted from `list_chats`)
- A test image file for media tests
- Unique message prefix for identification: `[TEST_<timestamp>]`

---

## Level 2: Integration Tests

### 2.1 Health & Initialization

| Test Case | Input | Expected |
|-----------|-------|----------|
| Health check | `GET /health` | `200 OK` with `{ status: "ok" }` |
| Get current user | `get_me` with `{}` | User object with `id`, `username`, `firstName` |

---

### 2.2 Chat Operations

| Test Case | Tool | Input | Expected |
|-----------|------|-------|----------|
| List chats | `list_chats` | `{}` | `{ count, chats[] }` with chat objects |
| List with limit | `list_chats` | `{ limit: 10 }` | Max 10 chats returned |
| Get chat by ID | `get_chat` | `{ chat_id }` | Chat object with `id`, `type`, `title` |
| Get invalid chat | `get_chat` | `{ chat_id: "invalid" }` | Error response |
| Create group | `create_group` | `{ title, user_ids }` | New chat object with `id`, `type: "group"` |

---

### 2.3 Message Operations

| Test Case | Tool | Input | Expected |
|-----------|------|-------|----------|
| Send message | `send_message` | `{ chat_id, message }` | `{ success: true, message }` with `id` |
| Send with reply | `send_message` | `{ chat_id, message, reply_to }` | Message with reply reference |
| Invalid chat | `send_message` | `{ chat_id: "invalid", message }` | Error response |
| Get messages | `get_messages` | `{ chat_id, limit: 10 }` | `{ count, messages[] }` |
| Get with offset | `get_messages` | `{ chat_id, offset_id }` | Paginated messages before offset |
| Search in chat | `search_messages` | `{ query, chat_id }` | Matching messages from chat |
| Global search | `search_messages` | `{ query }` | Messages from all chats |
| Delete messages | `delete_messages` | `{ chat_id, message_ids }` | `{ success: true, deleted_count }` |

---

### 2.4 Contact Operations

| Test Case | Tool | Input | Expected |
|-----------|------|-------|----------|
| List contacts | `list_contacts` | `{}` | `{ count, contacts[] }` |
| Search users | `search_users` | `{ query }` | `{ count, users[] }` |
| Search with limit | `search_users` | `{ query, limit: 5 }` | Max 5 users returned |

---

### 2.5 Media Operations

| Test Case | Tool | Input | Expected |
|-----------|------|-------|----------|
| Send image | `send_media` | `{ chat_id, file_path }` | Message with media |
| Send with caption | `send_media` | `{ chat_id, file_path, caption }` | Message with caption |
| Invalid file | `send_media` | `{ chat_id, file_path: "/no/file" }` | Error response |
| Download media | `download_media` | `{ chat_id, message_id, output_path }` | `{ success: true, path }` |
| No media in msg | `download_media` | `{ chat_id, message_id }` (no media) | Error: no media |

---

### 2.6 Utility Operations

| Test Case | Tool | Input | Expected |
|-----------|------|-------|----------|
| Mark all read | `mark_read` | `{ chat_id }` | `{ success: true, marked_up_to: "all" }` |
| Mark up to ID | `mark_read` | `{ chat_id, message_id }` | `{ success: true, marked_up_to }` |

---

### 2.7 Real-time Subscriptions

| Test Case | Tool | Input | Expected |
|-----------|------|-------|----------|
| List subscriptions | `subscribe_chat` | `{ action: "list" }` | `{ subscriptions[], count, mode }` |
| Subscribe to chat | `subscribe_chat` | `{ action: "subscribe", chat_id }` | `{ success: true, subscribed, total }` |
| Unsubscribe | `subscribe_chat` | `{ action: "unsubscribe", chat_id }` | `{ success: true, unsubscribed }` |
| Clear all | `subscribe_chat` | `{ action: "clear" }` | `{ success: true, message }` |
| Get new messages | `get_new_messages` | `{}` | `{ messages[], count, cleared: true }` |
| Peek messages | `get_new_messages` | `{ peek: true }` | `{ messages[], queueSize }` (not cleared) |

---

## Level 2.5: Lifecycle Tests

### Message Lifecycle Test

A sequential test verifying the complete message flow:

```
Step 1: Send a test message
├── Call send_message with unique test content
├── Verify: Message sent successfully with message_id
└── Store: message_id for later steps

Step 2: Retrieve the message
├── Call get_messages for the same chat
├── Verify: Sent message appears in history
└── Verify: Content matches what was sent

Step 3: Search for the message
├── Call search_messages with unique test text
├── Verify: Message found in search results
└── Verify: Message ID matches

Step 4: Delete the message
├── Call delete_messages with stored message_id
├── Verify: Success response with deleted_count=1
└── Why: Clean up test data
```

---

### Real-time Subscription Lifecycle Test

A sequential test verifying real-time message capture:

```
Step 1: Clear existing subscriptions
├── Call subscribe_chat with action="clear"
├── Verify: Success, receiving all chats mode
└── Why: Start with clean state

Step 2: Subscribe to a specific chat
├── Call subscribe_chat with action="subscribe", chat_id
├── Verify: Success, subscription added
└── Why: Set up filtering

Step 3: List subscriptions
├── Call subscribe_chat with action="list"
├── Verify: Contains subscribed chat_id
├── Verify: mode="filtered"
└── Why: Confirm subscription state

Step 4: Clear message queue
├── Call get_new_messages
├── Verify: Queue cleared
└── Why: Baseline for incoming messages

Step 5: Send message to subscribed chat
├── Call send_message to subscribed chat
├── Verify: Message sent
└── Why: Trigger incoming message event

Step 6: Poll for new messages
├── Wait briefly, then call get_new_messages
├── Verify: Contains the sent message
├── Verify: Queue cleared after retrieval
└── Why: Confirm real-time capture works

Step 7: Unsubscribe and cleanup
├── Call subscribe_chat with action="clear"
├── Verify: Success
└── Why: Clean up
```

---

## Test Execution

### Running Tests

```bash
# Run all integration tests
npm test

# Run tests in watch mode
npm run test:watch
```

### Test Output

Tests produce rich console output showing:
- Timestamps for each action
- Success/failure indicators with colors
- Duration of each operation
- Debug information for troubleshooting

Example output:
```
━━━ Telegram MCP Tests (http://localhost:8002) ━━━

[12:34:56.789] ℹ Checking health at http://localhost:8002/health
[12:34:56.812] ✓ Health check passed (23ms)
[12:34:56.813] ℹ Calling list_chats tool
[12:34:56.891] ✓ list_chats succeeded (78ms)
```

---

## Success Criteria

The Telegram MCP should pass:
- [ ] Health check responds 200
- [ ] All 16 tools are callable
- [ ] Valid inputs return expected response format
- [ ] Invalid inputs return proper error responses
- [ ] Timeouts are handled gracefully (< 10s)
- [ ] Message lifecycle test passes end-to-end
- [ ] Subscription lifecycle test passes end-to-end
