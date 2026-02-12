# Logging

## Overview

Annabelle uses a two-tier logging architecture:

1. **Console Logger** (`Shared/Utils/logger.ts`) — Structured text logs written to **stderr**. Every MCP imports this. Output is redirected to `.log` files by `start-all.sh`.
2. **JSONL Audit Loggers** — Domain-specific structured logs written directly to `.jsonl` files. Used by Guardian, Filer, CodeExec, and Thinker for audit trails and tracing.

No external logging library is used — everything is built on Node.js builtins (`console.error`, `fs/promises`).

---

## Console Logger

**File:** `Shared/Utils/logger.ts`

### Why stderr?

Stdio MCPs communicate with the Orchestrator over stdout using JSON-RPC. Any stray `console.log()` output would corrupt the transport. The Logger class uses `console.error()` for **all** log levels to keep stdout clean.

### API

```typescript
import { logger, Logger } from '@mcp/shared/Utils/logger.js';

// Default singleton instance (context: 'mcp')
logger.info('Server started', { port: 8010 });

// Custom instance
const log = new Logger('gmail');
log.warn('Token expiring soon');

// Child loggers — compound context
const child = logger.child('orchestrator');   // context: 'mcp:orchestrator'
const grandchild = child.child('health');     // context: 'mcp:orchestrator:health'

// Dynamic control
log.setLevel('debug');
log.setContext('gmail-v2');
```

### Output format

```
[2026-02-11T15:30:45.123Z] [INFO] [gmail] Token refreshed {"expiresIn":3600}
[2026-02-11T15:30:46.001Z] [ERROR] [mcp:orchestrator] MCP crashed {"message":"ECONNREFUSED","name":"Error","stack":"...","code":"ECONNREFUSED"}
```

- Timestamp: ISO 8601
- Level: `DEBUG`, `INFO`, `WARN`, `ERROR`
- Context: logger name, colon-separated for children
- Data: optional JSON payload. `Error` objects are serialized with `message`, `name`, `stack`, and `code`.

### Log levels

| Level | Priority | Description |
|-------|----------|-------------|
| `debug` | 0 | Verbose diagnostic info (tool args, route decisions) |
| `info` | 1 | Normal operations (startup, tool calls, health checks) |
| `warn` | 2 | Degraded state (MCP down, token expiring, blocked tool) |
| `error` | 3 | Failures (crash, unhandled exception, tool error) |

Only messages at or above the configured level are emitted. Default: `info`.

---

## JSONL Logger (Generic)

**File:** `Shared/Logging/jsonl.ts`

A reusable typed logger for writing structured audit trails to `.jsonl` files (one JSON object per line).

```typescript
import { JsonlLogger } from '@mcp/shared/Logging/jsonl.js';

interface MyEntry extends BaseAuditEntry {
  operation: string;
  success: boolean;
}

const audit = new JsonlLogger<MyEntry>('/path/to/audit.jsonl');

// Write
await audit.write({ timestamp: new Date().toISOString(), operation: 'read', success: true });

// Read with filtering
const recent = await audit.read({
  limit: 50,
  sortDescending: true,
  filter: (e) => !e.success,
});
```

Features:
- Auto-creates parent directories on first write
- Skips malformed lines on read (graceful recovery)
- Sorts by `timestamp` (descending by default)
- Default read limit: 100 entries

---

## Log File Locations

All logs centralize under `~/.annabelle/logs/`. The directory is created by `start-all.sh` at startup.

### Console logs (text, from stderr redirection)

| File | Source |
|------|--------|
| `orchestrator.log` | Orchestrator + stdio MCP child stderr + Thinker agent stderr |
| `inngest.log` | Inngest Dev Server |
| `searcher.log` | Searcher MCP (HTTP) |
| `gmail.log` | Gmail MCP (HTTP) |
| `telegram.log` | Telegram MCP (HTTP) |
| `ollama.log` | Ollama model server |
| `seed-skills.log` | Cron skill seeding |
| `web.log` | Browser MCP |

Stdio MCPs (Guardian, 1Password, Filer, Memorizer, CodeExec) don't get their own log files — their stderr is piped through the Orchestrator's process and lands in `orchestrator.log` with their context prefix (e.g. `[mcp:filer]`).

### JSONL audit logs

