# CodeExec MCP — Phase 1 MVP Implementation Plan

## Context

Annabelle agents need the ability to write and run code to solve novel problems no pre-built tool covers. The CodeExec MCP README (996 lines) defines a comprehensive 6-phase spec. This plan covers **Phase 1 only**: a single `execute_code` tool with subprocess sandboxing. Additionally, we add it to Thinker's tool selector and fix a wasteful retry pattern in loop.ts.

The directory `CodeExec-MCP/` exists with only a README.md — everything else is built from scratch, following established ecosystem patterns exactly.

---

## Scope

**In scope:**
- `execute_code` tool (Python, Node, Bash) with subprocess sandbox
- Output capture + head/tail truncation
- Timeout enforcement (SIGTERM → SIGKILL cascade)
- Stripped environment (no API keys leak to spawned code)
- Forbidden path validation for working_dir
- Artifact detection (directory before/after diff)
- JSONL execution logging
- Thinker tool-selector integration (`codexec` group)
- loop.ts retry fix (reduce maxSteps + bump temp on first retry)
- Unit tests

**Out of scope (future phases):**
- Sessions (Phase 2), Script library (Phase 3), Packages (Phase 4), Docker (Phase 5), Log querying tools (Phase 6)

---

## File Plan

### New Files — CodeExec-MCP/ (15 files)

| # | File | Purpose |
|---|------|---------|
| 1 | `package.json` | Manifest with `"annabelle": { "mcpName": "codexec", "transport": "stdio", "sensitive": true }` |
| 2 | `tsconfig.json` | Extends `../tsconfig.base.json`, outDir `./dist`, rootDir `./src` |
| 3 | `vitest.config.ts` | Extends `../vitest.base.ts`, `fileParallelism: false` (subprocess tests) |
| 4 | `.env.example` | Documents all Phase 1 env vars with defaults |
| 5 | `src/index.ts` | Entry point: dotenv, ensure dirs, create server, StdioServerTransport |
| 6 | `src/server.ts` | McpServer + registerTool for `execute_code` |
| 7 | `src/config.ts` | Zod-validated env config, forbidden paths, `getStrippedEnv()` |
| 8 | `src/executor/types.ts` | `ExecutionRequest`, `ExecutionResult` interfaces |
| 9 | `src/executor/subprocess.ts` | Core: spawn process, timeout cascade, capture output, artifact diff |
| 10 | `src/utils/id-generator.ts` | `generateExecutionId()` → `exec_<12-char-hex>` via `crypto.randomUUID()` |
| 11 | `src/utils/output-truncate.ts` | Head+tail truncation with `[... truncated N chars ...]` separator |
| 12 | `src/utils/artifact-diff.ts` | `snapshotDir()` + `diffSnapshots()` for before/after file tracking |
| 13 | `src/logging/types.ts` | `ExecutionLogEntry` interface |
| 14 | `src/logging/writer.ts` | Append JSONL to `executions-YYYY-MM-DD.jsonl` |
| 15 | `src/tools/execute-code.ts` | Zod schema, handler: validate working_dir, clamp timeout, call executor, log |

### Modified Files (2 files)

| File | Change |
|------|--------|
| `Thinker/src/agent/tool-selector.ts` | Add `codexec: ['codexec_*']` group + keyword route |
| `Thinker/src/agent/loop.ts` | First retry: `maxSteps: 4` + `temperature + 0.1`. Second retry: same. |

---

## Implementation Steps

### Step 1: Scaffolding
Create `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`.
- No `nanoid` dependency — use `crypto.randomUUID()` instead
- `sensitive: true` in manifest so Guardian pre-scans code before execution

### Step 2: Config (`src/config.ts`)
- Zod schema with defaults for all env vars (timeouts, paths, output limits)
- `expandHome()` for `~` expansion
- `FORBIDDEN_PATHS` array: `~/.ssh/`, `~/.gnupg/`, `~/.aws/`, `~/.config/`, `~/.annabelle/data/`, `/etc/`, `/var/`
- `isForbiddenPath(path)` — checks if resolved absolute path starts with any forbidden prefix
- `ENV_ALLOWLIST`: `['PATH', 'HOME', 'LANG', 'TERM', 'TMPDIR', 'USER']`
- `getStrippedEnv()` — filters `process.env` to only allowlist keys

### Step 3: Utilities (3 files, no internal deps)
- **id-generator.ts**: `exec_` + 12 hex chars from `crypto.randomUUID()`
- **output-truncate.ts**: If over limit, keep first `head` chars + separator + last `tail` chars
- **artifact-diff.ts**: Shallow `readdir` + `stat` to build `Map<filename, {size, mtimeMs}>`, then diff two maps → `{created, modified, deleted}`

### Step 4: Logging (`src/logging/`)
- **types.ts**: `ExecutionLogEntry` with all fields from README spec
- **writer.ts**: `logExecution()` — ensure dir, compute daily filename, `appendFile` JSON line

