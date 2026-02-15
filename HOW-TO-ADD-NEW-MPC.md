# Annabelle MCP Specification

This document describes everything you need to build an MCP (Model Context Protocol) server that is compatible with the Annabelle ecosystem. Drop your MCP into the monorepo, build it, and the Orchestrator will auto-discover and integrate it.

## Table of Contents

- [Quick Start Checklist](#quick-start-checklist)
- [Project Structure](#project-structure)
- [Auto-Discovery Manifest](#auto-discovery-manifest)
- [Shared Package](#shared-package-mcpshared)
- [Tool Implementation Pattern](#tool-implementation-pattern)
- [StandardResponse Format](#standardresponse-format)
- [Server Setup](#server-setup)
- [Entry Point](#entry-point)
- [TypeScript & Build Configuration](#typescript--build-configuration)
- [Testing](#testing)
- [Environment Variable Overrides](#environment-variable-overrides)
- [Full Walkthrough: Creating a New MCP](#full-walkthrough-creating-a-new-mcp)

---

## Quick Start Checklist

1. Create a directory in the MCPs root (e.g. `MyTool-MCP/`)
2. Add a `package.json` with `"type": "module"` and an `"annabelle"` manifest field
3. Depend on `@mcp/shared` (`"file:../Shared"`) and `@modelcontextprotocol/sdk`
4. Extend `../tsconfig.base.json` in your `tsconfig.json`
5. Define tools as Zod schema + pure handler in `src/tools/`
6. Register tools in `src/server.ts` using `registerTool()` from `@mcp/shared`
7. Wire up stdio transport in `src/index.ts`
8. `npm install && npm run build`
9. Restart the Orchestrator — your MCP is auto-discovered

---

## Project Structure

Every MCP is an independent ESM package in the monorepo root. There is no root `package.json` — each MCP manages its own dependencies.

```
MCPs/                         # Monorepo root
├── Shared/                   # @mcp/shared — common types & utilities
├── Orchestrator/             # Central hub — discovers and manages MCPs
├── MyTool-MCP/               # ← Your new MCP
│   ├── package.json          # Must include "annabelle" manifest
│   ├── tsconfig.json         # Extends ../tsconfig.base.json
│   ├── vitest.config.ts      # Extends ../vitest.base.ts (optional)
│   ├── src/
│   │   ├── index.ts          # Entry point — transport setup
│   │   ├── server.ts         # McpServer creation + tool registration
│   │   └── tools/
│   │       ├── index.ts      # Re-exports all tools
│   │       └── my-tool.ts    # Schema + handler for one tool
│   └── tests/
│       └── integration/
│           └── my-tool.test.ts
├── tsconfig.base.json        # Shared TypeScript config
└── vitest.base.ts            # Shared vitest config
```

**ESM only**: All packages use `"type": "module"`. Never use `require()` — use `import` exclusively. A `require is not defined` error at runtime means an ESM violation.

---

## Auto-Discovery Manifest

The Orchestrator's scanner reads every sibling directory's `package.json` looking for an `"annabelle"` field. If present and valid, the MCP is registered automatically.

### Manifest Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `mcpName` | `string` | **required** | Logical name the Orchestrator uses (e.g. `"filer"`, `"searcher"`). Becomes the tool prefix. |
| `transport` | `"stdio" \| "http"` | `"stdio"` | How the Orchestrator communicates with this MCP. |
| `command` | `string` | `"node"` | The executable used to spawn stdio MCPs. Override for non-Node MCPs (e.g. `".venv/bin/python"`). |
| `commandArgs` | `string[]` | `[]` | Extra arguments prepended before the entry point (e.g. `["-u"]` for unbuffered Python output). |
| `sensitive` | `boolean` | `false` | If `true`, the Guardian security scanner may inspect this MCP's inputs/outputs. |
| `role` | `"guardian" \| "channel"` | — | Special roles. Most MCPs omit this. |
| `timeout` | `number` | `30000` | Default timeout in milliseconds for tool calls. |
| `required` | `boolean` | `false` | If `true`, the Orchestrator will fail to start if this MCP is unavailable. |
| `httpPort` | `number` | — | Required for HTTP MCPs. The port your server listens on. |
| `channel` | `object` | — | Channel-specific config (only for `role: "channel"`). |

### TypeScript Interface

This is the exact type the scanner expects (from `Shared/Discovery/types.ts`):

```typescript
interface AnnabelleManifest {
  mcpName: string;
  transport?: 'stdio' | 'http';
  command?: string;        // default: 'node' — override for non-Node MCPs
  commandArgs?: string[];  // prepended before entryPoint, default: []
  sensitive?: boolean;
  role?: 'guardian' | 'channel';
  timeout?: number;
  required?: boolean;
  httpPort?: number;
  channel?: {
    botPatterns?: string[];
    chatRefreshIntervalMs?: number;
    maxMessageAgeMs?: number;
  };
  // Metadata fields (all optional — omitted fields trigger auto-generated fallbacks)
  label?: string;          // Pretty display name (e.g., "1Password"). Fallback: capitalize(mcpName)
  toolGroup?: string;      // Semantic group tag (e.g., "Communication"). Fallback: same as label
  keywords?: string[];     // Keywords that trigger tool selection in Thinker (e.g., ["email", "inbox"])
  guardianScan?: {         // Per-MCP Guardian scan overrides. Omitted = global defaults (both true)
    input?: boolean;
    output?: boolean;
  };
}
```

### Manifest Metadata

The optional metadata fields enrich three downstream consumers without requiring any hardcoded maps:

| Field | Purpose | Fallback (Tier 3) |
|---|---|---|
| `label` | Pretty name shown in ToolRouter descriptions | `capitalize(mcpName)` |
| `toolGroup` | Semantic group tag (e.g., "Communication", "Security") | Same as `label` |
| `keywords` | Thinker's regex tool selector activates this MCP's tools when these keywords match | No auto-route — only selected via embedding similarity or default groups |
| `guardianScan` | Override whether Guardian scans inputs/outputs for this MCP | Global defaults (`true`/`true`) |

**New MCPs don't need metadata** — the system auto-generates sensible defaults. Add metadata when you want:
- A prettier label than the mcpName (e.g., `"1Password"` instead of `"onepassword"`)
- Keyword-based tool routing in Thinker (e.g., `["password", "vault"]` triggers your tools)
- Custom Guardian scan behavior (e.g., skip scanning for non-sensitive MCPs)

### Example: Stdio MCP

```json
{
  "name": "mytool-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "annabelle": {
    "mcpName": "mytool",
    "transport": "stdio",
    "sensitive": false,
    "label": "My Tool",
    "toolGroup": "Utilities",
    "keywords": ["mytool", "utility"],
    "guardianScan": { "input": true, "output": false }
  }
}
```

### Example: HTTP MCP

> **Note:** All current MCPs use stdio transport. HTTP transport is supported by the scanner but not used by any built-in MCPs. Prefer stdio for new MCPs — it's simpler (no port management) and gets automatic Guardian wrapping.

```json
{
  "name": "mytool-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "annabelle": {
    "mcpName": "mytool",
    "transport": "http",
    "httpPort": 8020,
    "sensitive": false
  }
}
```

### Example: Python MCP (non-Node)

For MCPs written in Python (or any non-Node language), set `command` to the executable path. The entry point (from `"main"`) is appended as the last argument.

```json
{
  "name": "weather-mcp-server",
  "version": "1.0.0",
  "main": "src/main.py",
  "scripts": {
    "build": "uv sync",
    "start": ".venv/bin/python src/main.py",
    "test": ".venv/bin/pytest tests/ -v"
  },
  "annabelle": {
    "mcpName": "weather",
    "command": ".venv/bin/python",
    "sensitive": false
  }
}
```

The Orchestrator will spawn this as `.venv/bin/python src/main.py` instead of `node src/main.py`. The `"build"` script should set up the language-specific environment (e.g. `uv sync` for Python).

### How Discovery Works

1. The scanner reads every subdirectory in the MCPs root
2. Skips directories without a `package.json` or without an `"annabelle"` field
3. Checks the `${MCPNAME}_MCP_ENABLED` env var — if `false`, skips
4. Resolves the entry point from the `"main"` field (defaults to `dist/index.js`)
5. For **stdio** MCPs: the Orchestrator spawns them as child processes via `<command> [...commandArgs] <entryPoint>` (defaults to `node <entryPoint>`)
6. For **HTTP** MCPs: the Orchestrator connects to `http://localhost:<httpPort>`

### Tool Naming

The Orchestrator prefixes all tool names with the MCP's `mcpName` and an underscore. If your MCP is named `"mytool"` and exposes a tool called `"do_thing"`, clients see it as `mytool_do_thing`.

---

## Shared Package (`@mcp/shared`)

The `@mcp/shared` package provides common utilities used across all MCPs. Depend on it via a file reference:

```json
{
  "dependencies": {
    "@mcp/shared": "file:../Shared"
  }
}
```

### What It Provides

| Import Path | What |
|---|---|
| `@mcp/shared/Utils/register-tool.js` | `registerTool()` — tool registration wrapper |
| `@mcp/shared/Types/StandardResponse.js` | `StandardResponse`, `createSuccess()`, `createError()`, `createErrorFromException()` |
| `@mcp/shared/Types/errors.js` | `BaseError`, `ValidationError`, `ConfigurationError`, `DatabaseError`, `NetworkError`, `TimeoutError` |
| `@mcp/shared/Utils/logger.js` | `Logger` class — writes to stderr (keeps stdout clean for JSON-RPC) |
| `@mcp/shared/Utils/config.js` | `getEnvString()`, `getEnvNumber()`, `getEnvBoolean()`, `requireEnvString()`, `expandPath()` |
| `@mcp/shared/Transport/dual-transport.js` | `startTransport()` — shared stdio/HTTP transport layer |

---

## Tool Implementation Pattern

This is the most important section. Every tool follows a three-part pattern:

### Part 1: Tool File (`src/tools/my-tool.ts`)

Define the Zod schema, inferred input type, and a pure handler function. The handler returns data on success and throws on error — it does not deal with MCP formatting.

```typescript
import { z } from "zod";

// 1. Zod schema — this IS the input validation
export const greetSchema = z.object({
  name: z.string().describe("Name to greet"),
  enthusiastic: z.boolean().default(false).describe("Add exclamation marks"),
});

// 2. Inferred input type for type-safe handler
export type GreetInput = z.infer<typeof greetSchema>;

// 3. Pure handler — returns data, throws on error
export async function handleGreet(input: GreetInput): Promise<{ message: string }> {
  const punctuation = input.enthusiastic ? "!!!" : ".";
  return { message: `Hello, ${input.name}${punctuation}` };
}
```

### Part 2: Re-export (`src/tools/index.ts`)

```typescript
export { greetSchema, handleGreet, type GreetInput } from "./my-tool.js";
```

### Part 3: Register in Server (`src/server.ts`)

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTool } from "@mcp/shared/Utils/register-tool.js";
import { createSuccess } from "@mcp/shared/Types/StandardResponse.js";
import { greetSchema, handleGreet, type GreetInput } from "./tools/index.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "mytool",
    version: "1.0.0",
  });

  registerTool(server, {
    name: "greet",
    description: "Generate a greeting message.\n\nArgs:\n  - name (string): Name to greet\n  - enthusiastic (boolean, optional): Add exclamation marks (default: false)\n\nReturns: { message }",
    inputSchema: greetSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleGreet(params as GreetInput);
      return createSuccess(result);
    },
  });

  return server;
}
```

### How `registerTool()` Works

The wrapper (from `Shared/Utils/register-tool.ts`) does three things:

1. Extracts `.shape` from your Zod schema for the SDK's tool registration
2. Wraps your handler to format the return value as MCP content: `{ content: [{ type: 'text', text: JSON.stringify(response) }] }`
3. Catches thrown errors and converts them to a `StandardResponse` error via `createErrorFromException()`

You never need to format MCP content yourself — just return a `StandardResponse` from your handler.

### Annotations

Every tool should declare annotations that describe its behavior:

| Annotation | Meaning |
|---|---|
| `readOnlyHint: true` | This tool does not modify any state |
| `destructiveHint: true` | This tool may delete or overwrite data |
| `idempotentHint: true` | Calling this tool multiple times has the same effect as calling it once |
| `openWorldHint: true` | This tool may interact with external services or the open internet |

---

## StandardResponse Format

All tools return a `StandardResponse`. This is the contract between MCPs and the Orchestrator.

```typescript
interface StandardResponse<T = unknown> {
  success: boolean;
  error?: string;
  errorCode?: string;
  errorDetails?: Record<string, unknown>;
  data?: T;
}
```

### Helper Functions

```typescript
import { createSuccess, createError, createErrorFromException } from "@mcp/shared/Types/StandardResponse.js";

// Success
createSuccess({ count: 5 })
// → { success: true, data: { count: 5 } }

// Error with code
createError("File not found", "NOT_FOUND", { path: "/foo" })
// → { success: false, error: "File not found", errorCode: "NOT_FOUND", errorDetails: { path: "/foo" } }

// From caught exception
try { ... } catch (err) {
  createErrorFromException(err)
  // If err is a BaseError subclass, preserves code + details
  // Otherwise: { success: false, error: err.message }
}
```

### Error Hierarchy

For structured error codes, throw subclasses of `BaseError`:

```typescript
import { ValidationError, DatabaseError, NetworkError, TimeoutError, ConfigurationError } from "@mcp/shared/Types/errors.js";

// These are automatically caught by registerTool and converted to StandardResponse
throw new ValidationError("Invalid email format", { field: "email" });
// → { success: false, error: "Invalid email format", errorCode: "VALIDATION_ERROR", errorDetails: { field: "email" } }
```

| Error Class | Error Code |
|---|---|
| `ConfigurationError` | `CONFIGURATION_ERROR` |
| `ValidationError` | `VALIDATION_ERROR` |
| `DatabaseError` | `DATABASE_ERROR` |
| `NetworkError` | `NETWORK_ERROR` |
| `TimeoutError` | `TIMEOUT_ERROR` |

You can also create custom `BaseError` subclasses with your own error codes.

---

## Server Setup

The `server.ts` file creates an `McpServer` and registers all tools. This file should be a pure function with no side effects.

```typescript
// src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTool } from "@mcp/shared/Utils/register-tool.js";
import { createSuccess } from "@mcp/shared/Types/StandardResponse.js";
import { greetSchema, handleGreet, type GreetInput } from "./tools/index.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "mytool",   // Must match mcpName in package.json annabelle field
    version: "1.0.0",
  });

  registerTool(server, {
    name: "greet",
    description: "...",
    inputSchema: greetSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (params) => {
      const result = await handleGreet(params as GreetInput);
      return createSuccess(result);
    },
  });

  // Register more tools...

  return server;
}
```

---

## Entry Point

The `index.ts` file handles environment loading, initialization, and transport setup.

### Stdio Transport (Default — Recommended)

Most MCPs use stdio. The Orchestrator spawns the process and communicates via stdin/stdout.

```typescript
// src/index.ts
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";

// Load .env BEFORE other imports (env vars are read during module init)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, "../.env");
if (existsSync(envPath)) {
  dotenvConfig({ path: envPath, quiet: true });
}

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { Logger } from "@mcp/shared/Utils/logger.js";

const logger = new Logger("mytool");

async function main() {
  // Any initialization (database, config, etc.) goes here

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("MyTool MCP running on stdio");
}

// Graceful shutdown
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

**Important**: Never write to `stdout` (no `console.log`). The stdio transport uses stdout for JSON-RPC messages. Use `console.error` or the shared `Logger` (which writes to stderr) for all logging.

### HTTP/SSE Transport (Alternative)

If your MCP needs to run as a standalone HTTP server (e.g., it has long-lived connections or serves multiple clients), use the shared transport layer:

```typescript
import { createServer } from "./server.js";
import { startTransport } from "@mcp/shared/Transport/dual-transport.js";

const server = createServer();

await startTransport(server, {
  transport: "sse",
  port: 8020,
  serverName: "mytool-mcp",
  onHealth: () => ({ version: "1.0.0", customStatus: "ready" }),
  onShutdown: () => cleanup(),
});
```

This automatically provides:
- `GET /health` — health check endpoint (returns `{ status: "ok", ...onHealth() }`)
- `GET /sse` — SSE connection for MCP protocol
- `POST /message` — SSE message endpoint

The `TRANSPORT` environment variable controls which mode is used. The Orchestrator sets `TRANSPORT=stdio` when spawning stdio MCPs.

---

## TypeScript & Build Configuration

### `tsconfig.json`

Extend the shared base config:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

The base config (`tsconfig.base.json`) sets:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

### `package.json`

Minimal example with standard scripts:

```json
{
  "name": "mytool-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@mcp/shared": "file:../Shared",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "dotenv": "^17.2.3",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "annabelle": {
    "mcpName": "mytool",
    "transport": "stdio",
    "sensitive": false
  }
}
```

---

## Testing

### vitest Configuration

Extend the shared base:

```typescript
// vitest.config.ts
import { mergeConfig, defineConfig } from "vitest/config";
import baseConfig from "../vitest.base.ts";

export default mergeConfig(baseConfig, defineConfig({
  // Override as needed, e.g. longer timeouts:
  // test: { testTimeout: 60000 }
}));
```

The base config (`vitest.base.ts`) sets:

```typescript
{
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ["verbose"],
    sequence: { shuffle: false },
  }
}
```

### Integration Testing Pattern

Test your MCP end-to-end by spawning it as a child process and using the SDK's `Client`:

```typescript
// tests/helpers/mcp-client.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let client: Client | null = null;
let transport: StdioClientTransport | null = null;

export async function connect(): Promise<Client> {
  if (client) return client;

  transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: { ...process.env, TRANSPORT: "stdio" },
  });

  client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  return client;
}

export async function disconnect(): Promise<void> {
  if (transport) {
    await transport.close();
    transport = null;
    client = null;
  }
}
```

```typescript
// tests/integration/my-tool.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { connect, disconnect } from "../helpers/mcp-client.js";

describe("MyTool MCP", () => {
  let client: Awaited<ReturnType<typeof connect>>;

  beforeAll(async () => {
    client = await connect();
  });

  afterAll(async () => {
    await disconnect();
  });

  it("should list available tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("greet");
  });

  it("should call greet tool", async () => {
    const result = await client.callTool({ name: "greet", arguments: { name: "World" } });
    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.data.message).toBe("Hello, World.");
  });
});
```

**Important**: Always build before running integration tests (`npm run build` first). The test client spawns `dist/index.js`, not the TypeScript source.

---

## Environment Variable Overrides

The Orchestrator supports per-MCP environment overrides using the pattern `${MCPNAME_UPPERCASE}_MCP_${SETTING}`:

| Variable | Purpose | Example |
|---|---|---|
| `${NAME}_MCP_ENABLED` | Enable/disable this MCP | `MYTOOL_MCP_ENABLED=false` |
| `${NAME}_MCP_TIMEOUT` | Override tool call timeout (ms) | `MYTOOL_MCP_TIMEOUT=60000` |
| `${NAME}_MCP_PORT` | Override HTTP port (HTTP MCPs only) | `MYTOOL_MCP_PORT=9020` |
| `${NAME}_MCP_URL` | Override HTTP URL (HTTP MCPs only) | `MYTOOL_MCP_URL=http://remote:8020` |

The name is derived from `mcpName` uppercased. For `"mcpName": "mytool"`, the prefix is `MYTOOL`.

---

## Full Walkthrough: Creating a New MCP

This walks through creating a minimal "hello-world" MCP from scratch.

### Step 1: Create the Directory

```bash
cd /path/to/MCPs
mkdir Hello-MCP
cd Hello-MCP
```

### Step 2: Create `package.json`

```json
{
  "name": "hello-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@mcp/shared": "file:../Shared",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  },
  "annabelle": {
    "mcpName": "hello",
    "transport": "stdio",
    "sensitive": false,
    "label": "Hello",
    "toolGroup": "Greetings",
    "keywords": ["hello", "greet", "greeting"]
  }
}
```

### Step 3: Create `tsconfig.json`

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Step 4: Create the Tool (`src/tools/say-hello.ts`)

```typescript
import { z } from "zod";

export const sayHelloSchema = z.object({
  name: z.string().describe("Who to greet"),
  language: z.enum(["en", "es", "fr"]).default("en").describe("Greeting language"),
});

export type SayHelloInput = z.infer<typeof sayHelloSchema>;

const greetings: Record<string, string> = {
  en: "Hello",
  es: "Hola",
  fr: "Bonjour",
};

export async function handleSayHello(input: SayHelloInput): Promise<{ greeting: string }> {
  const word = greetings[input.language] ?? "Hello";
  return { greeting: `${word}, ${input.name}!` };
}
```

### Step 5: Create Tool Index (`src/tools/index.ts`)

```typescript
export { sayHelloSchema, handleSayHello, type SayHelloInput } from "./say-hello.js";
```

### Step 6: Create the Server (`src/server.ts`)

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTool } from "@mcp/shared/Utils/register-tool.js";
import { createSuccess } from "@mcp/shared/Types/StandardResponse.js";
import { sayHelloSchema, handleSayHello, type SayHelloInput } from "./tools/index.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "hello",
    version: "1.0.0",
  });

  registerTool(server, {
    name: "say_hello",
    description: "Say hello in different languages.\n\nArgs:\n  - name (string): Who to greet\n  - language (string, optional): 'en', 'es', or 'fr' (default: 'en')\n\nReturns: { greeting }",
    inputSchema: sayHelloSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleSayHello(params as SayHelloInput);
      return createSuccess(result);
    },
  });

  return server;
}
```

### Step 7: Create the Entry Point (`src/index.ts`)

```typescript
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Hello MCP running on stdio");
}

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