| File | Source | Content |
|------|--------|---------|
| `~/.annabelle/logs/traces.jsonl` | Thinker | Per-request trace events |
| `~/.annabelle/logs/fileops-audit.log` | Filer MCP | File operation audit trail |
| `Guardian/logs/audit.jsonl` | Guardian | Security scan results |
| `~/.annabelle/codexec/logs/executions-YYYY-MM-DD.jsonl` | CodeExec | Daily execution logs |
| `~/.annabelle/codexec/logs/session-{id}.jsonl` | CodeExec | Per-session lifecycle |

---

## Per-MCP Logging Details

### Guardian — Security Scan Audit

**File:** `Guardian/src/logging/audit.ts`

Logs every security scan to `Guardian/logs/audit.jsonl` with:

```typescript
interface AuditEntry {
  scan_id: string;        // UUID v4
  timestamp: string;
  source: string;         // what triggered the scan
  content_hash: string;   // SHA-256 truncated to 16 chars (privacy)
  content_length: number;
  safe: boolean;
  confidence: number;
  threats: ThreatInfo[];  // { path, type, snippet }
  model: string;          // which model scanned
  latency_ms: number;
}
```

Queryable via the `get_scan_log` MCP tool (supports `threats_only`, `limit`, `scan_id` filters).

### Filer — File Operations Audit

**File:** `Filer-MCP/src/logging/audit.ts`

Logs every file operation to `~/.annabelle/logs/fileops-audit.log` (configurable via `AUDIT_LOG_PATH`):

```typescript
interface AuditEntry {
  timestamp: string;
  operation: string;      // read, write, delete, list, etc.
  path: string;
  domain: 'workspace' | 'granted';
  grant_id: string | null;
  agent_id: string;
  session_id: string;
  success: boolean;
  size_bytes?: number;
  error?: string;
}
```

Queryable via the `get_audit_log` MCP tool (supports `path_filter`, `operation_filter`, `date_from`, `limit`).

### CodeExec — Execution & Session Logs

**Files:** `CodeExec-MCP/src/logging/writer.ts`, `CodeExec-MCP/src/logging/types.ts`

Two log streams, both JSONL, stored in `~/.annabelle/codexec/logs/` (configurable via `CODEXEC_LOG_DIR`):

**Daily execution logs** (`executions-YYYY-MM-DD.jsonl`):
```typescript
interface ExecutionLogEntry {
  type: 'execution';
  execution_id: string;
  language: 'python' | 'node' | 'bash';
  code: string;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
  duration_ms: number;
  sandbox_mode: 'subprocess';
  working_dir: string;
  artifacts: { created: string[]; modified: string[]; deleted: string[] };
  executed_at: string;
}
```

**Per-session logs** (`session-{sessionId}.jsonl`):
```typescript
type SessionLogEntry =
  | SessionStartLogEntry    // PID, language, started_at
  | SessionExecLogEntry     // code, stdout, stderr, duration_ms
  | SessionEndLogEntry      // reason (manual|idle_timeout|process_exit), total_duration_ms
  | PackageInstallLogEntry  // package_name, version, success
```

### Telegram MCP — GramJS suppression

Telegram MCP overrides `console.log = () => {}` at startup to suppress GramJS library noise that would otherwise corrupt the MCP JSON-RPC transport. Actual logging goes through the shared Logger (stderr).

### Other MCPs

1Password, Memorizer, Searcher, Gmail all use the shared `Logger` class directly with no additional audit logging. Typical pattern:

```typescript
import { Logger } from '@mcp/shared/Utils/logger.js';
const logger = new Logger('searcher');
```

---

## Thinker TraceLogger

**Files:** `Thinker/src/tracing/logger.ts`, `Thinker/src/tracing/types.ts`

A specialized request-level tracer that logs every step of a conversation to `~/.annabelle/logs/traces.jsonl` (configurable via `TRACE_LOG_PATH`).

### Trace entry structure

```typescript
interface TraceEntry {
  trace_id: string;                // Request ID, propagated via X-Trace-Id header
  ts: string;                      // ISO timestamp
  mcp: string;                     // MCP/service name
  event: TraceEvent | string;
  data: Record<string, unknown>;
}
```

### Traced events

| Event | Data |
|-------|------|
| `message_received` | `chat_id`, `text` (truncated to 100 chars for privacy) |
| `context_loaded` | `facts` count, `profile` presence |
| `llm_call_start` | `provider`, `model` |
| `llm_call_complete` | `provider`, `model`, `input_tokens`, `output_tokens`, `duration_ms` |
| `tool_call_start` | `tool`, `args` |
| `tool_call_complete` | `tool`, `success`, `duration_ms` |
| `tool_call_error` | `tool`, `error` |
| `response_sent` | `chat_id`, `response_length` |
| `error` | `error`, plus any extra details |
| `complete` | `duration_ms`, `tools_used`, `total_steps` |

