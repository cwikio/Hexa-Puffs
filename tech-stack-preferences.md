# Tech Stack Preferences

Used by Claude skills and agents to adapt recommendations to this project's conventions.

## Runtime

- **Node.js 22+** (see `.nvmrc`)
- **TypeScript 5.7** with strict mode
- **ES Modules** (`"type": "module"`, NodeNext resolution)

## Package Management

- **npm** (no yarn, no pnpm, no bun)
- No root `package.json` — each package manages its own dependencies
- Shared package linked via `"@mcp/shared": "file:../Shared"` in each package

## Frameworks & Libraries

| Purpose | Library | Notes |
|---------|---------|-------|
| LLM integration | Vercel AI SDK (`ai`, `@ai-sdk/groq`, `@ai-sdk/openai`) | ReAct via `maxSteps` |
| Input validation | Zod | All tool inputs, all configs |
| HTTP server | Express 4 | All MCP HTTP endpoints |
| MCP protocol | `@modelcontextprotocol/sdk` | Stdio and HTTP transports |
| Database | better-sqlite3 + sqlite-vec | Memorizer, Filer grants |
| Testing | Vitest 3 | Shared base config at root |
| Dev runner | tsx | Watch mode for development |
| Job scheduling | Inngest | Cron jobs, background tasks |
| Browser automation | Playwright (`@playwright/mcp`) | Browser-MCP |
| Telegram | GramJS (MTProto) | Real-time messaging |

## LLM Providers

- **Groq** — default cloud provider (fast, cheap)
- **LM Studio** — local, OpenAI-compatible
- **Ollama** — local, flexible (also used for embeddings)

## Code Style

- Strict TypeScript — avoid `as` casting, prefer type guards and narrowing
- Zod schemas co-located with tool definitions
- `StandardResponse<T>` return type for all tool handlers
- `registerTool()` from `@mcp/shared` for all tool registrations
- `.js` extensions in all import paths (ESM requirement)
- stderr for all logging (stdout reserved for MCP JSON-RPC)

## Testing Style

- Integration tests preferred over unit tests
- Graceful degradation: tests skip when services unavailable
- `MCPTestClient` from `@mcp/shared/Testing` for MCP integration
- 30-second timeout default

## Architecture Patterns

- Process-level isolation: each MCP runs as its own process
- Stdio transport by default (Orchestrator spawns MCPs as child processes)
- Auto-discovery via `hexa-puffs` manifest in `package.json`
- Guardian wraps MCPs for security scanning (decorator pattern)
- Lazy-spawn agents: started on first message, idle-killed after inactivity
