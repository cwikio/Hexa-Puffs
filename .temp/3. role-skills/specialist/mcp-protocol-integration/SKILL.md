---
name: mcp-protocol-integration
description: >
  MCP protocol reference and integration patterns for building clients/hosts,
  understanding protocol lifecycle, transports, and all server/client features.
  Use when asked about "building an MCP client", "connecting to MCP servers",
  "MCP protocol spec", "MCP lifecycle", "MCP transports", "Streamable HTTP",
  "MCP sampling", "MCP elicitation", "MCP tasks", "composing MCP servers",
  "Vercel AI SDK MCP", or "MCP authorization". This skill covers the protocol
  and client side. For building MCP servers, use mcp-builder instead.
---

# MCP Protocol & Integration Guide

## Overview

Reference for the Model Context Protocol (MCP) specification (2025-11-25) and patterns for building MCP clients, integrating with the Vercel AI SDK, and composing multi-server architectures. Complements the existing `mcp-builder` skills which cover server implementation.

---

## Quick Reference

| Task | Approach |
|------|----------|
| Build a TypeScript MCP client | `Client` from `@modelcontextprotocol/sdk` + `StdioClientTransport` or `StreamableHTTPClientTransport` |
| Connect from Vercel AI SDK | `createMCPClient()` from `@ai-sdk/mcp` with `{ type: "http" }` transport |
| Use MCP tools in generateText | `const tools = await mcpClient.tools()` then `generateText({ tools })` |
| Connect to multiple servers | Create separate `Client` instances per server, aggregate tools in host |
| Handle initialization | `client.connect(transport)` -> server returns capabilities -> `initialized` notification |
| Check capabilities | Inspect `result.capabilities` from `initialize` response for tools/resources/prompts/sampling |
| Implement sampling | Declare `sampling` capability, handle `sampling/createMessage` requests from server |
| Implement elicitation | Declare `elicitation` capability, handle `elicitation/create` (form or URL mode) |
| Handle long-running ops | Use task-augmented requests with `task: { ttl }`, poll via `tasks/get` |
| Choose transport | Streamable HTTP for remote/multi-client; stdio for local/subprocess |
| Build an MCP server | Use the `mcp-builder` skill (Anthropic or Composio) instead |

---

## Key Guidelines

**CRITICAL: Always negotiate capabilities before using features.**
Calling `tools/list`, `sampling/createMessage`, or `elicitation/create` without confirming the other side declared the capability will fail with protocol errors.

**CRITICAL: Streamable HTTP is the primary remote transport (2025-11-25).**
The old HTTP+SSE transport from 2024-11-05 is deprecated. Use Streamable HTTP for new implementations. For backwards compatibility, POST first, fall back to GET for SSE endpoint.

**CRITICAL: Human-in-the-loop for tool calls and sampling.**
Always present tool invocations and sampling requests to the user for approval. Show tool inputs to prevent data exfiltration.

- Always include `MCP-Protocol-Version` header on all HTTP requests after initialization
- Always include `MCP-Session-Id` header on all requests after receiving one
- Validate `Origin` headers on Streamable HTTP servers to prevent DNS rebinding
- Each client maintains 1:1 relationship with a server — never share clients
- Treat tool annotations (`readOnlyHint`, `destructiveHint`) as untrusted hints
- For sampling, the client controls model selection — server provides hints, not commands
- Set request timeouts and implement cancellation for hanging requests

---

## Core Operations

### 1. Building an MCP Client (TypeScript)

**When to use:** Building a host application or agent that connects to MCP servers.

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["path/to/server.js"],
});

const client = new Client({ name: "my-host", version: "1.0.0" });
await client.connect(transport);

// Discover and call tools
const { tools } = await client.listTools();
const result = await client.callTool({
  name: "get_weather",
  arguments: { city: "NYC" },
});
// result.content: TextContent[] | ImageContent[] | ...
// result.isError: boolean
// result.structuredContent: typed output when outputSchema defined

