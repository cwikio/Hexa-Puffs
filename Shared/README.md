# @mcp/shared

Shared types, utilities, and abstractions used across all Annabelle MCP packages.

## Installation

All MCP packages reference this as a workspace dependency via `@mcp/shared`. Import using subpath exports:

```typescript
import { StandardResponse, createSuccess, createError } from '@mcp/shared/Types/StandardResponse.js';
import { Logger } from '@mcp/shared/Utils/logger.js';
import { registerTool } from '@mcp/shared/Utils/register-tool.js';
import { createEmbeddingProvider, cosineSimilarity } from '@mcp/shared/Embeddings/index.js';
```

## Modules

### Types

Standard types used across all MCPs.

| File | Description |
|---|---|
| `StandardResponse.ts` | `StandardResponse<T>` interface, `createSuccess()`, `createError()`, `createErrorFromException()` — canonical response format for all MCP tools |
| `errors.ts` | `BaseError` class with `code` and `details` fields for structured error propagation |
| `tools.ts` | Shared tool-related type definitions |

### Utils

Reusable utilities for MCP services.

| File | Description |
|---|---|
| `register-tool.ts` | Generic `registerTool<T>()` wrapper for `McpServer` — handlers receive Zod-inferred types, returns are auto-formatted as MCP content with error wrapping |
| `logger.ts` | `Logger` class — all output goes to `stderr` to keep `stdout` clean for MCP JSON-RPC. Supports `debug`/`info`/`warn`/`error` levels via `LOG_LEVEL` env var |
| `config.ts` | `expandPath()` (tilde expansion), `getEnvString()`, `getEnvNumber()`, `getEnvBool()` — environment config helpers |

### Embeddings

Embedding provider abstraction used by both Memorizer (vector search) and Thinker (tool selection).

| File | Description |
|---|---|
| `provider.ts` | `EmbeddingProvider` interface (`embed()`, `embedBatch()`) and `BaseEmbeddingProvider` abstract class |
| `config.ts` | `EmbeddingConfigSchema` (Zod) — validates `provider`, `model`, `baseUrl`, `dimensions` |
| `math.ts` | `cosineSimilarity()` — computes similarity between two `Float32Array` vectors |
| `ollama-provider.ts` | Ollama embedding provider (HTTP API to local Ollama instance) |
| `huggingface-provider.ts` | HuggingFace embedding provider |
| `index.ts` | `createEmbeddingProvider()` factory — built-in `ollama`/`huggingface`/`none`, extensible via `extraProviders` for custom backends (e.g. LM Studio) |

### Discovery

MCP auto-discovery system used by Orchestrator to find sibling MCP packages at startup.

| File | Description |
|---|---|
| `scanner.ts` | `scanForMCPs()` — reads sibling directories, extracts `"annabelle"` field from `package.json` |
| `types.ts` | `AnnabelleManifest`, `DiscoveredMCP`, `ChannelManifestConfig` type definitions |
| `format.ts` | `formatPipe()` — formatting utilities for discovery output |
| `cli.ts` | CLI entry point for running discovery as a standalone command |
| `external-loader.ts` | `loadExternalMCPs()` — loads third-party MCP configs from `external-mcps.json` |
| `external-config.ts` | Type definitions and validation for external MCP entries |

### Transport

Shared transport layer for MCP servers supporting both stdio and HTTP/SSE.

| File | Description |
|---|---|
| `dual-transport.ts` | `startTransport()` — configures stdio (default) or HTTP/SSE transport based on `TRANSPORT` env var. Used by HTTP MCPs (Searcher, Gmail) |

### Logging

Structured logging for audit and trace purposes.

| File | Description |
|---|---|
| `jsonl.ts` | JSONL file writer for structured log entries (traces, audit events) |

### Testing

Shared test utilities to avoid duplication across packages.

| File | Description |
|---|---|
| `mcp-test-client.ts` | `MCPTestClient` class — HTTP helper for calling MCP servers in integration tests. Handles tool calls, health checks, timeouts |
| `test-utils.ts` | Common test helpers (assertions, fixtures) |

## Building

```bash
cd Shared && npm run build
```

Build output goes to `dist/`. All consumers reference the compiled JavaScript via the `exports` map in `package.json`.

## Testing

```bash
cd Shared && npx vitest run
```

## Requirements

- Node.js >= 22.0.0
- Peer dependencies: `@modelcontextprotocol/sdk` >= 1.0.0, `zod` >= 3.0.0
