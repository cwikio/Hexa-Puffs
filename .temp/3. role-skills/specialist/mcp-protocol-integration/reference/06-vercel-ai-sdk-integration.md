# Vercel AI SDK MCP Integration

## createMCPClient API

```typescript
import { createMCPClient } from "@ai-sdk/mcp";
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `transport` | `MCPTransportConfig \| MCPTransport` | Required. Transport configuration |
| `name` | `string` | Client identifier (default: "ai-sdk-mcp-client") |
| `version` | `string` | Client version (default: "1.0.0") |
| `capabilities` | `ClientCapabilities` | For elicitation: `{ elicitation: {} }` |
| `onUncaughtError` | `(error: unknown) => void` | Error handler |

### Transport Options

```typescript
// Streamable HTTP (recommended for remote servers)
const client = await createMCPClient({
  transport: {
    type: "http",
    url: "https://my-server.com/mcp",
    headers: { Authorization: "Bearer my-api-key" },
  },
});

// SSE (for pre-2025-03-26 servers)
const client = await createMCPClient({
  transport: {
    type: "sse",
    url: "https://my-server.com/sse",
  },
});

// stdio (local servers)
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp";

const client = await createMCPClient({
  transport: new Experimental_StdioMCPTransport({
    command: "node",
    args: ["server.js"],
  }),
});
```

### Return Type (MCPClient)

| Method | Description |
|--------|-------------|
| `tools(options?)` | Get tools in AI SDK format (ready for generateText/streamText) |
| `listResources(options?)` | List available resources |
| `readResource({ uri })` | Read a specific resource |
| `listResourceTemplates()` | List resource URI templates |
| `experimental_listPrompts()` | List available prompts |
| `experimental_getPrompt({ name, arguments? })` | Get a prompt by name |
| `onElicitationRequest(handler)` | Register elicitation handler |
| `close()` | Close connection and clean up |

---

## Using MCP Tools with generateText

```typescript
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createMCPClient } from "@ai-sdk/mcp";

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

  console.log(response.text);
} finally {
  await mcpClient.close();
}
```

---

## Streaming with MCP Tools

```typescript
import { streamText } from "ai";

const result = streamText({
  model: anthropic("claude-sonnet-4-5-20250929"),
  tools: await mcpClient.tools(),
  maxSteps: 5,
  prompt: "Find and summarize recent bug reports",
});

for await (const part of result.textStream) {
  process.stdout.write(part);
}
```

---

## Multi-Server Composition

```typescript
const githubClient = await createMCPClient({
  transport: { type: "http", url: "https://github-mcp.example.com/mcp" },
});
const slackClient = await createMCPClient({
  transport: { type: "http", url: "https://slack-mcp.example.com/mcp" },
});

try {
  const response = await generateText({
    model: anthropic("claude-sonnet-4-5-20250929"),
    tools: {
      ...(await githubClient.tools()),
      ...(await slackClient.tools()),
    },
    maxSteps: 10,
    prompt: "Find critical bugs on GitHub and notify the team on Slack",
  });
} finally {
  await Promise.all([githubClient.close(), slackClient.close()]);
}
```

**Gotcha:** If two servers expose tools with the same name, the last spread wins. Prefix tool names on the server side to avoid collisions.

---

## Next.js API Route Pattern

```typescript
// app/api/chat/route.ts
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createMCPClient } from "@ai-sdk/mcp";

export async function POST(req: Request) {
  const { messages } = await req.json();

  const mcpClient = await createMCPClient({
    transport: { type: "http", url: process.env.MCP_SERVER_URL! },
  });

  try {
    const result = streamText({
      model: anthropic("claude-sonnet-4-5-20250929"),
      tools: await mcpClient.tools(),
      maxSteps: 5,
      messages,
    });

    return result.toDataStreamResponse();
  } finally {
    await mcpClient.close();
  }
}
```

**Gotcha:** Creating an MCP client per request adds latency. For production, consider a singleton pattern with connection pooling or use static tool definitions.

---

## Resources and Prompts

```typescript
// List and read resources
const resources = await mcpClient.listResources();
const content = await mcpClient.readResource({ uri: "file:///project/README.md" });

// List and get prompts
const prompts = await mcpClient.experimental_listPrompts();
const prompt = await mcpClient.experimental_getPrompt({
  name: "code_review",
  arguments: { code: "function foo() {}" },
});
```

---

## Elicitation Handler

```typescript
const client = await createMCPClient({
  transport: { type: "http", url: "https://my-server.com/mcp" },
  capabilities: { elicitation: {} },
});

client.onElicitationRequest(async (request) => {
  // Present form to user, collect response
  return {
    action: "accept",
    content: { name: "User", email: "user@example.com" },
  };
});
```

---

## Production Considerations

### Static Tool Definitions

For production apps where MCP servers are known at build time, consider generating static tool definitions instead of runtime MCP connections:

- Eliminates runtime connection overhead
- Enables build-time type checking
- Removes dependency on MCP server availability

### Error Handling

```typescript
import { MCPClientError } from "@ai-sdk/mcp";

try {
  const client = await createMCPClient({ transport: { type: "http", url } });
} catch (error) {
  if (error instanceof MCPClientError) {
    // Initialization failure, protocol mismatch, connection issue
    console.error("MCP error:", error.message);
  }
}
```

### Auth Provider

```typescript
const client = await createMCPClient({
  transport: {
    type: "http",
    url: "https://my-server.com/mcp",
    authProvider: myOAuthClientProvider, // Handles OAuth 2.1 flow
  },
});
```
