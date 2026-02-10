# CodeExec MCP

A Model Context Protocol (MCP) server for code execution with persistent sessions, sandboxing, script management, and comprehensive logging.

## Purpose

Gives Annabelle agents the ability to **write and run code** to solve novel problems that no pre-built tool covers — parsing data, transforming files, running calculations, calling APIs, prototyping solutions. Without code execution, agents are limited to the capabilities of pre-built tools and cannot improvise when encountering novel tasks.

The key design principle: code execution is a **tool above the safety layer**, not a primitive below it. Every execution flows through Orchestrator where Guardian can scan the code before it runs and the output after. Per-agent tool policies can deny `execute_code` entirely for untrusted agents.

## Features

- **Stateless Execution**: One-shot code runs — submit code, get output
- **Persistent Sessions**: REPL-style sessions where state (variables, imports, data) persists across multiple tool calls
- **Script Library**: Save, retrieve, and reuse tested scripts
- **Package Management**: Install pip/npm packages with Guardian-scannable package names
- **Comprehensive Logging**: Every execution logged with full context — code, output, artifacts, duration, resources
- **Tiered Sandboxing**: Subprocess mode (fast, light isolation) and Docker mode (full isolation, no network)
- **Guardian Integration**: Pre-execution code scanning, post-execution output scanning
- **Stdio Transport**: Spawned by Orchestrator, consistent with Guardian, Memory, and Filer MCPs

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATION LAYER                           │
│  Agent requests code execution → Orchestrator → CodeExec MCP    │
│  Guardian scans code before dispatch (pre-scan)                 │
└─────────────────────────────────┬───────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                      CODEXEC MCP                                │
│                       (stdio)                                    │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Executor   │  │   Session    │  │   Script     │          │
│  │   Engine     │  │   Manager    │  │   Library    │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Sandbox    │  │  Execution   │  │   Package    │          │
│  │   Manager    │  │   Logger     │  │   Manager    │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────┬───────────────────────────┘
                                      ↓
         ┌────────────────────────────┼────────────────────────┐
         ↓                            ↓                        ↓
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Subprocess    │     │     Docker      │     │   Script Store  │
│   Sandbox       │     │   Container     │     │ ~/.annabelle/   │
│ (fast, light)   │     │ (full isolate)  │     │   scripts/      │
│                 │     │                 │     │                 │
│ • Stripped env  │     │ • No network    │     │ • Index (JSON)  │
│ • Temp dir jail │     │ • CPU/mem limit │     │ • Script files  │
│ • Timeout kill  │     │ • Mount sandbox │     │ • Metadata      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### How It Fits Into Annabelle

```
Thinker Agent
     │
     ├── calls execute_code / start_session / etc.
     ↓
Orchestrator
     │
     ├── Guardian pre-scans the code string (if scan enabled for this agent)
     ├── Checks tool policy (agent may have execute_code in deniedTools)
     ↓
CodeExec MCP (stdio, spawned by Orchestrator)
     │
     ├── Executes code in sandbox
     ├── Logs execution to JSONL
     ├── Returns stdout/stderr/exit code
     ↓
Orchestrator
     │
     ├── Guardian post-scans the output (if scan enabled)
     ↓
Thinker Agent (receives result, continues ReAct loop)
```

Orchestrator auto-discovers CodeExec MCP via its standard MCP manifest — no Orchestrator code changes needed.

---

## Installation

```bash
npm install
npm run build
npm start        # spawned by Orchestrator via stdio
```

### Docker Sandbox (Optional)

```bash
docker build -t annabelle-sandbox -f Dockerfile.sandbox .
```

The Docker image provides a minimal runtime with Python 3, Node.js 20, and common data libraries pre-installed. No network access. Mounted to a single workspace directory.

---

## Configuration

### Environment Variables