### Step 8: Build and Test

```bash
npm install
npm run build
```

### Step 9: Integrate

Restart the Orchestrator. It will auto-discover `Hello-MCP`, spawn it via stdio, and expose the tool as `hello_say_hello` to all clients.

---

## Key Gotchas

- **Never write to stdout** in stdio MCPs. Use `console.error` or the shared `Logger`. Stdout is reserved for JSON-RPC.
- **dotenv v17** writes debug messages to stdout even when no `.env` exists. Guard with `existsSync()` before calling `dotenvConfig()`, and pass `quiet: true`.
- **`registerTool` input typing**: The handler receives `Record<string, unknown>`. Cast to your input type: `params as SayHelloInput`.
- **Build before test**: Integration tests spawn `dist/index.js`. Always `npm run build` first.
- **File extensions in imports**: ESM requires `.js` extensions in import paths (e.g., `./server.js`, not `./server`).
- **Python MCPs — venv symlinks**: The venv `python` is a symlink to the system interpreter. Never `resolve()` or dereference the symlink in configs or tests — CPython uses the binary's directory to locate `site-packages`. Resolving the symlink loses the venv prefix.
- **Python MCPs — stdout**: Same as Node — never print to stdout. Use `logging` configured to `stderr`. FastMCP's `mcp.run()` uses stdout for JSON-RPC.
