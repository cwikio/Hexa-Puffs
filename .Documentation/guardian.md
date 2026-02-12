# Guardian Integration

Guardian is the security layer of the Annabelle MCP ecosystem. It operates as a **transparent decorator** inside the Orchestrator — wrapping downstream MCP clients so that tool inputs and outputs are scanned for prompt injection, social engineering, and other threats before they reach (or leave) a target MCP.

This document covers how Guardian integrates with the Orchestrator, how scanning is configured, and how it affects tool execution across the system. For Guardian's own setup, provider selection, and tool schemas, see [Guardian/README.md](../Guardian/README.md).

---

## Initialization

Guardian is always the **first MCP initialized** during Orchestrator startup. This is a hard requirement: other MCPs may be wrapped with `GuardedMCPClient`, which needs the Guardian scanner to exist before they are registered.

**Sequence:**

1. Orchestrator reads stdio MCP configs from auto-discovery
2. Guardian is identified by `role: "guardian"` in its `package.json` manifest:
   ```json
   "annabelle": {
     "mcpName": "guardian",
     "transport": "stdio",
     "role": "guardian"
   }
   ```
3. Guardian's `StdioMCPClient` is created and stored
4. If `guardianConfig.enabled` is `true`, a `StdioGuardianClient` adapter wraps it
5. All other MCPs are then created and optionally wrapped via `maybeGuard()`