```bash
# Sandbox mode
CODEXEC_SANDBOX_MODE=subprocess                    # "subprocess" or "docker"
CODEXEC_DOCKER_IMAGE=annabelle-sandbox             # Docker image name
CODEXEC_SANDBOX_DIR=~/.annabelle/codexec/sandbox   # Working directory for executions

# Timeouts
CODEXEC_DEFAULT_TIMEOUT_MS=30000                   # 30 seconds default
CODEXEC_MAX_TIMEOUT_MS=300000                      # 5 minutes maximum
CODEXEC_SESSION_IDLE_TIMEOUT_MS=900000             # 15 minutes idle → session killed

# Resource limits (Docker mode)
CODEXEC_DOCKER_MEMORY=512m                         # Memory limit
CODEXEC_DOCKER_CPU=1.0                             # CPU limit (cores)
CODEXEC_DOCKER_NETWORK=none                        # Network mode (none = isolated)

# Output
CODEXEC_MAX_OUTPUT_CHARS=10000                     # Truncate output beyond this
CODEXEC_TRUNCATION_HEAD=4000                       # Keep first N chars when truncating
CODEXEC_TRUNCATION_TAIL=4000                       # Keep last N chars when truncating

# Logging
CODEXEC_LOG_DIR=~/.annabelle/codexec/logs          # Execution logs directory
CODEXEC_LOG_RETENTION_DAYS_SUCCESS=30              # Keep successful execution logs
CODEXEC_LOG_RETENTION_DAYS_FAILURE=90              # Keep failed execution logs
CODEXEC_LOG_RETENTION_DAYS_SESSION=90              # Keep session logs

# Scripts
CODEXEC_SCRIPTS_DIR=~/.annabelle/scripts           # Saved scripts directory

# Logging level
LOG_LEVEL=info
```

---

## Available Tools

### Execution Tools

| Tool | Description |
|------|-------------|
| `execute_code` | Run code in a one-shot sandbox. Stateless — each call is independent. |
| `start_session` | Create a persistent REPL session. State persists across calls. |
| `send_to_session` | Send code to an existing session. Builds on previous state. |
| `close_session` | Kill a session and clean up its resources. |
| `list_sessions` | List active sessions with language, age, memory usage. |

### Package Management

| Tool | Description |
|------|-------------|
| `install_package` | Install a pip or npm package into a session's environment. |

### Script Library

| Tool | Description |
|------|-------------|
| `save_script` | Save code as a reusable named script with metadata. |
| `get_script` | Retrieve a saved script by name. |
| `list_scripts` | List saved scripts with descriptions and tags. |
| `search_scripts` | Search scripts by description, tags, or language. |
| `run_script` | Execute a previously saved script (by name). |

### Logging & Diagnostics

| Tool | Description |
|------|-------------|
| `search_execution_logs` | Query past executions by language, date, status, or text. |
| `get_execution_log` | Get the full log entry for a specific execution ID. |

---

## Tool API Details

### execute_code

Run code in a one-shot sandbox. Each call starts a fresh process with no state from previous calls.

```jsonc
// Input
{
  "language": "python",        // "python" | "node" | "bash"
  "code": "import pandas as pd\ndf = pd.read_csv('data.csv')\nprint(df.describe())",
  "timeout_ms": 30000,         // Optional. Default: CODEXEC_DEFAULT_TIMEOUT_MS
  "working_dir": "~/Downloads" // Optional. Default: CODEXEC_SANDBOX_DIR
}
// Output (success)
{
  "success": true,
  "execution_id": "exec_a1b2c3",
  "language": "python",
  "stdout": "       col1    col2\ncount  100.0   100.0\nmean    50.5    25.3\n...",
  "stderr": "",
  "exit_code": 0,
  "duration_ms": 1245,
  "truncated": false,
  "artifacts": ["data_summary.csv"]    // Files created in working_dir during execution
}
// Output (failure)
{
  "success": false,
  "execution_id": "exec_d4e5f6",
  "language": "python",
  "stdout": "",
  "stderr": "ModuleNotFoundError: No module named 'pandas'",
  "exit_code": 1,
  "duration_ms": 312,
  "truncated": false,
  "artifacts": []
}
// Output (timeout)
{
  "success": false,
  "execution_id": "exec_g7h8i9",
  "language": "python",
  "stdout": "Processing row 1...\nProcessing row 2...\n",
  "stderr": "",
  "exit_code": null,
  "duration_ms": 30000,
  "timed_out": true,
  "truncated": true,
  "artifacts": []
}
```

**Output truncation:** When output exceeds `CODEXEC_MAX_OUTPUT_CHARS`, the tool returns the first `CODEXEC_TRUNCATION_HEAD` characters + `\n\n[... truncated N characters ...]\n\n` + the last `CODEXEC_TRUNCATION_TAIL` characters. This preserves both the beginning (typically key results) and the end (typically error messages or final status).

**Artifact detection:** After execution completes, the MCP diffs the working directory listing (before vs after) to identify files created or modified by the code. These filenames are returned in the `artifacts` array.

