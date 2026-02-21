# MCP Server Features Reference

**Spec Version:** 2025-11-25

## Tools

**Capability:** `tools: { listChanged: true }`

Tools are **model-controlled** — the LLM discovers and invokes them. There **SHOULD** always be a human in the loop.

### tools/list

```json
// Request
{ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": { "cursor": "optional" } }

// Response
{
  "jsonrpc": "2.0", "id": 1,
  "result": {
    "tools": [{
      "name": "get_weather",
      "title": "Weather Info",
      "description": "Get current weather for a location",
      "inputSchema": {
        "type": "object",
        "properties": { "location": { "type": "string" } },
        "required": ["location"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "temperature": { "type": "number" },
          "conditions": { "type": "string" }
        },
        "required": ["temperature", "conditions"]
      },
      "annotations": {
        "readOnlyHint": true,
        "destructiveHint": false,
        "idempotentHint": true,
        "openWorldHint": true
      }
    }],
    "nextCursor": "next-page-cursor"
  }
}
```

### tools/call

```json
// Request
{
  "jsonrpc": "2.0", "id": 2, "method": "tools/call",
  "params": { "name": "get_weather", "arguments": { "location": "New York" } }
}

// Response (unstructured)
{
  "jsonrpc": "2.0", "id": 2,
  "result": {
    "content": [{ "type": "text", "text": "Temperature: 72F, Partly cloudy" }],
    "isError": false
  }
}

// Response (structured, when outputSchema defined)
{
  "jsonrpc": "2.0", "id": 2,
  "result": {
    "content": [{ "type": "text", "text": "{\"temperature\": 22.5, \"conditions\": \"Partly cloudy\"}" }],
    "structuredContent": { "temperature": 22.5, "conditions": "Partly cloudy" },
    "isError": false
  }
}
```

### Tool Definition Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier (1-128 chars, A-Za-z0-9_-.) |
| `title` | No | Human-readable display name |
| `description` | No | Functionality description |
| `inputSchema` | Yes | JSON Schema for parameters (defaults to 2020-12) |
| `outputSchema` | No | JSON Schema for structured output |
| `annotations` | No | Behavior hints (untrusted unless from trusted server) |
| `icons` | No | Array of icons for UI display |

### Tool Annotations

| Annotation | Default | Description |
|-----------|---------|-------------|
| `readOnlyHint` | false | Does not modify environment |
| `destructiveHint` | true | May perform destructive updates |
| `idempotentHint` | false | Repeated calls have same effect |
| `openWorldHint` | true | Interacts with external systems |

### Content Types in Tool Results

**TextContent:** `{ "type": "text", "text": "..." }`

**ImageContent:** `{ "type": "image", "data": "base64...", "mimeType": "image/png" }`

**AudioContent:** `{ "type": "audio", "data": "base64...", "mimeType": "audio/wav" }`

**ResourceLink:** `{ "type": "resource_link", "uri": "file:///...", "name": "...", "mimeType": "..." }`

**EmbeddedResource:** `{ "type": "resource", "resource": { "uri": "...", "mimeType": "...", "text": "..." } }`

All content types support optional annotations: `{ "audience": ["user", "assistant"], "priority": 0.9 }`

### Error Handling

- **Protocol errors** (JSON-RPC): unknown tool, malformed request (-32602)
- **Tool execution errors**: `isError: true` in result — LLM can self-correct and retry

### List Changed Notification

```json
{ "jsonrpc": "2.0", "method": "notifications/tools/list_changed" }
```

---

## Resources

**Capability:** `resources: { subscribe: true, listChanged: true }`

Resources are **application-driven** — the host decides how to incorporate them.

### resources/list

