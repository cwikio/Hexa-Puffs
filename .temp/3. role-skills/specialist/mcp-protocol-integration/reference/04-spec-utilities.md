# MCP Utilities Reference

**Spec Version:** 2025-11-25

## Tasks (Experimental, new in 2025-11-25)

Tasks are durable state machines for long-running or async operations. Either side (client or server) can be the requestor or receiver.

### Server Capabilities

```json
{
  "capabilities": {
    "tasks": {
      "list": {},
      "cancel": {},
      "requests": { "tools": { "call": {} } }
    }
  }
}
```

### Client Capabilities

```json
{
  "capabilities": {
    "tasks": {
      "list": {},
      "cancel": {},
      "requests": {
        "sampling": { "createMessage": {} },
        "elicitation": { "create": {} }
      }
    }
  }
}
```

### Tool-Level Negotiation

Tools declare task support via `execution.taskSupport`:
- `"required"`: Client **MUST** invoke as task
- `"optional"`: Client **MAY** invoke as task
- `"forbidden"` or absent: Client **MUST NOT** invoke as task

### Creating Tasks

```json
// Request (add task field to any supported request)
{
  "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": {
    "name": "process_batch",
    "arguments": { "data": "..." },
    "task": { "ttl": 60000 }
  }
}

// Response (CreateTaskResult — NOT the actual result)
{
  "jsonrpc": "2.0", "id": 1,
  "result": {
    "task": {
      "taskId": "786512e2-...",
      "status": "working",
      "statusMessage": "Processing...",
      "createdAt": "2025-11-25T10:30:00Z",
      "lastUpdatedAt": "2025-11-25T10:30:00Z",
      "ttl": 60000,
      "pollInterval": 5000
    }
  }
}
```

### Polling (tasks/get)

```json
// Request
{ "jsonrpc": "2.0", "id": 3, "method": "tasks/get", "params": { "taskId": "786512e2-..." } }

// Response
{
  "jsonrpc": "2.0", "id": 3,
  "result": {
    "taskId": "786512e2-...",
    "status": "working",
    "createdAt": "2025-11-25T10:30:00Z",
    "lastUpdatedAt": "2025-11-25T10:40:00Z",
    "ttl": 30000,
    "pollInterval": 5000
  }
}
```

### Retrieving Results (tasks/result)

Blocks until terminal status. Returns the actual operation result (e.g., `CallToolResult`).

```json
// Request
{ "jsonrpc": "2.0", "id": 4, "method": "tasks/result", "params": { "taskId": "786512e2-..." } }

// Response (matches original request type)
{
  "jsonrpc": "2.0", "id": 4,
  "result": {
    "content": [{ "type": "text", "text": "Batch processing complete..." }],
    "isError": false,
    "_meta": {
      "io.modelcontextprotocol/related-task": { "taskId": "786512e2-..." }
    }
  }
}
```

### Status Lifecycle

```
[*] --> working
working --> input_required
working --> completed | failed | cancelled
input_required --> working
input_required --> completed | failed | cancelled
completed, failed, cancelled --> [terminal, MUST NOT transition]
```

- `working`: Being processed
- `input_required`: Receiver needs input from requestor (call `tasks/result` to receive input requests)
- `completed`: Done successfully
- `failed`: Failed (includes `isError: true` tool results)
- `cancelled`: Cancelled by requestor

### Listing Tasks (tasks/list)

Supports cursor-based pagination. Returns tasks visible to the requestor.

### Cancelling Tasks (tasks/cancel)

- Receiver **MUST** reject cancellation of terminal tasks (`-32602`)
- Cancelled tasks **MUST** remain cancelled even if execution continues

### Related Task Metadata

All messages related to a task **MUST** include:

```json
{ "_meta": { "io.modelcontextprotocol/related-task": { "taskId": "..." } } }
```

### Model Immediate Response

Server **MAY** include hint in `CreateTaskResult._meta`:

```json
{ "_meta": { "io.modelcontextprotocol/model-immediate-response": "Processing your batch..." } }
```

This lets the host return control to the model while the task executes in background.

---

## Progress

Track progress of long-running operations.

```json
// Include progressToken in request _meta
{
  "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": {
    "name": "index_files",
    "arguments": { "path": "/project" },
    "_meta": { "progressToken": "progress-1" }
  }
}

// Progress notification
{
  "jsonrpc": "2.0", "method": "notifications/progress",
  "params": {
    "progressToken": "progress-1",
    "progress": 50,
    "total": 100,
    "message": "Indexing files..."
  }
}
```

---

## Cancellation

```json
{
  "jsonrpc": "2.0", "method": "notifications/cancelled",
  "params": {
    "requestId": 42,
    "reason": "User cancelled the operation"
  }
}
```

- For task-augmented requests, use `tasks/cancel` instead
- Receiver **SHOULD** stop work but **MAY** have already completed

---

## Pagination

All list operations use cursor-based pagination:

```json
// Request
{ "params": { "cursor": "opaque-cursor-string" } }

// Response
{ "result": { "items": [...], "nextCursor": "next-page-cursor" } }
```

Used by: `tools/list`, `resources/list`, `prompts/list`, `resources/templates/list`, `tasks/list`

---

## Logging

**Capability:** `logging: {}`

### Set Log Level

```json
{ "jsonrpc": "2.0", "id": 1, "method": "logging/setLevel", "params": { "level": "warning" } }
```

### Log Notification

```json
{
  "jsonrpc": "2.0", "method": "notifications/message",
  "params": {
    "level": "error",
    "logger": "database",
    "data": { "message": "Connection failed", "code": "ECONNREFUSED" }
  }
}
```

**Levels:** debug, info, notice, warning, error, critical, alert, emergency

---

## Completion (Autocomplete)

**Capability:** `completions: {}`

```json
// Request
{
  "jsonrpc": "2.0", "id": 1, "method": "completion/complete",
  "params": {
    "ref": { "type": "ref/prompt", "name": "code_review" },
    "argument": { "name": "language", "value": "py" }
  }
}

// Response
{
  "jsonrpc": "2.0", "id": 1,
  "result": {
    "completion": {
      "values": ["python", "pytorch"],
      "hasMore": true,
      "total": 10
    }
  }
}
```

Reference types: `ref/prompt` (prompt argument) or `ref/resource` (resource template URI).