Uses a singleton pattern: `getTraceLogger(path?)` returns a shared instance.

---

## Log Redirection in start-all.sh

`start-all.sh` handles all log file creation and process management:

```bash
# Create log directory
mkdir -p ~/.annabelle/logs

# HTTP MCPs — stdout+stderr → log file
TRANSPORT=http PORT=$port npm start >> ~/.annabelle/logs/${log_name}.log 2>&1 &

# Orchestrator — same pattern
npm start >> ~/.annabelle/logs/orchestrator.log 2>&1 &

# Inngest Dev Server
npx inngest-cli@latest dev --no-discovery >> ~/.annabelle/logs/inngest.log 2>&1 &

# Ollama
ollama serve >> ~/.annabelle/logs/ollama.log 2>&1 &
```

All processes use `>> file 2>&1` (append mode, stderr merged into stdout).

PIDs are tracked in `~/.annabelle/annabelle.pids` for shutdown management.

Stdio MCP stderr is captured differently — it's piped through the Orchestrator's `StdioClientTransport`, which reads child stderr line-by-line and logs each line via `logger.child('mcp:${name}')`.

---

## Querying Logs

### `/logs` slash command

**File:** `Orchestrator/src/commands/slash-commands.ts`

Available via Telegram (or any channel adapter):

| Command | Result |
|---------|--------|
| `/logs` | List all log files with sizes and last-modified times |
| `/logs N` | Show last N warnings/errors across all service logs (default: 15) |

Scans these files for `[WARN]` and `[ERROR]` lines:
`orchestrator.log`, `thinker.log`, `gmail.log`, `telegram.log`, `searcher.log`, `filer.log`, `memorizer.log`, `ollama.log`, `web.log`

### `/status summary`

Runs a health audit that includes a "Recent Logs (WARN/ERROR)" section, pulling the same log parsing logic.

### MCP tools for audit logs

- **Guardian**: `get_scan_log` — query `Guardian/logs/audit.jsonl`
- **Filer**: `get_audit_log` — query `~/.annabelle/logs/fileops-audit.log`

### Manual monitoring

```bash
# Tail all logs
tail -f ~/.annabelle/logs/*.log

# Tail specific service
tail -f ~/.annabelle/logs/orchestrator.log

# Search for errors
grep '\[ERROR\]' ~/.annabelle/logs/*.log

# Read traces
cat ~/.annabelle/logs/traces.jsonl | jq .

# Read CodeExec execution logs for today
cat ~/.annabelle/codexec/logs/executions-$(date +%Y-%m-%d).jsonl | jq .
```

---

## Configuration

| Env Variable | Default | Scope | Description |
|-------------|---------|-------|-------------|
| `LOG_LEVEL` | `info` | All MCPs | Console log verbosity (`debug`, `info`, `warn`, `error`) |
| `CODEXEC_LOG_DIR` | `~/.annabelle/codexec/logs` | CodeExec | Execution/session log directory |
| `AUDIT_LOG_PATH` | `~/.annabelle/logs/fileops-audit.log` | Filer | File operations audit path |
| `TRACE_LOG_PATH` | `~/.annabelle/logs/traces.jsonl` | Thinker | Conversation trace path |

---

## Design Principles

1. **No external dependencies** — Pure Node.js (`console.error`, `fs/promises`, `crypto`). No winston, pino, or bunyan.
2. **Stdout is sacred** — Stdio MCPs must never write to stdout. All logging goes through `console.error()`.
3. **JSONL for audit** — Structured logs use JSON Lines format for easy `jq` queries, programmatic filtering, and append-only writes.
4. **Hierarchical contexts** — Child loggers create compound context strings (`mcp:filer`, `mcp:orchestrator:health`) for easy grep filtering.
5. **No log rotation** — Log files grow unbounded. Shell-level `>>` append means they survive restarts. Manual cleanup or external rotation is required.
6. **Privacy-conscious** — Guardian hashes scanned content (SHA-256, truncated). Thinker truncates message text to 100 chars in traces.
7. **Centralized directory** — All runtime logs under `~/.annabelle/logs/`, except Guardian audit (co-located with the MCP) and CodeExec (under `~/.annabelle/codexec/logs/`).