**Source:** [orchestrator.ts:97-128](../Orchestrator/src/core/orchestrator.ts#L97-L128)

### Not exposed in ToolRouter

Guardian is **not registered** with the Orchestrator's `ToolRouter`. It has no passthrough tools visible to Thinker or Claude. It is used exclusively via `StdioGuardianClient` for internal scanning. Health checks still run on Guardian, and if it crashes, the Orchestrator will attempt to restart it — but it is never re-registered with the ToolRouter.

**Source:** [orchestrator.ts:259-282](../Orchestrator/src/core/orchestrator.ts#L259-L282)

---

## Scanning Flow

When a caller (Thinker/Claude) invokes a tool on a guarded MCP, scanning happens at two stages:

```
Thinker / Claude
  │
  │  callTool(name, args)
  ▼
GuardedMCPClient
  │
  ├── [1] INPUT SCAN (if scanInput: true)
  │     │
  │     ├── JSON.stringify(args) → Guardian scan_content
  │     │
  │     ├── allowed?  YES → continue
  │     └── allowed?  NO  → throw SecurityError (tool never executes)
  │
  ├── [2] EXECUTE tool on downstream MCP
  │     │
  │     └── result ← downstream MCP
  │
  ├── [3] OUTPUT SCAN (if scanOutput: true && result.success)
  │     │
  │     ├── JSON.stringify(result.content) → Guardian scan_content
  │     │
  │     ├── allowed?  YES → return result
  │     └── allowed?  NO  → throw SecurityError (result discarded)
  │
  ▼
Result returned to caller (or SecurityError thrown)
```

**Source:** [guarded-client.ts](../Orchestrator/src/mcp-clients/guarded-client.ts)

### What gets scanned

- **Input scan:** The tool's `arguments` object, JSON-stringified. Guardian recursively extracts all text fields from nested structures.
- **Output scan:** The tool's response `content`, JSON-stringified. Only runs when the tool call succeeded (`result.success === true`).

Guardian's `scan_content` tool handles strings, objects, and arrays. It reports threats with exact JSON paths (e.g., `emails[0].subject`).

---

## The GuardedMCPClient Decorator

`GuardedMCPClient` implements `IMCPClient` and wraps any MCP client transparently. The ToolRouter sees it as a normal MCP — no routing changes are needed.

```typescript
class GuardedMCPClient implements IMCPClient {
  constructor(
    private inner: IMCPClient,           // The real MCP
    private guardian: StdioGuardianClient, // Scanner adapter
    private options: GuardedClientOptions  // { scanInput, scanOutput, failMode }
  ) {}

  // All IMCPClient properties delegate to inner
  get name() { return this.inner.name; }
  get isAvailable() { return this.inner.isAvailable; }

  async callTool(toolCall) {
    if (this.options.scanInput) await this.scanInputArgs(toolCall);
    const result = await this.inner.callTool(toolCall);
    if (this.options.scanOutput && result.success) await this.scanOutputContent(...);
    return result;
  }
}
```

### How `maybeGuard()` decides

The Orchestrator's `maybeGuard(mcpName, client)` method determines whether to wrap an MCP:

1. If `guardianScanner` is null (Guardian disabled or missing) → return raw client
2. Look up `guardianConfig.input[mcpName]` and `guardianConfig.output[mcpName]`
3. If MCP is not listed, fall back to `defaultInput` / `defaultOutput`
4. If both input and output are `false` → return raw client (no wrapping)
5. Otherwise → return `new GuardedMCPClient(client, guardianScanner, { scanInput, scanOutput, failMode })`

**Source:** [orchestrator.ts:135-150](../Orchestrator/src/core/orchestrator.ts#L135-L150)

---

## Scanning Configuration

All scanning behavior is controlled by a single config file.

**File:** [Orchestrator/src/config/guardian.ts](../Orchestrator/src/config/guardian.ts)

### Global settings

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `true` | Master kill switch for all Guardian scanning |
| `failMode` | `'closed'` | Behavior when Guardian MCP is unavailable |
| `defaultInput` | `true` | Scan inputs for MCPs not explicitly listed |
| `defaultOutput` | `true` | Scan outputs for MCPs not explicitly listed |

### Per-MCP input scanning

Controls whether tool **arguments** are scanned before reaching the target MCP.

| MCP | Input Scan | Rationale |
|-----|-----------|-----------|
| `telegram` | `false` | Outgoing messages are composed by the AI, low injection risk |
| `onepassword` | `true` | Prevent injection via credential lookup queries |
| `memory` | `true` | Protect stored facts from injected content |
| `filer` | `true` | File paths and content could carry injection payloads |
| `searcher` | `false` | Search queries are low-risk, high-volume |
| `gmail` | `true` | Email drafts could contain forwarded injections |
| `codexec` | `true` | Code execution arguments are high-risk |

### Per-MCP output scanning

Controls whether tool **results** are scanned before being returned to the caller.

| MCP | Output Scan | Rationale |
|-----|------------|-----------|
| `telegram` | `false` | Messages are read-only echoes, low risk |
| `onepassword` | `false` | Read-only credential data, trusted source |
| `memory` | `false` | Facts are internally managed, trusted |
| `filer` | `true` | File contents from disk could contain embedded injections |
| `searcher` | `true` | Web results are untrusted external content |
| `gmail` | `true` | Inbound emails are the primary prompt injection vector |
| `codexec` | `false` | Execution output is a direct consequence of scanned input |

### Defaults for unknown MCPs

When a new MCP is auto-discovered or hot-reloaded (via `external-mcps.json`), it won't have an explicit entry in the config. The defaults apply:

- **Input:** `defaultInput: true` — arguments sent to the new MCP are scanned
- **Output:** `defaultOutput: true` — responses from the new MCP are scanned before reaching Thinker/Claude

Unknown MCPs are untrusted by default. Both directions are scanned to protect Annabelle from malicious content flowing in from external tools and to prevent injected content from reaching downstream MCPs.

### Per-agent overrides

The `agentOverrides` map allows different scanning profiles per Thinker agent:

```typescript
agentOverrides: {
  'code-review': {
    input: { codexec: true },
    output: { codexec: true },  // Stricter: also scan code output
  },
  'casual-chat': {
    input: { memory: false },   // Relaxed: skip memory input scans
  },
}
```

Resolution uses `getEffectiveScanFlags(agentId)`:
1. Start with global `input` / `output` maps
2. If `agentId` has an override, merge it on top (`Object.assign`)
3. Return the effective flags

**Source:** [guardian.ts:92-111](../Orchestrator/src/config/guardian.ts#L92-L111)

---

## Fail Modes

When Guardian MCP is unavailable (crashed, not started, or returning errors), the `failMode` setting determines behavior:

### `'closed'` (default — secure)

All tool calls to guarded MCPs are **blocked**. The system returns:

```typescript
{ allowed: false, risk: 'high', reason: 'Guardian MCP unavailable - blocking in fail-closed mode' }
```

This is the secure default: if the security layer is down, nothing gets through.

### `'open'` (availability-first)

All tool calls to guarded MCPs are **allowed without scanning**. The system returns:

```typescript
{ allowed: true, risk: 'none', reason: 'Guardian MCP unavailable - allowing in fail-open mode' }
```

Use this when availability is more important than security (e.g., during Guardian model updates).

### When fail mode triggers

Fail mode applies in three scenarios:
1. Guardian MCP process is not running (`isAvailable: false`)
2. Guardian's `scan_content` tool call fails (`result.success: false`)
3. Guardian throws an exception during scanning

**Source:** [guardian-types.ts:81-98](../Orchestrator/src/mcp-clients/guardian-types.ts#L81-L98)

---

## Risk Level Derivation

Guardian returns `safe` (boolean) and `confidence` (0.0–1.0). The Orchestrator maps these to a risk level:

```typescript
function deriveRisk(safe, confidence, threatCount): 'none' | 'low' | 'medium' | 'high' {
  if (safe && threatCount === 0)   return 'none';
  if (!safe && confidence > 0.8)   return 'high';
  if (!safe && confidence > 0.5)   return 'medium';
  if (!safe)                       return 'low';
  if (confidence < 0.5)            return 'low';
  return 'none';
}
```

All three Guardian providers (Groq Llama Guard, Groq Safeguard, Ollama) return a confidence of **0.95**, so in practice unsafe content is always classified as `high` risk.

**Source:** [guardian-types.ts:42-49](../Orchestrator/src/mcp-clients/guardian-types.ts#L42-L49)

---

## SecurityError Propagation

When Guardian blocks content, `GuardedMCPClient` throws a `SecurityError`:

```typescript
throw new SecurityError(
  'Input blocked by Guardian: Detected prompt injection attempt',
  {
    tool: 'gmail_send_email',
    mcp: 'gmail',
    risk: 'high',
    threats: ['prompt_injection'],
  }
);
```

This error propagates to the caller (Thinker/Claude). The downstream MCP **never sees** the blocked request. For output blocks, the MCP has already executed, but its result is discarded before reaching the caller.

---

## Threat Types

Guardian normalizes threat types across all three providers into a standard set:

| Threat Type | Description |
|-------------|-------------|
| `prompt_injection` | Hidden instructions attempting to hijack AI behavior |
| `jailbreak` | Attempts to bypass safety guidelines |
| `harmful_content` | Violence, weapons, exploitation, illegal content |
| `social_engineering` | Impersonation, phishing, CEO fraud, manipulation |
| `data_exfiltration` | Attempts to extract secrets, credentials, personal data |
| `privilege_escalation` | Attempts to gain elevated access |
| `code_execution` | Embedded code/command execution attempts |
| `malicious_content` | General fallback for unclassified threats |
| `scan_error` | Internal error during scanning (fail-closed) |

---

## External MCPs

External MCPs added via `external-mcps.json` (see [external-mcp.md](./external-mcp.md)) receive the same Guardian treatment as built-in MCPs:

1. When an external MCP is hot-reloaded, `maybeGuard()` is called on it
2. Since external MCPs are typically not listed in the config, they get the **defaults**:
   - Input scanning: `true` (via `defaultInput`)
   - Output scanning: `true` (via `defaultOutput`)
3. Both directions are scanned because external MCPs are untrusted — their responses could contain prompt injections targeting Thinker/Claude
4. To relax scanning for a trusted external MCP, add its name to the `input` and/or `output` maps in `guardian.ts`

**Source:** [orchestrator.ts:849](../Orchestrator/src/core/orchestrator.ts#L849)

---

## Health Monitoring

Guardian participates in the Orchestrator's periodic health check cycle:

- Health checks run on all stdio clients, including Guardian
- If Guardian fails a health check, the Orchestrator attempts an automatic restart
- A restarted Guardian is **not** re-registered with the ToolRouter (it's internal)
- While Guardian is down, the `failMode` governs behavior for all guarded MCPs

**Source:** [orchestrator.ts:253-293](../Orchestrator/src/core/orchestrator.ts#L253-L293)

---

## Slash Commands

The `/security` slash command provides runtime visibility into Guardian's status:

### `/security`

Shows Guardian configuration and availability:

```
Guardian Security
Status: enabled | Fail mode: closed
Guardian MCP: available

Input scanning:
  telegram: off | onepassword: on | memory: on | filer: on | searcher: off | gmail: on | codexec: on

Output scanning:
  telegram: off | onepassword: off | memory: off | filer: on | searcher: on | gmail: on | codexec: off
```

Also displays total scan counts and threat statistics when available.

### `/security N`

Shows the last N security threats (default: 10). Pulls from Guardian's audit log via the `get_scan_log` tool with `threats_only: true`.

**Source:** [slash-commands.ts:999-1070](../Orchestrator/src/commands/slash-commands.ts#L999-L1070)

---

## Audit Logging

Guardian maintains its own JSONL audit log at `Guardian/logs/audit.jsonl`. Each scan is logged with:

- `scan_id` — UUID for tracing
- `content_hash` — SHA256 truncated to 16 hex chars (content is never stored raw)
- `safe`, `confidence`, `threats` — scan results
- `model` — which provider handled the scan
- `latency_ms` — response time

The Orchestrator queries this log via the `get_scan_log` tool for `/security` and `/status summary` commands.

For full details on log format and rotation, see [logging.md](./logging.md).

---

## Configuration Reference

| Knob | Location | Default | Description |
|------|----------|---------|-------------|
| `enabled` | `guardianConfig.enabled` | `true` | Master kill switch |
| `failMode` | `guardianConfig.failMode` | `'closed'` | Behavior when Guardian is down |
| `defaultInput` | `guardianConfig.defaultInput` | `true` | Input scan default for unlisted MCPs |
| `defaultOutput` | `guardianConfig.defaultOutput` | `true` | Output scan default for unlisted MCPs |
| `input[mcpName]` | `guardianConfig.input` | per-MCP | Input scan flag per named MCP |
| `output[mcpName]` | `guardianConfig.output` | per-MCP | Output scan flag per named MCP |
| `agentOverrides[id]` | `guardianConfig.agentOverrides` | `{}` | Per-agent scanning overrides |
| `GUARDIAN_MCP_ENABLED` | Environment | `true` | Disable Guardian MCP process entirely |
| `GUARDIAN_MCP_TIMEOUT` | Environment | default | Override stdio timeout for Guardian |

### Disabling Guardian

**Disable scanning but keep Guardian running:**
```typescript
// In Orchestrator/src/config/guardian.ts
enabled: false,
```

**Disable Guardian MCP process entirely:**
```bash
GUARDIAN_MCP_ENABLED=false
```

**Disable scanning for a specific MCP:**
```typescript
input: {
  telegram: false,
},
output: {
  telegram: false,
},
```
