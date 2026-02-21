# MCP Client Features Reference

**Spec Version:** 2025-11-25

## Sampling

**Capability:** `sampling: {}` (basic) or `sampling: { tools: {} }` (with tool use)

Sampling enables servers to request LLM completions from clients. The client controls model access, selection, and permissions. **Always requires human-in-the-loop.**

### sampling/createMessage

```json
// Request (server -> client)
{
  "jsonrpc": "2.0", "id": 1, "method": "sampling/createMessage",
  "params": {
    "messages": [
      { "role": "user", "content": { "type": "text", "text": "What is the capital of France?" } }
    ],
    "modelPreferences": {
      "hints": [{ "name": "claude-3-sonnet" }, { "name": "claude" }],
      "intelligencePriority": 0.8,
      "speedPriority": 0.5,
      "costPriority": 0.3
    },
    "systemPrompt": "You are a helpful assistant.",
    "maxTokens": 100
  }
}

// Response (client -> server)
{
  "jsonrpc": "2.0", "id": 1,
  "result": {
    "role": "assistant",
    "content": { "type": "text", "text": "The capital of France is Paris." },
    "model": "claude-3-sonnet-20240307",
    "stopReason": "endTurn"
  }
}
```

### Model Preferences

- `hints`: Array of model name substrings (evaluated in order). Advisory only.
- `costPriority`: 0-1, higher = prefer cheaper models
- `speedPriority`: 0-1, higher = prefer faster models
- `intelligencePriority`: 0-1, higher = prefer more capable models

Client makes final model selection. May map hints to equivalent models from different providers.

### Sampling with Tools

Server includes `tools` and `toolChoice` in the request. Client **MUST** declare `sampling.tools` capability.

```json
// Request with tools (server -> client)
{
  "jsonrpc": "2.0", "id": 1, "method": "sampling/createMessage",
  "params": {
    "messages": [
      { "role": "user", "content": { "type": "text", "text": "Weather in Paris and London?" } }
    ],
    "tools": [{
      "name": "get_weather",
      "description": "Get current weather for a city",
      "inputSchema": { "type": "object", "properties": { "city": { "type": "string" } }, "required": ["city"] }
    }],
    "toolChoice": { "mode": "auto" },
    "maxTokens": 1000
  }
}

// Response with tool use (client -> server)
{
  "jsonrpc": "2.0", "id": 1,
  "result": {
    "role": "assistant",
    "content": [
      { "type": "tool_use", "id": "call_abc123", "name": "get_weather", "input": { "city": "Paris" } },
      { "type": "tool_use", "id": "call_def456", "name": "get_weather", "input": { "city": "London" } }
    ],
    "model": "claude-3-sonnet-20240307",
    "stopReason": "toolUse"
  }
}
```

### Multi-Turn Tool Loop

After receiving `stopReason: "toolUse"`:
1. Server executes the tools
2. Server sends new `sampling/createMessage` with history + tool results
3. Client returns LLM response (may contain more tool uses)
4. Repeat until `stopReason: "endTurn"`

**Follow-up request with tool results:**

```json
{
  "jsonrpc": "2.0", "id": 2, "method": "sampling/createMessage",
  "params": {
    "messages": [
      { "role": "user", "content": { "type": "text", "text": "Weather in Paris and London?" } },
      { "role": "assistant", "content": [
        { "type": "tool_use", "id": "call_abc123", "name": "get_weather", "input": { "city": "Paris" } },
        { "type": "tool_use", "id": "call_def456", "name": "get_weather", "input": { "city": "London" } }
      ]},
      { "role": "user", "content": [
        { "type": "tool_result", "toolUseId": "call_abc123", "content": [{ "type": "text", "text": "18C, partly cloudy" }] },
        { "type": "tool_result", "toolUseId": "call_def456", "content": [{ "type": "text", "text": "15C, rainy" }] }
      ]}
    ],
    "tools": [/* same tools */],
    "maxTokens": 1000
  }
}
```

### Message Content Constraints

- Tool result messages **MUST** contain ONLY `tool_result` items (no text, image, audio mixed in)
- Every `tool_use` **MUST** be followed by a matching `tool_result` before any other message
- Tool choice modes: `auto` (default), `required` (must use tool), `none` (must not)

### Error Codes

- `-1`: User rejected sampling request
- `-32602`: Tool result missing or mixed with other content

