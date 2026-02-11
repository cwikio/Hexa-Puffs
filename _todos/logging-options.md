# Logging Architecture: Current State & Options

## Current State

All MCPs use the shared `Logger` class from `Shared/Utils/logger.ts`. Output goes to `console.error()` to keep stdout clean for JSON-RPC. Format: `[ISO_TIMESTAMP] [LEVEL] [CONTEXT] message {data}`.

The **library is unified** but **log destinations are not**:

| Service Type | Examples | Where logs go | How captured |
|---|---|---|---|
| HTTP MCPs | Searcher, Gmail, Telegram | `~/.annabelle/logs/{name}.log` | Shell redirection in `start-all.sh` |
| Orchestrator | -- | `~/.annabelle/logs/orchestrator.log` | Shell redirection in `start-all.sh` |
| Thinker (agents) | annabelle | `orchestrator.log` (relayed) | AgentManager pipes stdout/stderr with `[agent:id]` prefix |
| Stdio MCPs | Guardian, Filer, Memorizer, 1Password, CodeExec | Parent stderr -- **not individually captured** | Mixed into orchestrator.log unprefixed |
| Inngest | -- | `~/.annabelle/logs/inngest.log` | Shell redirection |

**Audit logs** (separate concern): Guardian, Filer, and CodeExec have domain-specific JSONL audit logs via `Shared/Logging/jsonl.ts`. Thinker has `traces.jsonl`. These are structured and queryable.

## Options

### Option A: Fix the Gap (minimal) -- SELECTED

Pipe stdio MCP stderr through the Orchestrator logger with `[mcp:{name}]` prefixes. The SDK's `StdioClientTransport` already supports `stderr: 'pipe'` natively. Just pass it and attach a listener.

- Pros: Minimal change, no new deps, new MCPs get it automatically
- Cons: Still a text file, no structured querying

### Option B: Structured Central Log File (moderate)

Extend `Logger` to optionally append JSONL entries to a central file (`~/.annabelle/logs/all.jsonl`) or per-service files. Build a `log_query` tool in Orchestrator.

- Pros: Structured, queryable, could build a log viewer
- Cons: File I/O from every MCP, concurrent write concerns

### Option C: Log Collection via Orchestrator (centralized)

Orchestrator exposes a logging endpoint. HTTP MCPs POST logs to it. Stdio MCPs captured via piping. Single source of truth.

- Pros: True centralization
- Cons: More coupling, latency for HTTP MCPs, added complexity

### Option D: External Tooling (heavy)

Loki + Grafana, syslog, journald, etc.

- Pros: Production-grade observability
- Cons: Overkill for local dev stack, infra to maintain