await client.close();
```

**Streamable HTTP transport:**

```typescript
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("https://my-server.com/mcp")
);
```

**Gotchas:**
- StdioClientTransport spawns a subprocess — server lifecycle is tied to the client
- Streamable HTTP handles session management automatically via `MCP-Session-Id`
- Always call `client.close()` for clean shutdown

Reference: [Client Building Patterns](./reference/05-client-building-patterns.md) for Python client, multi-server host, reconnection patterns.

### 2. Lifecycle & Capability Negotiation

**When to use:** Understanding what happens on connect, or debugging connection issues.

Three phases: **Initialize** -> **Operate** -> **Shutdown**

1. Client sends `initialize` with `protocolVersion`, `capabilities`, `clientInfo`
2. Server responds with its `protocolVersion`, `capabilities`, `serverInfo`, `instructions`
3. Client sends `notifications/initialized`

| Side | Capability | What it unlocks |
|------|-----------|-----------------|
| Client | `roots` | Server can request filesystem roots |
| Client | `sampling` | Server can request LLM completions |
| Client | `elicitation` | Server can request user input |
| Client | `tasks` | Server can use task-augmented client requests |
| Server | `tools` | Client can list and call tools |
| Server | `resources` | Client can list, read, subscribe to resources |
| Server | `prompts` | Client can list and get prompt templates |
| Server | `logging` | Server emits structured log messages |
| Server | `completions` | Server supports argument autocomplete |
| Server | `tasks` | Client can use task-augmented server requests |

**Gotchas:**
- If protocol versions don't match, server responds with its version; client disconnects if incompatible
- `listChanged: true` means the server will notify when tool/resource/prompt lists change
- The `instructions` field is for the LLM, not the human user

Reference: [Lifecycle & Transports](./reference/01-spec-lifecycle-and-transports.md) for full message schemas, version negotiation rules.

### 3. Working with Server Features (Client Side)

**When to use:** Consuming tools, resources, and prompts from a connected server.

**Tools:**

```typescript
const { tools } = await client.listTools();
const result = await client.callTool({
  name: "search_issues",
  arguments: { query: "bug", state: "open" },
});
// result.content — array of TextContent, ImageContent, AudioContent, ResourceLink, EmbeddedResource
// result.isError — tool execution failure (not protocol error)
// result.structuredContent — typed output when outputSchema defined
```

**Resources:**

```typescript
const { resources } = await client.listResources();
const { contents } = await client.readResource({ uri: "file:///project/README.md" });

// Subscribe to changes
await client.subscribe({ uri: "file:///project/config.json" });
client.setNotificationHandler("notifications/resources/updated", async (params) => {
  const updated = await client.readResource({ uri: params.uri });
});
```

**Prompts:**

```typescript
const { prompts } = await client.listPrompts();
const { messages } = await client.getPrompt({
  name: "code_review",
  arguments: { code: "function foo() {}" },
});
// messages: Array<{ role: "user" | "assistant", content: Content }>
```

Reference: [Server Features](./reference/02-spec-server-features.md) for complete schemas, content types, annotations.

### 4. Implementing Client Features

**When to use:** Your client needs to handle sampling (server asks for LLM completion), elicitation (server asks for user input), or roots.

**Sampling** — the most important client feature:

When a server sends `sampling/createMessage`, your client must:
1. Present the request to the user for approval
2. Forward approved request to the LLM
3. Present the LLM response to the user for review
4. Return the approved response to the server

If `stopReason: "toolUse"` — server executes the tools and sends a follow-up `createMessage` with tool results. This loop continues until `stopReason: "endTurn"`.

**Elicitation** (new in 2025-11-25):

- **Form mode:** Server sends JSON Schema, client renders a form, user fills it out. Servers **MUST NOT** request sensitive data via form mode.
- **URL mode:** Server sends a URL for out-of-band interaction (OAuth, API keys, payments). Client opens in secure browser context.

**Roots:**

```typescript
client.setRequestHandler("roots/list", async () => ({
  roots: [
    { uri: "file:///Users/dev/myproject", name: "My Project" },
  ],
}));
```

Reference: [Client Features](./reference/03-spec-client-features.md) for sampling with tools, multi-turn loop, URL mode OAuth patterns.

### 5. Tasks & Async Operations (new in 2025-11-25)

**When to use:** Long-running tool calls, batch processing, or any operation needing more time than a synchronous request allows.

```typescript
// Send tool call with task augmentation
const createResult = await client.callTool({
  name: "process_batch",
  arguments: { data: largeDataset },
  task: { ttl: 300000 }, // 5 minute TTL
});
// createResult.task: { taskId, status: "working", pollInterval }

// Poll for completion
let task = await client.getTask({ taskId: createResult.task.taskId });
while (task.status === "working" || task.status === "input_required") {
  await sleep(task.pollInterval || 5000);
  task = await client.getTask({ taskId: createResult.task.taskId });
}

// Retrieve actual result
const result = await client.getTaskResult({ taskId: task.taskId });
```

**Status lifecycle:** `working` -> `input_required` | `completed` | `failed` | `cancelled`

**Tool-level negotiation:** Tools declare `execution.taskSupport` as `"required"`, `"optional"`, or `"forbidden"`.

Reference: [Utilities](./reference/04-spec-utilities.md) for task cancellation, progress notifications, logging, completion/autocomplete.

### 6. Vercel AI SDK Integration

**When to use:** Using MCP servers from Next.js or any TypeScript project with the Vercel AI SDK.

```typescript
import { createMCPClient } from "@ai-sdk/mcp";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const mcpClient = await createMCPClient({
  transport: { type: "http", url: "https://my-server.com/mcp" },
});

try {
  const response = await generateText({
    model: anthropic("claude-sonnet-4-5-20250929"),
    tools: await mcpClient.tools(),
    maxSteps: 5,
    prompt: "Search for open issues about performance",
  });
} finally {
  await mcpClient.close();
}
```

**Multi-server composition:**

```typescript
const github = await createMCPClient({ transport: { type: "http", url: githubUrl } });
const slack = await createMCPClient({ transport: { type: "http", url: slackUrl } });

