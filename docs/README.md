# Hexa Puffs System Documentation

Detailed architecture and operational documentation for the Hexa Puffs AI Assistant system.

## Architecture & Design

| Document | Description |
| --- | --- |
| [Architecture](architecture.md) | System structure, data flow, tool routing, agents, skills, execution tiers |
| [MCP Reference](mcps.md) | Per-MCP details: tools, config, dependencies, failure modes |
| [Tools](tools.md) | Tool registration, naming, selection, execution flow, hallucination guard |
| [Security](security.md) | Four-layer defense-in-depth, Guardian integration, tool policies |
| [Memory System](memory-system.md) | Database schema, hybrid search, 3-tier fallback logic |
| [Sessions](sessions.md) | JSONL format, context building, compaction |
| [Prompt Creation](prompt-creation.md) | Prompt assembly, system prompts, playbooks, context injection |

## Operations

| Document | Description |
| --- | --- |
| [Startup](startup.md) | Boot sequence, service order, health checks |
| [Commands](commands.md) | Slash commands (`/status`, `/diagnose`, `/help`, etc.) |
| [Logging](logging.md) | Two-tier logging architecture, JSONL traces, log rotation |
| [Error Patterns](error-patterns.md) | Common errors, root causes, and fixes |
| [Cost Controls](cost-controls.md) | Anomaly-based spike detection, auto-pause, configuration |

## Integration

| Document | Description |
| --- | --- |
| [External MCPs](external-mcp.md) | Third-party MCP integration, hot-reload, destructive tool blocking |
| [Agents Config](agents-config.md) | agents.json schema reference (agent definitions, bindings, cost controls) |

## Diagrams

Located in [`diagrams/`](diagrams/):

- `skill-architecture-v3.mmd` / `.svg` — Skill system architecture
- `skill-creation-flow.mmd` — Skill creation workflow
- `skill-execution-flow.mmd` — Skill execution workflow
- `tool-normalization-pipeline.mmd` — Tool argument normalization pipeline

## Architecture Decision Records

Located in [`adr/`](adr/):

- [ADR-001](adr/001-stdio-over-http-transport.md) — Stdio over HTTP as default MCP transport
- [ADR-002](adr/002-esm-only-modules.md) — ESM-only modules across all packages
- [ADR-003](adr/003-inngest-for-job-scheduling.md) — Inngest for scheduled task execution
- [ADR-004](adr/004-sqlite-for-memorizer.md) — SQLite (better-sqlite3 + sqlite-vec) for Memorizer
- [ADR-005](adr/005-vercel-ai-sdk-for-thinker.md) — Vercel AI SDK for Thinker agent loop

## Other Guides

| Document | Location | Description |
| --- | --- | --- |
| [Getting Started](../getting-started.md) | Root | Step-by-step setup from clone to launch |
| [How to Add a New MCP](../how-to-add-new-mcp.md) | Root | Complete MCP development guide |
| [Claude Desktop Integration](../how-to-connect-to-claude.md) | Root | Connect via Connector-MCP |
| [Command List](../command-list.md) | Root | Telegram slash command reference |
| [Testing](../testing.md) | Root | Multi-level testing strategy |
| [Conventions](../CONVENTIONS.md) | Root | Coding patterns and project conventions |
| [Contributing](../CONTRIBUTING.md) | Root | Contributor guidelines |
