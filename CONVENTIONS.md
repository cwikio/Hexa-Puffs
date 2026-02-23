# Hexa Puffs Conventions

Implicit patterns and conventions used across the monorepo. Read this before contributing.

## Module System

- **ESM-only** — All packages use `"type": "module"` in `package.json`
- **NodeNext resolution** — `"module": "NodeNext"`, `"moduleResolution": "NodeNext"` in tsconfig
- **`.js` extensions required** in all import paths (TypeScript compiles `.ts` → `.js`, imports must match output):

```typescript
// Correct
import { registerTool } from "@mcp/shared/Utils/register-tool.js";
import { createServer } from "./server.js";

// Wrong — will fail at runtime
import { registerTool } from "@mcp/shared/Utils/register-tool";
```

## TypeScript Configuration

Every package extends the shared base config:

```
tsconfig.base.json          ← Root (ES2022, NodeNext, strict, declarations)
├── Filer-MCP/tsconfig.json ← extends, adds outDir/rootDir
├── Guardian/tsconfig.json  ← extends, adds outDir/rootDir
├── Thinker/tsconfig.json   ← extends, adds outDir/rootDir
└── Shared/tsconfig.json    ← extends, adds stricter rules (noUnusedLocals, etc.)
```

Package-level tsconfig always follows this pattern:

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

## MCP Tool Pattern

Every tool in every MCP follows this three-part pattern:

### 1. Zod schema (input validation)

```typescript
export const readFileSchema = z.object({
  path: z.string().describe("Relative workspace path or absolute granted path"),
});
export type ReadFileInput = z.infer<typeof readFileSchema>;
```

### 2. Handler function (business logic)

```typescript
export async function handleReadFile(input: ReadFileInput): Promise<ReadFileData> {
  // Pure business logic — no MCP protocol concerns
}
```

### 3. Tool registration

```typescript
import { registerTool } from "@mcp/shared/Utils/register-tool.js";
import { createSuccess } from "@mcp/shared/Types/StandardResponse.js";

registerTool(server, {
  name: "read_file",
  description: "Read a file's contents",
  inputSchema: readFileSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async (params) => {
    const result = await handleReadFile(params);
    return createSuccess(result);
  },
});
```

## StandardResponse

All tool handlers return `StandardResponse<T>`:

```typescript
interface StandardResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
  errorDetails?: Record<string, unknown>;
}
```

Use the factory functions from `@mcp/shared/Types/StandardResponse.js`:
- `createSuccess(data)` — success response
- `createError(message)` — error response
- `createErrorFromException(error)` — error from caught exception

## Shared Package Imports

The `@mcp/shared` package uses a wildcard subpath export (`"./*": "./dist/*"`). Import individual modules directly:

```typescript
import { registerTool } from "@mcp/shared/Utils/register-tool.js";
import { createSuccess, createError } from "@mcp/shared/Types/StandardResponse.js";
import { Logger } from "@mcp/shared/Utils/logger.js";
import { loadEnvSafely } from "@mcp/shared/Utils/env.js";
import { startTransport } from "@mcp/shared/Transport/dual-transport.js";
```

## Environment Loading

Every MCP entry point calls `loadEnvSafely()` as the first import side-effect. This loads `.env` from the package root without corrupting stdout (critical for stdio MCPs):

```typescript
import { loadEnvSafely } from "@mcp/shared/Utils/env.js";
loadEnvSafely(import.meta.url);

// ... rest of imports and code
```

## Logging

- **All output goes to `stderr`** — stdout must stay clean for MCP JSON-RPC (stdio transport)
- Use `Logger` from `@mcp/shared/Utils/logger.js`
- `LOG_LEVEL` env var controls verbosity: `debug`, `info`, `warn`, `error`
- Structured logs (audit, traces) use JSONL format

## Naming Conventions

| Thing | Convention | Example |
|-------|-----------|---------|
| Package directory | PascalCase or PascalCase-MCP | `Filer-MCP`, `Guardian`, `Thinker` |
| package.json `name` | kebab-case | `filer-mcp-server`, `guardian-mcp-server` |
| `hexa-puffs.mcpName` | lowercase | `filer`, `guardian`, `memory` |
| TypeScript files | kebab-case | `register-tool.ts`, `dual-transport.ts` |
| Test files | `*.test.ts` | `filer.test.ts`, `cost-monitor.test.ts` |
| Environment variables | `UPPER_SNAKE_CASE` | `GROQ_API_KEY`, `LOG_LEVEL` |
| Tool names | `snake_case` | `read_file`, `store_fact`, `web_search` |

## Test Configuration

Every package with tests extends the shared vitest base config:

```typescript
// vitest.config.ts in each package
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../vitest.base.js";

export default mergeConfig(baseConfig, defineConfig({
  test: {
    // Package-specific overrides
  },
}));
```

Base config (`vitest.base.ts`):
- `globals: true` — no need to import `describe`, `it`, `expect`
- `environment: "node"`
- `include: ["tests/**/*.test.ts"]`
- `testTimeout: 30000` and `hookTimeout: 30000`
- `reporters: ["verbose"]`

## Test Structure

```
tests/
  fixtures/          # Test data, mock files
  helpers/           # Shared utilities (e.g., MCPTestClient)
  integration/       # Integration tests (real HTTP, real MCP)
  unit/              # Unit tests (isolated, mocked)
```

Conventions:
- Tests **skip gracefully** when required MCPs are unavailable (not fail)
- Tests clean up their own resources in `afterAll()` blocks
- Use `MCPTestClient` from `@mcp/shared/Testing` for MCP integration tests

## Auto-Discovery Manifest

Every MCP that should be auto-discovered by the Orchestrator needs a `hexa-puffs` field in `package.json`:

```json
{
  "hexa-puffs": {
    "mcpName": "filer",
    "sensitive": true,
    "label": "Workspace Files",
    "toolGroup": "File Management",
    "keywords": ["file", "document", "save", "workspace"],
    "guardianScan": { "input": true, "output": true }
  }
}
```

Only `mcpName` is required. All other fields have sensible defaults. See [Orchestrator README](Orchestrator/README.md) for the full manifest field reference.

## Build Order

**Shared must build first** — all other packages depend on it.

```bash
# Manual
cd Shared && npm run build

# Automatic (handles order)
./rebuild.sh
```

## Directory Conventions

| Path | Purpose |
|------|---------|
| `~/.hexa-puffs/data/` | Databases, caches, embedding indexes |
| `~/.hexa-puffs/logs/` | Log files (traces, audit) |
| `~/.hexa-puffs/sessions/` | Thinker conversation sessions |
| `~/.hexa-puffs/agents/` | Agent persona files |
| `~/.hexa-puffs/skills/` | Skill definitions |
| `~/.hexa-puffs/memory-export/` | Memory transparency exports |
