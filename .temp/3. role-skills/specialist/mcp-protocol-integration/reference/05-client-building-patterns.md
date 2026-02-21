# MCP Client Building Patterns

## TypeScript MCP Client

### Basic Client with stdio

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

class MCPClient {
  private client: Client;
  private transport: StdioClientTransport | null = null;

  constructor() {
    this.client = new Client({ name: "my-host", version: "1.0.0" });
  }

  async connect(serverScriptPath: string) {
    const command = serverScriptPath.endsWith(".py") ? "python3" : "node";
    this.transport = new StdioClientTransport({
      command,
      args: [serverScriptPath],
    });
    await this.client.connect(this.transport);

    // List available tools
    const { tools } = await this.client.listTools();
    console.log("Tools:", tools.map(t => t.name));
  }

  async callTool(name: string, args: Record<string, unknown>) {
    const result = await this.client.callTool({ name, arguments: args });
    // result.content is TextContent[], ImageContent[], etc.
    // result.isError indicates tool execution failure
    // result.structuredContent contains typed output when outputSchema defined
    return result;
  }

  async listResources() {
    const { resources } = await this.client.listResources();
    return resources;
  }

  async readResource(uri: string) {
    const { contents } = await this.client.readResource({ uri });
    return contents;
  }

  async getPrompt(name: string, args?: Record<string, string>) {
    const { messages } = await this.client.getPrompt({ name, arguments: args });
    return messages; // Array of { role, content } ready for LLM
  }

  async close() {
    await this.client.close();
  }
}
```

### Streamable HTTP Transport

```typescript
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("https://my-server.com/mcp")
);
const client = new Client({ name: "my-host", version: "1.0.0" });
await client.connect(transport);
```

### Subscribing to Resource Changes

```typescript
await client.subscribe({ uri: "file:///project/config.json" });

client.setNotificationHandler("notifications/resources/updated", async (params) => {
  const { contents } = await client.readResource({ uri: params.uri });
  console.log("Resource updated:", contents);
});
```

### Handling Tool List Changes

```typescript
client.setNotificationHandler("notifications/tools/list_changed", async () => {
  const { tools } = await client.listTools();
  console.log("Tools updated:", tools.map(t => t.name));
});
```

---

## Python MCP Client

```python
import asyncio
from contextlib import AsyncExitStack
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

class MCPClient:
    def __init__(self):
        self.session: ClientSession | None = None
        self.exit_stack = AsyncExitStack()

    async def connect(self, server_script_path: str):
        command = "python3" if server_script_path.endswith(".py") else "node"
        server_params = StdioServerParameters(
            command=command,
            args=[server_script_path],
            env=None
        )
        stdio_transport = await self.exit_stack.enter_async_context(
            stdio_client(server_params)
        )
        self.stdio, self.write = stdio_transport
        self.session = await self.exit_stack.enter_async_context(
            ClientSession(self.stdio, self.write)
        )
        await self.session.initialize()

        response = await self.session.list_tools()
        print("Tools:", [tool.name for tool in response.tools])

    async def call_tool(self, name: str, args: dict):
        result = await self.session.call_tool(name, args)
        return result

    async def cleanup(self):
        await self.exit_stack.aclose()
```

---

## Multi-Server Host Architecture

A host application connects to multiple MCP servers simultaneously:

```typescript
class MCPHost {
  private clients: Map<string, Client> = new Map();

  async addServer(name: string, transport: Transport) {
    const client = new Client({ name: `host-for-${name}`, version: "1.0.0" });
    await client.connect(transport);
    this.clients.set(name, client);
  }

  // Aggregate tools from all servers with namespace prefixing
  async getAllTools() {
    const allTools: Record<string, { client: Client; tool: Tool }> = {};
    for (const [serverName, client] of this.clients) {
      const { tools } = await client.listTools();
      for (const tool of tools) {
        const namespacedName = `${serverName}__${tool.name}`;
        allTools[namespacedName] = { client, tool };
      }
    }
    return allTools;
  }

  // Route tool calls to the correct client
  async callTool(namespacedName: string, args: Record<string, unknown>) {
    const entry = this.allTools[namespacedName];
    if (!entry) throw new Error(`Unknown tool: ${namespacedName}`);
    return entry.client.callTool({
      name: entry.tool.name, // Original name (without namespace prefix)
      arguments: args,
    });
  }

  async closeAll() {
    await Promise.all(
      Array.from(this.clients.values()).map(c => c.close())
    );
  }
}
```

**Key principles:**
- Each `Client` instance maintains a 1:1 stateful session with one server
- Namespace tool names to avoid collisions across servers
- The host controls security boundaries — servers are isolated from each other
- Host decides what context flows between servers

---

## Reconnection Patterns

### Streamable HTTP

```typescript
// Session expiry detection
try {
  const result = await client.callTool({ name: "...", arguments: {} });
} catch (error) {
  if (error.status === 404) {
    // Session expired — re-initialize
    await client.close();
    await client.connect(transport); // Triggers new initialize handshake
  }
}
```

### stdio Process Crash

```typescript
transport.onclose = async () => {
  console.warn("Server process died, restarting...");
  const newTransport = new StdioClientTransport({
    command: "node",
    args: ["server.js"],
  });
  await client.connect(newTransport);
};
```

---

## Error Handling

### Protocol vs Tool Errors

```typescript
try {
  const result = await client.callTool({ name: "search", arguments: { q: "test" } });

  if (result.isError) {
    // Tool execution error — LLM can self-correct
    // result.content contains actionable error message
    console.log("Tool error:", result.content);
  } else {
    // Success
    console.log("Result:", result.content);
  }
} catch (error) {
  // Protocol error — unknown tool, malformed request, server error
  console.error("Protocol error:", error);
}
```

### Timeout with Cancellation

```typescript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30000);

try {
  const result = await client.callTool(
    { name: "slow_operation", arguments: {} },
    { signal: controller.signal }
  );
} catch (error) {
  if (error.name === "AbortError") {
    // Send cancellation notification
    await client.notification({
      method: "notifications/cancelled",
      params: { requestId: requestId, reason: "Timeout" }
    });
  }
} finally {
  clearTimeout(timeout);
}
```