```json
// Request
{ "jsonrpc": "2.0", "id": 1, "method": "resources/list", "params": { "cursor": "optional" } }

// Response
{
  "jsonrpc": "2.0", "id": 1,
  "result": {
    "resources": [{
      "uri": "file:///project/src/main.rs",
      "name": "main.rs",
      "title": "Main File",
      "description": "Primary entry point",
      "mimeType": "text/x-rust"
    }],
    "nextCursor": "..."
  }
}
```

### resources/read

```json
// Request
{ "jsonrpc": "2.0", "id": 2, "method": "resources/read", "params": { "uri": "file:///project/src/main.rs" } }

// Response (text)
{
  "jsonrpc": "2.0", "id": 2,
  "result": {
    "contents": [{
      "uri": "file:///project/src/main.rs",
      "mimeType": "text/x-rust",
      "text": "fn main() { ... }"
    }]
  }
}

// Response (binary)
{
  "jsonrpc": "2.0", "id": 2,
  "result": {
    "contents": [{
      "uri": "file:///image.png",
      "mimeType": "image/png",
      "blob": "base64-encoded-data"
    }]
  }
}
```

### Resource Templates (URI Templates, RFC 6570)

```json
// Request
{ "jsonrpc": "2.0", "id": 3, "method": "resources/templates/list" }

// Response
{
  "jsonrpc": "2.0", "id": 3,
  "result": {
    "resourceTemplates": [{
      "uriTemplate": "file:///{path}",
      "name": "Project Files",
      "mimeType": "application/octet-stream"
    }]
  }
}
```

### Subscriptions

```json
// Subscribe
{ "jsonrpc": "2.0", "id": 4, "method": "resources/subscribe", "params": { "uri": "file:///config.json" } }

// Update notification
{ "jsonrpc": "2.0", "method": "notifications/resources/updated", "params": { "uri": "file:///config.json" } }

// List changed notification
{ "jsonrpc": "2.0", "method": "notifications/resources/list_changed" }
```

### Resource Annotations

```json
{
  "annotations": {
    "audience": ["user", "assistant"],
    "priority": 0.8,
    "lastModified": "2025-01-12T15:00:58Z"
  }
}
```

### Common URI Schemes

| Scheme | Usage |
|--------|-------|
| `https://` | Web-accessible resources (client can fetch directly) |
| `file://` | Filesystem-like resources (may be virtual) |
| `git://` | Git version control resources |
| Custom | Must follow RFC 3986 |

---

## Prompts

**Capability:** `prompts: { listChanged: true }`

Prompts are **user-controlled** — exposed for explicit user selection (e.g., slash commands).

### prompts/list

```json
// Request
{ "jsonrpc": "2.0", "id": 1, "method": "prompts/list", "params": { "cursor": "optional" } }

// Response
{
  "jsonrpc": "2.0", "id": 1,
  "result": {
    "prompts": [{
      "name": "code_review",
      "title": "Request Code Review",
      "description": "Asks the LLM to analyze code quality",
      "arguments": [
        { "name": "code", "description": "The code to review", "required": true }
      ]
    }],
    "nextCursor": "..."
  }
}
```

### prompts/get

```json
// Request
{
  "jsonrpc": "2.0", "id": 2, "method": "prompts/get",
  "params": { "name": "code_review", "arguments": { "code": "def hello(): print('world')" } }
}

// Response
{
  "jsonrpc": "2.0", "id": 2,
  "result": {
    "description": "Code review prompt",
    "messages": [{
      "role": "user",
      "content": { "type": "text", "text": "Please review this Python code:\ndef hello():\n    print('world')" }
    }]
  }
}
```

### PromptMessage Content Types

- **Text:** `{ "type": "text", "text": "..." }`
- **Image:** `{ "type": "image", "data": "base64...", "mimeType": "image/png" }`
- **Audio:** `{ "type": "audio", "data": "base64...", "mimeType": "audio/wav" }`
- **Embedded Resource:** `{ "type": "resource", "resource": { "uri": "...", "text": "..." } }`

All support optional annotations for audience, priority, and lastModified.
