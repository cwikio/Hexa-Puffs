# MCP Lifecycle & Transports Reference

**Spec Version:** 2025-11-25

## Lifecycle Phases

### 1. Initialization

The initialization phase **MUST** be the first interaction. The client sends an `initialize` request, the server responds, and the client sends `initialized`.

**Client `initialize` request:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": {
      "roots": { "listChanged": true },
      "sampling": {},
      "elicitation": { "form": {}, "url": {} },
      "tasks": {
        "requests": {
          "elicitation": { "create": {} },
          "sampling": { "createMessage": {} }
        }
      }
    },
    "clientInfo": {
      "name": "ExampleClient",
      "version": "1.0.0"
    }
  }
}
```

**Server response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-11-25",
    "capabilities": {
      "logging": {},
      "prompts": { "listChanged": true },
      "resources": { "subscribe": true, "listChanged": true },
      "tools": { "listChanged": true },
      "tasks": {
        "list": {},
        "cancel": {},
        "requests": { "tools": { "call": {} } }
      }
    },
    "serverInfo": {
      "name": "ExampleServer",
      "version": "1.0.0"
    },
    "instructions": "Optional instructions for the LLM"
  }
}
```

**Client `initialized` notification:**

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized"
}
```

### Version Negotiation

- Client sends the latest protocol version it supports
- If server supports it, it responds with the same version
- Otherwise, server responds with its latest supported version
- If client doesn't support the server's version, it **SHOULD** disconnect

### Capability Negotiation

| Category | Capability | Description |
|----------|-----------|-------------|
| Client | `roots` | Provides filesystem roots |
| Client | `sampling` | Supports LLM sampling requests |
| Client | `elicitation` | Supports server elicitation requests |
| Client | `tasks` | Supports task-augmented client requests |
| Server | `prompts` | Offers prompt templates |
| Server | `resources` | Provides readable resources |
| Server | `tools` | Exposes callable tools |
| Server | `logging` | Emits structured log messages |
| Server | `completions` | Supports argument autocompletion |
| Server | `tasks` | Supports task-augmented server requests |

Sub-capabilities:
- `listChanged`: Server will notify when lists change (prompts, resources, tools)
- `subscribe`: Client can subscribe to individual resource changes

### 2. Operation

Both parties **MUST** respect the negotiated protocol version and only use successfully negotiated capabilities.

### 3. Shutdown

**stdio:** Client closes stdin, waits for server exit, sends SIGTERM then SIGKILL.

**HTTP:** Close the associated HTTP connections. Client **SHOULD** send HTTP DELETE to the MCP endpoint with `MCP-Session-Id` header.

### Timeouts

- Implementations **SHOULD** set timeouts for all sent requests
- Send `notifications/cancelled` after timeout
- SDKs **SHOULD** allow per-request timeout configuration
- Progress notifications **MAY** reset the timeout clock

---

## Transports

All MCP messages are JSON-RPC 2.0, UTF-8 encoded.

### stdio

- Client launches server as a subprocess
- Server reads JSON-RPC from stdin, writes to stdout
- Messages delimited by newlines, **MUST NOT** contain embedded newlines
- Server **MAY** write to stderr for logging
- Server **MUST NOT** write non-MCP content to stdout

### Streamable HTTP

Replaces the deprecated HTTP+SSE transport from 2024-11-05.

**Architecture:** Server provides a single MCP endpoint (e.g., `https://example.com/mcp`) supporting both POST and GET.

#### Sending Messages (Client -> Server)

- Client **MUST** POST JSON-RPC messages to the MCP endpoint
- Client **MUST** include `Accept: application/json, text/event-stream`
- Body is a single JSON-RPC request, notification, or response
- Notifications/responses: server returns `202 Accepted` (no body)
- Requests: server returns either `application/json` or `text/event-stream`

#### SSE Stream Behavior

When server initiates an SSE stream in response to a POST:
- Server **SHOULD** immediately send an event with an ID and empty data (for resumability)
- Server **MAY** close the connection without terminating the stream
- Server **SHOULD** send a `retry` field before closing
- Stream **SHOULD** eventually include the JSON-RPC response
- Server **MAY** send requests/notifications before the response
- After sending the response, server **SHOULD** terminate the stream

#### Listening for Server Messages (GET)

- Client **MAY** issue HTTP GET to the MCP endpoint for server-initiated SSE
- Server returns `text/event-stream` or `405 Method Not Allowed`
- Server **MAY** send JSON-RPC requests and notifications
- Server **MUST NOT** send responses on GET streams (unless resuming)

#### Session Management

- Server **MAY** assign a session ID via `MCP-Session-Id` response header on initialize
- Client **MUST** include `MCP-Session-Id` on all subsequent requests
- Server **MAY** terminate sessions; returns `404 Not Found` for expired sessions
- Client **MUST** re-initialize when receiving 404 with a session ID

#### Protocol Version Header

- Client **MUST** include `MCP-Protocol-Version: 2025-11-25` on all HTTP requests after initialization
- If header is missing, server **SHOULD** assume `2025-03-26`
- Invalid/unsupported version: server **MUST** return `400 Bad Request`

#### Resumability

- Servers **MAY** attach `id` fields to SSE events (must be globally unique within session)
- Client resumes via GET with `Last-Event-ID` header
- Server replays missed messages from the disconnected stream only

#### Security

- Servers **MUST** validate `Origin` header (return 403 if invalid)
- Servers **SHOULD** bind to localhost (127.0.0.1) when running locally
- Servers **SHOULD** implement authentication

#### Backwards Compatibility (with 2024-11-05 HTTP+SSE)

**Clients** wanting to support older servers:
1. POST `InitializeRequest` to server URL
2. If succeeds: new Streamable HTTP transport
3. If 400/404/405: try GET to server URL expecting SSE stream with `endpoint` event (old transport)

---

## Authorization (OAuth 2.1)

Authorization is **OPTIONAL**. When supported on HTTP transports:

- Based on OAuth 2.1, RFC8414, RFC7591, RFC9728
- MCP server acts as OAuth resource server
- MCP client acts as OAuth client

### Discovery Flow

1. Client makes unauthenticated request
2. Server returns `401 Unauthorized` with `WWW-Authenticate: Bearer resource_metadata="..."`
3. Client fetches Protected Resource Metadata (RFC9728)
4. Client discovers authorization server from metadata
5. Client fetches Authorization Server Metadata (RFC8414 or OpenID Connect)
6. Client performs OAuth 2.1 authorization flow with PKCE

### Client Registration

Priority order:
1. Pre-registered credentials
2. Client ID Metadata Documents (HTTPS URL as client_id)
3. Dynamic Client Registration (RFC7591)

### Token Usage

- Client **MUST** use `Authorization: Bearer <token>` header
- Token **MUST** be included in every HTTP request
- Tokens **MUST NOT** be in URI query strings
- Server **MUST** validate tokens are issued specifically for it

### Scope Management

- Server includes `scope` in `WWW-Authenticate` header
- Client requests scopes from WWW-Authenticate or `scopes_supported` in metadata
- `403 Forbidden` with `error="insufficient_scope"` triggers step-up authorization