### start_session

Create a persistent REPL session. The agent can send multiple code snippets to this session, building on previous state (variables, imports, loaded data).

```jsonc
// Input
{
  "language": "python",        // "python" | "node"
  "name": "data-analysis",    // Optional human-readable name
  "working_dir": "~/Downloads" // Optional
}
// Output
{
  "success": true,
  "session_id": "sess_x1y2z3",
  "language": "python",
  "name": "data-analysis",
  "pid": 12345,
  "started_at": "2026-02-09T14:30:00Z"
}
```

**How sessions work:** The MCP spawns a long-running Python or Node process in interactive/REPL mode. Code sent via `send_to_session` is piped to stdin, output captured from stdout/stderr. The process stays alive across tool calls, so variables, imported modules, and loaded data persist.

**Session limits:**
- Max 5 concurrent sessions (configurable)
- Idle timeout: 15 minutes of no `send_to_session` calls → session auto-killed
- Sessions do NOT survive MCP restarts (they're processes, not persisted state)

### send_to_session

Send a code snippet to an existing session. Output reflects the cumulative state of all previous snippets in this session.

```jsonc
// Input
{
  "session_id": "sess_x1y2z3",
  "code": "df.groupby('category').mean()"
}
// Output
{
  "success": true,
  "execution_id": "exec_j1k2l3",
  "session_id": "sess_x1y2z3",
  "stdout": "         value\ncategory      \nA         42.3\nB         18.7\n",
  "stderr": "",
  "duration_ms": 89,
  "truncated": false,
  "artifacts": []
}
```

### close_session

Kill a session process and clean up resources.

```jsonc
// Input
{ "session_id": "sess_x1y2z3" }
// Output
{ "success": true, "session_id": "sess_x1y2z3", "duration_total_ms": 542000, "executions_count": 12 }
```

### list_sessions

List all active sessions with status information.

```jsonc
// Input
{}
// Output
{
  "sessions": [
    {
      "session_id": "sess_x1y2z3",
      "language": "python",
      "name": "data-analysis",
      "started_at": "2026-02-09T14:30:00Z",
      "last_activity_at": "2026-02-09T14:38:00Z",
      "executions_count": 8,
      "pid": 12345,
      "memory_mb": 87.4,
      "packages_installed": ["pandas", "matplotlib"]
    }
  ]
}
```

### install_package

Install a pip or npm package into a session's environment. Exposed as a separate tool (not inline in code) so Guardian can scan package names against a blocklist before installation.

```jsonc
// Input
{
  "session_id": "sess_x1y2z3",   // Optional — if omitted, installs globally
  "package": "pandas",
  "language": "python"            // "python" (pip) or "node" (npm)
}
// Output
{
  "success": true,
  "package": "pandas",
  "version": "2.2.1",
  "install_output": "Successfully installed pandas-2.2.1 numpy-1.26.4"
}
```

**Security note:** Package names are visible to Guardian at the Orchestrator level before reaching CodeExec. A blocklist of known malicious packages can be enforced. In Docker mode, packages install into the container and are discarded when the session ends.

### save_script

Save code as a reusable named script with metadata. The agent builds a personal library of working, tested scripts over time.

```jsonc
// Input
{
  "name": "parse-excel-report",
  "description": "Parses monthly Excel reports from finance, extracts summary rows, outputs CSV",
  "language": "python",
  "code": "import pandas as pd\nimport sys\n...",
  "tags": ["excel", "finance", "parsing"],
  "packages": ["pandas", "openpyxl"],     // Required packages to run this script
  "source_execution_id": "exec_a1b2c3"    // Optional — links to the execution where this was developed
}
// Output
{
  "success": true,
  "script_id": "script_m1n2o3",
  "name": "parse-excel-report",
  "path": "~/.annabelle/scripts/parse-excel-report/script.py",
  "saved_at": "2026-02-09T15:00:00Z"
}
```

**Storage format:** Each script is a directory under `~/.annabelle/scripts/`:

```
~/.annabelle/scripts/
├── index.json                          ← Script index (all metadata)
├── parse-excel-report/
│   ├── script.py                       ← The code
│   └── metadata.json                   ← Description, tags, packages, created_at, last_run
├── clean-csv-data/
│   ├── script.js
│   └── metadata.json
└── backup-db/
    ├── script.sh
    └── metadata.json
```

### get_script

Retrieve a saved script by name.

```jsonc
// Input
{ "name": "parse-excel-report" }
// Output
{
  "success": true,
  "name": "parse-excel-report",
  "description": "Parses monthly Excel reports from finance...",
  "language": "python",
  "code": "import pandas as pd\nimport sys\n...",
  "tags": ["excel", "finance", "parsing"],
  "packages": ["pandas", "openpyxl"],
  "created_at": "2026-02-09T15:00:00Z",
  "last_run_at": "2026-02-15T09:30:00Z",
  "run_count": 7,
  "last_run_success": true
}
```

### list_scripts

```jsonc
// Input
{ "language": "python", "tag": "finance" }  // Both optional filters
// Output
{
  "scripts": [
    { "name": "parse-excel-report", "description": "...", "language": "python", "tags": [...], "last_run_at": "..." }
  ],
  "total_count": 1
}
```

### search_scripts

```jsonc
// Input
{ "query": "excel parsing" }
// Output
{
  "results": [
    { "name": "parse-excel-report", "description": "...", "relevance": "description_match" }
  ]
}
```

### run_script

Execute a previously saved script by name. Optionally accepts arguments.

```jsonc
// Input
{
  "name": "parse-excel-report",
  "args": ["~/Downloads/february-report.xlsx"],   // Passed as command-line args
  "timeout_ms": 60000
}
// Output
{
  // Same format as execute_code output
  "success": true,
  "execution_id": "exec_p1q2r3",
  "language": "python",
  "stdout": "Processed 150 rows. Summary saved to output.csv",
  "stderr": "",
  "exit_code": 0,
  "duration_ms": 3456,
  "truncated": false,
  "artifacts": ["output.csv"]
}
```

**Pre-flight check:** Before running, the MCP verifies that required packages are available. If not, it returns an error listing missing packages with instructions to install them.

### search_execution_logs

Query past execution logs.

```jsonc
// Input
{
  "language": "python",       // Optional filter
  "status": "failed",         // Optional: "success" | "failed" | "timeout"
  "query": "pandas",          // Optional: text search in code or output
  "since": "2026-02-01",      // Optional: date filter
  "limit": 20
}
// Output
{
  "results": [
    {
      "execution_id": "exec_d4e5f6",
      "session_id": null,
      "language": "python",
      "code_preview": "import pandas as pd\ndf = pd.read_csv...",  // First 200 chars
      "status": "failed",
      "exit_code": 1,
      "error_preview": "ModuleNotFoundError: No module named 'pandas'",
      "duration_ms": 312,
      "executed_at": "2026-02-05T10:15:00Z"
    }
  ],
  "total_count": 3
}
```

### get_execution_log

Get the full log entry for a specific execution.

```jsonc
// Input
{ "execution_id": "exec_a1b2c3" }
// Output
{
  "execution_id": "exec_a1b2c3",
  "session_id": "sess_x1y2z3",
  "language": "python",
  "code": "import pandas as pd\ndf = pd.read_csv('data.csv')\nprint(df.describe())",
  "stdout": "...",
  "stderr": "",
  "exit_code": 0,
  "duration_ms": 1245,
  "packages_installed": ["pandas"],
  "artifacts_created": ["data_summary.csv"],
  "artifacts_modified": [],
  "artifacts_deleted": [],
  "sandbox_mode": "subprocess",
  "guardian_pre_scan": { "passed": true, "flags": [] },
  "guardian_post_scan": { "passed": true, "flags": [] },
  "agent_id": "annabelle",
  "trace_id": "tr_abc123",
  "executed_at": "2026-02-09T14:30:01Z"
}
```

---

## Execution Logging

### Log Format

Every execution produces a structured JSONL entry at `~/.annabelle/codexec/logs/`.

**Stateless executions:** One log file per day: `executions-2026-02-09.jsonl`

**Sessions:** One log file per session: `session-sess_x1y2z3.jsonl`

#### Stateless Execution Log Entry

```json
{
  "type": "execution",
  "execution_id": "exec_a1b2c3",
  "language": "python",
  "code": "import pandas as pd\ndf = pd.read_csv('data.csv')\nprint(df.describe())",
  "stdin": null,
  "stdout": "       col1    col2\ncount  100.0   100.0\n...",
  "stderr": "",
  "exit_code": 0,
  "timed_out": false,
  "duration_ms": 1245,
  "memory_peak_mb": 45.2,
  "sandbox_mode": "subprocess",
  "working_dir": "~/.annabelle/codexec/sandbox/exec_a1b2c3",
  "artifacts": {
    "created": ["data_summary.csv"],
    "modified": [],
    "deleted": []
  },
  "guardian": {
    "pre_scan": { "passed": true, "flags": [] },
    "post_scan": { "passed": true, "flags": [] }
  },
  "context": {
    "agent_id": "annabelle",
    "trace_id": "tr_abc123",
    "chat_id": "telegram:12345"
  },
  "executed_at": "2026-02-09T14:30:01.123Z"
}
```

#### Session Log Entries

Session log files contain the full lifecycle:

```json
{"type":"session_start","session_id":"sess_x1y2z3","language":"python","name":"data-analysis","pid":12345,"agent_id":"annabelle","started_at":"2026-02-09T14:30:00Z"}
{"type":"package_install","session_id":"sess_x1y2z3","package":"pandas","version":"2.2.1","success":true,"at":"2026-02-09T14:30:05Z"}
{"type":"execution","execution_id":"exec_j1k2l3","session_id":"sess_x1y2z3","code":"import pandas as pd","stdout":"","stderr":"","exit_code":0,"duration_ms":234,"at":"2026-02-09T14:30:10Z"}
{"type":"execution","execution_id":"exec_k2l3m4","session_id":"sess_x1y2z3","code":"df = pd.read_csv('data.csv')","stdout":"","stderr":"","exit_code":0,"duration_ms":567,"at":"2026-02-09T14:31:00Z"}
{"type":"execution","execution_id":"exec_l3m4n5","session_id":"sess_x1y2z3","code":"print(df.describe())","stdout":"       col1...\n","stderr":"","exit_code":0,"duration_ms":89,"at":"2026-02-09T14:31:30Z"}
{"type":"session_end","session_id":"sess_x1y2z3","reason":"idle_timeout","total_duration_ms":900000,"executions_count":3,"at":"2026-02-09T14:45:00Z"}
```

### Artifact Tracking

Before each execution, the MCP snapshots the working directory listing (filenames + sizes + mtimes). After execution, it diffs against the snapshot:

- **Created:** files that exist after but not before
- **Modified:** files where size or mtime changed
- **Deleted:** files that existed before but not after

This diff is stored in the log entry and returned in the tool output as `artifacts`.

### Log Retention

Managed by an Inngest cron job (or internal cleanup timer):

| Category | Retention | Rationale |
|----------|-----------|-----------|
| Successful stateless executions | 30 days | One-shot, output in conversation history |
| Failed executions | 90 days | Failures are more valuable for debugging |
| Session logs | 90 days | Multi-step work, harder to reconstruct |
| Saved scripts + metadata | Forever | Part of the agent's learned procedural knowledge |

### Log Queryability

The `search_execution_logs` tool scans JSONL files with filters. For the MVP, this is sequential scan with in-memory filtering. If log volume grows, a SQLite index can be added later (same pattern as Memory MCP).

---

## Sandboxing

### Subprocess Mode (Default)

Fast, lightweight. Suitable for single-user systems where the user trusts themselves.

**Isolation measures:**
- **Stripped environment:** The spawned process inherits ONLY `PATH`, `HOME`, `LANG`, `TERM`. All API keys, tokens, and Annabelle-internal env vars are removed. The agent's LLM provider keys, Telegram session, Gmail OAuth tokens, 1Password credentials — none are accessible to generated code.
- **Working directory jail:** Each execution gets a unique temp directory under `CODEXEC_SANDBOX_DIR`. The code starts there. It CAN traverse the filesystem (this is the tradeoff for speed), but the stripped environment means it can't authenticate to external services.
- **Timeout enforcement:** `child_process.spawn` with a timer. On timeout, send SIGTERM, wait 5 seconds, send SIGKILL if still alive.
- **Output capture:** stdout and stderr captured separately via pipe. Truncated per configuration if oversized.

**What subprocess mode does NOT protect against:**
- File deletion or modification outside the working directory
- Reading sensitive files (e.g., `~/.ssh/`, `~/.annabelle/data/`)
- Spawning long-running background processes that outlive the execution
- CPU/memory exhaustion (no cgroup limits)

**Mitigation:** Guardian pre-scans the code for dangerous patterns before execution. See Security section.

### Docker Mode

Full isolation. Required for untrusted agents or if running code from untrusted input.

```bash
docker run --rm \
  --network none \
  --memory 512m \
  --cpus 1.0 \
  --read-only \
  --tmpfs /tmp:size=100m \
  -v /path/to/sandbox/exec_id:/workspace:rw \
  -w /workspace \
  annabelle-sandbox \
  python /workspace/script.py
```

**Isolation measures:**
- **No network:** `--network none` — code cannot make HTTP requests, DNS lookups, or exfiltrate data
- **Memory limit:** `--memory 512m` — prevents OOM that could affect the host
- **CPU limit:** `--cpus 1.0` — prevents CPU starvation
- **Read-only root:** `--read-only` with writable `/tmp` and `/workspace` only
- **Mounted workspace:** Only the execution's sandbox directory is visible
- **Disposable:** `--rm` ensures the container is deleted after execution

**Pre-installed in the Docker image:**
- Python 3.12 + pip
- Node.js 20 + npm
- Common data libraries: pandas, numpy, matplotlib, openpyxl, requests (for in-container use)
- jq, curl (for bash scripts)

**Tradeoff:** ~1-2 second startup latency per execution (container spin-up). For REPL sessions, the container stays running for the session duration.

### Mode Selection

Configured globally via `CODEXEC_SANDBOX_MODE`. In the future, per-agent override via tool policy:

```json
{
  "agentId": "annabelle",
  "codexec_sandbox_mode": "subprocess"
}
```

```json
{
  "agentId": "untrusted-agent",
  "codexec_sandbox_mode": "docker"
}
```

---

## Security

### Guardian Integration

CodeExec relies on Orchestrator's existing Guardian pipeline. No direct Guardian calls from inside CodeExec — the scanning happens at the Orchestrator layer before the tool call reaches the MCP.

**Pre-execution scan (Orchestrator-level):**
Guardian receives the `execute_code` tool call parameters (including the `code` string) and scans for:
- File system destruction patterns (`rm -rf`, `shutil.rmtree` on sensitive paths)
- Credential access (`~/.ssh`, `~/.aws`, `~/.annabelle/data`, environment variable enumeration)
- Network exfiltration (curl/wget/requests to unknown hosts, DNS tunneling patterns)
- Process manipulation (kill signals, fork bombs, cron job injection)
- Obfuscation (base64-encoded payloads, eval of encoded strings)

**Post-execution scan (Orchestrator-level):**
Guardian scans the output for PII leakage, credential fragments, or other sensitive data before it's returned to the agent.

**Tool policy integration:**
Per-agent `allowedTools`/`deniedTools` globs work as usual:

```json
{ "agentId": "readonly-agent", "deniedTools": ["execute_code", "start_session", "install_package"] }
```

### Forbidden Paths

Even in subprocess mode, CodeExec validates any `working_dir` parameter against forbidden paths (same list as Filer MCP):

- `~/.ssh/`
- `~/.gnupg/`
- `~/.aws/`
- `~/.config/`
- `~/.annabelle/data/` (internal databases)
- `/etc/`, `/var/`

If the code writes to forbidden paths, the MCP cannot prevent it in subprocess mode (the process has filesystem access). This is why Docker mode exists for higher security requirements, and why Guardian pre-scanning is important.

### Approval Gate (Future Enhancement)

Optional Telegram-based approval for high-risk executions. When enabled, the MCP sends the code to the user via Telegram and waits for `/approve` or `/reject` before executing. Not in MVP — adds latency and blocks the agent loop.

---

## File Structure

```
CodeExec-MCP/
├── src/
│   ├── index.ts                  # Entry point, MCP server setup
│   ├── config.ts                 # Environment config (Zod validation)
│   │
│   ├── executor/
│   │   ├── types.ts              # ExecutionRequest, ExecutionResult, SessionInfo
│   │   ├── subprocess.ts         # Subprocess sandbox implementation
│   │   ├── docker.ts             # Docker sandbox implementation
│   │   ├── factory.ts            # Sandbox factory (subprocess vs docker)
│   │   └── index.ts              # Barrel export
│   │
│   ├── sessions/
│   │   ├── types.ts              # Session state types
│   │   ├── manager.ts            # Session lifecycle: create, send, close, idle-kill
│   │   └── index.ts              # Barrel export
│   │
│   ├── scripts/
│   │   ├── types.ts              # ScriptMetadata, ScriptIndex
│   │   ├── library.ts            # Save, get, list, search scripts
│   │   └── index.ts              # Barrel export
│   │
│   ├── logging/
│   │   ├── types.ts              # LogEntry types (execution, session lifecycle)
│   │   ├── writer.ts             # JSONL log writer with rotation
│   │   ├── reader.ts             # Log search and retrieval
│   │   └── index.ts              # Barrel export
│   │
│   ├── tools/
│   │   ├── execute.ts            # execute_code, run_script tools
│   │   ├── sessions.ts           # start_session, send_to_session, close/list tools
│   │   ├── packages.ts           # install_package tool
│   │   ├── scripts.ts            # save/get/list/search_scripts tools
│   │   ├── logs.ts               # search_execution_logs, get_execution_log tools
│   │   └── index.ts              # Tool registration barrel
│   │
│   └── utils/
│       ├── artifact-diff.ts      # Working directory before/after diff
│       ├── output-truncate.ts    # Head+tail truncation logic
│       └── id-generator.ts       # exec_xxx, sess_xxx ID generation
│
├── Dockerfile.sandbox            # Docker sandbox image
├── package.json
├── tsconfig.json
├── .env.example
└── README.md                     # This file
```

---

## Storage Layout

```
~/.annabelle/
├── codexec/
│   ├── logs/                              # Execution logs
│   │   ├── executions-2026-02-09.jsonl    # Stateless execution logs (daily)
│   │   ├── session-sess_x1y2z3.jsonl      # Per-session lifecycle logs
│   │   └── session-sess_a4b5c6.jsonl
│   │
│   └── sandbox/                           # Execution working directories
│       ├── exec_a1b2c3/                   # One-shot execution (cleaned after)
│       └── sess_x1y2z3/                   # Session workspace (cleaned on close)
│
├── scripts/                               # Saved script library
│   ├── index.json                         # Script index (metadata for all scripts)
│   ├── parse-excel-report/
│   │   ├── script.py
│   │   └── metadata.json
│   └── clean-csv-data/
│       ├── script.js
│       └── metadata.json
```

---

## Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.0",
    "nanoid": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0",
    "vitest": "^2.0.0"
  }
}
```

No heavy external dependencies. No Express needed — stdio transport uses the MCP SDK directly. The sandbox uses Node.js built-in `child_process`. Docker integration uses CLI (`docker run`) rather than a Docker SDK — simpler, fewer dependencies, easier to debug.

---

## Integration with Existing Architecture

### Orchestrator Auto-Discovery

CodeExec MCP follows the standard MCP manifest pattern. Orchestrator discovers it via stdio like other spawned MCPs (Guardian, Memory, Filer). Add to the MCP discovery config:

```json
{
  "name": "codexec",
  "command": "node",
  "args": ["CodeExec-MCP/dist/index.js"],
  "transport": "stdio"
}
```

No Orchestrator code changes needed — auto-discovery handles registration.

### Tool Naming Convention

All tools prefixed for discoverability: `execute_code`, `start_session`, `send_to_session`, etc. These appear in Orchestrator's tool list alongside all other MCP tools and are subject to the same per-agent tool policy filtering.

### Dynamic Tool Selection

Thinker's keyword-based tool selector (`tool-selector.ts`) needs a new tool group:

```typescript
{
  group: "codexec",
  keywords: ["code", "script", "run", "execute", "python", "node", "bash", "calculate", "parse", "compute", "program", "install"],
  tools: ["execute_code", "start_session", "send_to_session", "close_session", "list_sessions", "install_package", "save_script", "get_script", "list_scripts", "search_scripts", "run_script", "search_execution_logs", "get_execution_log"]
}
```

### Cost Implications

Each `execute_code` call does NOT consume LLM tokens directly — it's a tool call. However, the agent may use multiple ReAct steps to write, run, debug, and re-run code. With `maxSteps: 8`, a write-run-fix-rerun cycle uses 4 steps, leaving 4 for other work. The cost monitor tracks LLM tokens, not execution time.

Docker container startup (~1-2s) and code execution time add wall-clock latency but not API cost.

---

## Implementation Phases

### Phase 1: Core Execution (MVP)

- [ ] Project setup (package.json, tsconfig, config.ts with Zod)
- [ ] MCP server with stdio transport
- [ ] `execute_code` tool — subprocess mode only
- [ ] Output capture (stdout/stderr separate), truncation
- [ ] Timeout enforcement with SIGTERM/SIGKILL
- [ ] Stripped environment (remove all API keys/tokens)
- [ ] Execution logging to JSONL
- [ ] Artifact detection (working directory diff)
- [ ] Forbidden path validation
- [ ] Wire into Orchestrator auto-discovery

**Milestone:** Agent can run one-shot Python/Node/Bash and get results.

### Phase 2: Sessions

- [ ] `start_session` — spawn persistent REPL process
- [ ] `send_to_session` — pipe code to running REPL
- [ ] `close_session` — kill process, cleanup
- [ ] `list_sessions` — active session inventory
- [ ] Session idle timeout (15 min auto-kill)
- [ ] Session lifecycle logging
- [ ] Max concurrent sessions limit

**Milestone:** Agent can do multi-step data analysis within a single session.

### Phase 3: Script Library

- [ ] `save_script` — persist to `~/.annabelle/scripts/`
- [ ] `get_script` — retrieve by name
- [ ] `list_scripts` / `search_scripts` — browse library
- [ ] `run_script` — execute saved script with args
- [ ] Script index management (index.json)
- [ ] Pre-flight package check before `run_script`
- [ ] Script run count and last-run tracking

**Milestone:** Agent builds reusable script library. "Parse it like last time" works.

### Phase 4: Package Management

- [ ] `install_package` tool — pip and npm
- [ ] Per-session package tracking
- [ ] Package list returned in session info
- [ ] Global package installation (outside sessions)

**Milestone:** Agent can install dependencies before or during code execution.

### Phase 5: Docker Sandbox

- [ ] Dockerfile.sandbox with Python + Node + common libs
- [ ] Docker executor implementation
- [ ] Container lifecycle management for sessions
- [ ] Resource limit enforcement (memory, CPU, network)
- [ ] Sandbox mode config (global + per-agent override)

**Milestone:** Full isolation available for untrusted or high-risk execution.

### Phase 6: Advanced Logging

- [ ] `search_execution_logs` tool
- [ ] `get_execution_log` tool
- [ ] Log retention cleanup (Inngest cron or internal timer)
- [ ] Memory peak tracking (where possible)

**Milestone:** Agent can recall past executions and learn from failures.

---

## Testing Strategy

### Unit Tests

- Subprocess spawning, timeout handling, SIGTERM/SIGKILL cascade
- Output truncation (head+tail pattern)
- Artifact detection (directory diff)
- Session lifecycle (create, send, idle-kill, close)
- Script library CRUD
- Config validation (Zod schemas)
- Forbidden path validation

### Integration Tests

- Full execute_code flow: submit → execute → capture → return
- Session flow: start → send × 3 → close (verify state persists across sends)
- Script flow: execute → save → get → run
- Timeout behavior: code that sleeps beyond timeout → verify clean kill
- Large output: verify truncation with head+tail
- Stripped environment: verify API keys not accessible in spawned process

### Security Tests

- Verify environment variables are stripped (no GROQ_API_KEY, no TELEGRAM_SESSION)
- Verify forbidden paths rejected in working_dir
- Verify Docker mode has no network (attempt HTTP request → fails)
- Verify Docker memory limit (allocate beyond limit → OOM killed)

---

## Known Limitations & Future Work

### MVP Limitations

1. **No streaming output** — Agent waits for execution to complete. Long-running scripts (>30s) provide no progress feedback. Future: stream partial output via Telegram during execution.
2. **No approval gate** — All code executes automatically if Guardian allows it. Future: optional Telegram approval for high-risk patterns.
3. **Subprocess mode trusts filesystem** — Generated code can read/write anywhere the process user can. Docker mode fixes this but adds latency.
4. **No GPU access** — Docker sandbox runs CPU-only. Not relevant for current use cases but limits ML workloads.
5. **Sessions don't survive restarts** — REPL processes die when the MCP restarts. The session log preserves the history for reference, but state (variables, loaded data) is lost. Future: session checkpoint/restore if needed.

### Future Enhancements

- **Streaming output** via Telegram during long executions
- **Approval gate** for high-risk code (Telegram `/approve` / `/reject`)
- **Per-agent sandbox mode** override in agents.json
- **Script versioning** (keep previous versions when updating a saved script)
- **Script sharing** between agents (currently scoped to a single scripts directory)
- **Workbench evolution** — if multi-agent code collaboration becomes needed, CodeExec MCP is the natural foundation. Sessions become shared workspaces, scripts become shared artifacts, and a coordination protocol (locks or turn-taking) is layered on top.