### Step 5: Executor (`src/executor/subprocess.ts`)
This is the core — the subprocess sandbox:
1. Generate execution ID
2. Create sandbox working dir (`sandboxDir/exec_id`) if no custom working_dir
3. Snapshot dir (before)
4. Write code to temp file (`_codexec_script.{py,mjs,sh}`)
5. Spawn with: `cwd`, `env: getStrippedEnv()`, `stdio: ['pipe','pipe','pipe']`
   - Python: `['python3', '_codexec_script.py']`
   - Node: `['node', '_codexec_script.mjs']`
   - Bash: `['bash', '_codexec_script.sh']`
6. Collect stdout/stderr chunks
7. Timeout: SIGTERM → 5s grace → SIGKILL
8. On close: get exit code
9. Truncate output (head+tail)
10. Snapshot dir (after), diff, filter out `_codexec_script.*`
11. Clean up temp script file
12. Return `ExecutionResult`

### Step 6: Tool (`src/tools/execute-code.ts`)
- Zod schema: `language` (enum), `code` (string, min 1), `timeout_ms` (optional), `working_dir` (optional)
- Handler: validate/expand working_dir, check forbidden paths, clamp timeout, call executor, log execution, return result

### Step 7: Server + Entry Point
- **server.ts**: `createServer()` returns McpServer with one registered tool
  - Annotations: `destructiveHint: true`, `openWorldHint: true`
- **index.ts**: Load dotenv, get config, ensure sandbox+log dirs, connect StdioServerTransport

### Step 8: Install + Build
```bash
cd CodeExec-MCP && npm install && npm run build
```

### Step 9: Unit Tests (`tests/unit/execute-code.test.ts`)
Test the executor directly (not through MCP server):
1. Python hello world → stdout, exit_code 0
2. Node hello world → stdout, exit_code 0
3. Bash hello world → stdout, exit_code 0
4. Python syntax error → exit_code != 0, stderr has error
5. Timeout enforcement → `time.sleep(60)` with 1s timeout → `timed_out: true`
6. Output truncation → 20k chars output → truncated
7. Stripped env → HOME exists, GROQ_API_KEY does not
8. Forbidden path → working_dir `~/.ssh/` → throws
9. Artifact detection → code creates file → `artifacts.created` has it

### Step 10: MCP Integration Test (`tests/integration/mcp-protocol.test.ts`)
Spawn CodeExec as a child process via stdio, send JSON-RPC `tools/call` messages, verify responses:
1. Call `execute_code` with Python `print("hello")` → verify response has `stdout: "hello"`, `exit_code: 0`, correct MCP content structure
2. Call `execute_code` with invalid language → verify error response
3. Call `execute_code` with forbidden working_dir → verify rejection
4. Verify `tools/list` returns `execute_code` with correct schema

### Step 11: Thinker Changes

**tool-selector.ts** — two additions:
```typescript
// In TOOL_GROUPS (after 'jobs'):
codexec: ['codexec_*'],

// In KEYWORD_ROUTES (before 'jobs' route):
{ pattern: /\bcode\b|script|execute|python|node\.?js|bash|calculate|compute|program/i,
  groups: ['codexec'] },
```
Note: Using `\bcode\b` (word boundary) to avoid matching "barcode", "zip code", etc.

**loop.ts** — lines 468-479, first retry block:
```typescript
// Before: maxSteps: 8, temperature: this.config.temperature
// After:  maxSteps: 4, temperature: Math.min((this.config.temperature ?? 0.7) + 0.1, 1.0)
```
Also update the rephrased retry (lines 492-501) to use `maxSteps: 4`.

Rationale: Retrying with identical params on malformed JSON is wasteful — same input likely produces same malformed output. Reducing maxSteps and nudging temperature gives the model a different path.

### Step 12: Verification
1. `cd CodeExec-MCP && npx tsc --noEmit` — type check
2. `cd CodeExec-MCP && npx vitest run` — run tests
3. `cd Thinker && npx tsc --noEmit` — type check Thinker changes
4. Full rebuild: `./rebuild.sh` — verify CodeExec auto-discovered and builds

---

## Key Design Decisions

1. **No barrel exports for executor/** — only `subprocess.ts` exists. Add `factory.ts` + `docker.ts` + `index.ts` when Phase 5 arrives. No premature abstraction.
2. **No tools/index.ts barrel** — only one tool. Direct import in server.ts is cleaner.
3. **`sensitive: true`** in manifest — Guardian wraps `execute_code` for pre/post scanning at Orchestrator level. No Guardian code inside CodeExec.
4. **Tool naming**: Orchestrator uses `alwaysPrefix: true, separator: '_'` → tool exposed as `codexec_execute_code`.
5. **No sandbox cleanup timer** — agents may reference artifacts. Cleanup deferred to Phase 6 with log retention.
6. **No HTTP transport** — stdio only, spawned by Orchestrator.
7. **`crypto.randomUUID()`** over `nanoid` — one fewer dependency.