---

## Elicitation

**Capability:** `elicitation: { form: {}, url: {} }`

Elicitation enables servers to request additional information from users through the client.

### Form Mode

Structured data collection with JSON Schema validation. Data IS exposed to the client.

```json
// Request
{
  "jsonrpc": "2.0", "id": 1, "method": "elicitation/create",
  "params": {
    "mode": "form",
    "message": "Please provide your contact information",
    "requestedSchema": {
      "type": "object",
      "properties": {
        "name": { "type": "string", "description": "Your full name" },
        "email": { "type": "string", "format": "email" },
        "role": { "type": "string", "enum": ["admin", "user", "guest"] }
      },
      "required": ["name", "email"]
    }
  }
}

// Response
{
  "jsonrpc": "2.0", "id": 1,
  "result": {
    "action": "accept",
    "content": { "name": "Monalisa Octocat", "email": "octocat@github.com", "role": "admin" }
  }
}
```

**Supported schema types:** string (with formats: email, uri, date, date-time), number/integer, boolean, enum (single/multi-select via `oneOf` or `anyOf`).

**CRITICAL:** Servers **MUST NOT** request sensitive data (passwords, API keys) via form mode.

### URL Mode (new in 2025-11-25)

Out-of-band interaction via external URL. Data is **NOT** exposed to the client.

```json
// Request
{
  "jsonrpc": "2.0", "id": 3, "method": "elicitation/create",
  "params": {
    "mode": "url",
    "elicitationId": "550e8400-e29b-41d4-a716-446655440000",
    "url": "https://mcp.example.com/ui/set_api_key",
    "message": "Please provide your API key to continue."
  }
}

// Response (consent given, NOT completion — interaction is out-of-band)
{ "jsonrpc": "2.0", "id": 3, "result": { "action": "accept" } }

// Completion notification (optional, sent when interaction finishes)
{
  "jsonrpc": "2.0", "method": "notifications/elicitation/complete",
  "params": { "elicitationId": "550e8400-e29b-41d4-a716-446655440000" }
}
```

### URLElicitationRequiredError

Server returns `-32042` when a request needs elicitation before proceeding:

```json
{
  "jsonrpc": "2.0", "id": 2,
  "error": {
    "code": -32042,
    "message": "Authorization required",
    "data": {
      "elicitations": [{
        "mode": "url",
        "elicitationId": "...",
        "url": "https://mcp.example.com/connect?...",
        "message": "Authorization required to access files."
      }]
    }
  }
}
```

### Response Actions

| Action | Meaning |
|--------|---------|
| `accept` | User approved and submitted (with data for form mode) |
| `decline` | User explicitly rejected |
| `cancel` | User dismissed without choosing (closed dialog, pressed Escape) |

### URL Mode Security

- Servers **MUST NOT** include sensitive info in the URL
- Servers **MUST NOT** provide pre-authenticated URLs
- Clients **MUST NOT** auto-fetch URLs
- Clients **MUST** show full URL and get consent before navigation
- Clients **MUST** open URLs in secure context (e.g., SFSafariViewController, not WKWebView)

### URL Mode for OAuth Flows

MCP server acts as OAuth client to a third-party service:
1. Server generates authorization URL (to `https://mcp.example.com/connect?...`, NOT directly to third-party)
2. Server verifies the user who opens the page matches the elicitation requestor
3. Server redirects to third-party authorization endpoint
4. User completes OAuth flow
5. Third-party redirects back to MCP server
6. Server stores tokens bound to user identity

**CRITICAL:** Third-party credentials **MUST NOT** transit through the MCP client.

---

## Roots

**Capability:** `roots: { listChanged: true }`

Roots define filesystem boundaries for servers. Only `file://` URIs are supported.

### roots/list

```json
// Request (server -> client)
{ "jsonrpc": "2.0", "id": 1, "method": "roots/list" }

// Response
{
  "jsonrpc": "2.0", "id": 1,
  "result": {
    "roots": [
      { "uri": "file:///home/user/projects/myproject", "name": "My Project" },
      { "uri": "file:///home/user/repos/backend", "name": "Backend" }
    ]
  }
}
```

### Root Change Notification

```json
{ "jsonrpc": "2.0", "method": "notifications/roots/list_changed" }
```

**Security:** Clients must validate root URIs (prevent path traversal), implement access controls, and only expose roots with user consent.