const response = await generateText({
  model: anthropic("claude-sonnet-4-5-20250929"),
  tools: { ...(await github.tools()), ...(await slack.tools()) },
  maxSteps: 10,
  prompt: "Find critical bugs and notify the team on Slack",
});

await Promise.all([github.close(), slack.close()]);
```

**Gotchas:**
- Use `type: "http"` for Streamable HTTP; `type: "sse"` only for pre-2025-03-26 servers
- `mcpClient.tools()` returns tools in AI SDK format — no manual conversion needed
- If two servers share a tool name, the last spread wins — prefix names on server side

Reference: [Vercel AI SDK Integration](./reference/06-vercel-ai-sdk-integration.md) for streaming, resources, prompts, Next.js patterns, production considerations.

---

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|---------|
| `initialize` fails with version mismatch | Incompatible protocol versions | Check `data.supported` in error; update SDK |
| Tools not appearing after connect | Server doesn't declare `tools` capability | Check `capabilities` in initialize response |
| Sampling request rejected | Client missing `sampling` capability | Add `sampling: {}` to client capabilities |
| `404 Not Found` on HTTP requests | Session expired or server restarted | Re-initialize without session ID |
| `403 Forbidden` on POST | Missing/invalid `Origin` header | Ensure correct `Origin`; server validates for DNS rebinding |
| Tool call hangs indefinitely | No timeout set | Set timeouts; send `notifications/cancelled` |
| SSE stream drops mid-response | Network interruption | Resume with `Last-Event-ID` header |
| `MCP-Session-Id` missing errors | Client forgot session header | Store ID from init response; include on all requests |
| Elicitation request fails | Client missing `elicitation` capability | Add `elicitation: { form: {}, url: {} }` |
| Task stuck in `working` | Long processing, no progress | Check `pollInterval`; consider `tasks/cancel` |
| `400 Bad Request` on HTTP | Missing `MCP-Protocol-Version` header | Include `MCP-Protocol-Version: 2025-11-25` on all requests |

---

## Anti-Patterns

**Ignoring capability negotiation**
Calling `tools/list` or `sampling/createMessage` without checking if the other side declared the capability. Results in silent failures or `-32601` errors.
Fix: Always check capabilities from the initialize response before using optional features.

**Using deprecated SSE transport for new servers**
Building new servers with the 2024-11-05 HTTP+SSE transport (two endpoints). It doesn't support server-to-client requests without a persistent SSE connection.
Fix: Use Streamable HTTP (single endpoint, POST + GET, built-in session management).

**Sharing a client across multiple servers**
Using one `Client` instance for multiple MCP servers. MCP clients maintain a 1:1 stateful session.
Fix: Create a separate `Client` per server. The host aggregates capabilities across clients.

**Skipping human-in-the-loop for tool calls**
Auto-executing all tool calls without confirmation. Malicious servers could trigger destructive operations or exfiltrate data.
Fix: Present tool inputs to the user before execution. Always show what data is being sent.

**Trusting server tool annotations**
Using `readOnlyHint`, `destructiveHint` from untrusted servers to skip confirmation dialogs.
Fix: Treat annotations as untrusted hints unless from verified servers. Always confirm destructive operations.

**Passing full conversation to MCP servers**
Sending entire conversation history via sampling or tool calls. Violates MCP's isolation principle.
Fix: Servers receive only explicitly provided context. The host controls information boundaries.

---

## Integration with Other Skills

- **mcp-builder** (Anthropic/Composio) — For building MCP servers in Python/TypeScript. This skill covers the protocol and client side.
- **building-mcp-server-on-cloudflare** — For deploying MCP servers to Cloudflare Workers. This skill covers how clients connect to those servers.
- **ai-feature-implementation** — For Vercel AI SDK patterns (streamText, generateText, useChat) that MCP tools integrate into.
- **api-integration-guide** — For API route patterns used when hosting MCP servers in Next.js routes.

---

## Reference Files

Load these as needed during implementation:

### MCP Protocol Specification (2025-11-25)
- [Lifecycle & Transports](./reference/01-spec-lifecycle-and-transports.md) — Initialization handshake, capability negotiation, Streamable HTTP mechanics, stdio format, session management, OAuth 2.1 authorization
- [Server Features](./reference/02-spec-server-features.md) — Tools (structured output, outputSchema, annotations), Resources (templates, subscriptions, URIs), Prompts (arguments, content types)
- [Client Features](./reference/03-spec-client-features.md) — Sampling (createMessage, model preferences, tool use, multi-turn loop), Elicitation (form + URL mode, OAuth flows), Roots
- [Utilities](./reference/04-spec-utilities.md) — Tasks (state machine, polling, TTL), Progress, Cancellation, Pagination, Logging, Completion

### Implementation Patterns
- [Client Building Patterns](./reference/05-client-building-patterns.md) — TypeScript and Python clients, multi-server host architecture, reconnection patterns, error handling
- [Vercel AI SDK Integration](./reference/06-vercel-ai-sdk-integration.md) — createMCPClient API, generateText/streamText with MCP tools, multi-server composition, Next.js patterns
