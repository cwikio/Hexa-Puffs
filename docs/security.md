# Security Architecture

Hexa Puffs employs defense-in-depth across four layers:

1. **Guardian** — Prompt injection and content scanning (transparent decorator on MCP clients)
2. **Tool Policies** — Per-agent allow/deny lists controlling which tools an agent can call
3. **Destructive Tool Blocking** — Automatic blocking of delete/remove/destroy operations unless explicitly allowed
4. **Cost Controls** — Anomaly-based token spike detection with auto-pause to limit blast radius of runaway agents

Each layer operates independently. Guardian scans content for threats; tool policies restrict access; destructive blocking prevents dangerous operations; cost controls cap resource consumption. Together they ensure that even if one layer is misconfigured, the others still provide protection.

---

## Guardian Integration

Guardian is the security scanning layer. It operates as a **transparent decorator** inside the Orchestrator — wrapping downstream MCP clients so that tool inputs and outputs are scanned for prompt injection, social engineering, and other threats before they reach (or leave) a target MCP.

For Guardian's own setup, provider selection, and tool schemas, see [Guardian/README.md](../Guardian/README.md).

### Initialization

Guardian is always the **first MCP initialized** during Orchestrator startup. This is a hard requirement: other MCPs may be wrapped with `GuardedMCPClient`, which needs the Guardian scanner to exist before they are registered.

**Sequence:**

1. Orchestrator reads stdio MCP configs from auto-discovery
2. Guardian is identified by `role: "guardian"` in its `package.json` manifest:
   ```json
   "hexa-puffs": {
     "mcpName": "guardian",
     "transport": "stdio",
     "role": "guardian"
   }
   ```
3. Guardian's `StdioMCPClient` is created and stored
4. If `guardianConfig.enabled` is `true`, a `StdioGuardianClient` adapter wraps it
5. All other MCPs are then created and optionally wrapped via `maybeGuard()`

**Source:** [orchestrator.ts:97-128](../Orchestrator/src/core/orchestrator.ts#L97-L128)

#### Not exposed in ToolRouter

Guardian is **not registered** with the Orchestrator's `ToolRouter`. It has no passthrough tools visible to Thinker or Claude. It is used exclusively via `StdioGuardianClient` for internal scanning. Health checks still run on Guardian, and if it crashes, the Orchestrator will attempt to restart it — but it is never re-registered with the ToolRouter.

**Source:** [orchestrator.ts:259-282](../Orchestrator/src/core/orchestrator.ts#L259-L282)

---

### Scanning Flow

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

#### What gets scanned

- **Input scan:** The tool's `arguments` object, JSON-stringified. Guardian recursively extracts all text fields from nested structures.
- **Output scan:** The tool's response `content`, JSON-stringified. Only runs when the tool call succeeded (`result.success === true`).

Guardian's `scan_content` tool handles strings, objects, and arrays. It reports threats with exact JSON paths (e.g., `emails[0].subject`).

---

### The GuardedMCPClient Decorator

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

#### How `maybeGuard()` decides

The Orchestrator's `maybeGuard(mcpName, client)` method determines whether to wrap an MCP:

1. If `guardianScanner` is null (Guardian disabled or missing) → return raw client
2. Look up scan flags from the MCP's `package.json` manifest (`guardianScan` field) or fall back to `guardianConfig.input[mcpName]` / `guardianConfig.output[mcpName]`
3. If MCP is not listed anywhere, fall back to `defaultInput` / `defaultOutput`
4. If both input and output are `false` → return raw client (no wrapping)
5. Otherwise → return `new GuardedMCPClient(client, guardianScanner, { scanInput, scanOutput, failMode })`

**Source:** [orchestrator.ts:135-150](../Orchestrator/src/core/orchestrator.ts#L135-L150)

#### Declaring `guardianScan` in MCP manifests

Per-MCP scanning is now configured in each MCP's `package.json` via the `guardianScan` field:

```json
{
  "hexa-puffs": {
    "mcpName": "gmail",
    "guardianScan": {
      "input": true,
      "output": true
    }
  }
}
```

MCPs without this field inherit the global defaults (`defaultInput` / `defaultOutput`). The `guardianConfig.input` / `guardianConfig.output` maps in `guardian.ts` serve as legacy overrides.

---

### Scanning Configuration

All scanning behavior is controlled by a single config file.

**File:** [Orchestrator/src/config/guardian.ts](../Orchestrator/src/config/guardian.ts)

#### Global settings

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `true` | Master kill switch for all Guardian scanning |
| `failMode` | `'closed'` | Behavior when Guardian MCP is unavailable |
| `defaultInput` | `true` | Scan inputs for MCPs not explicitly listed |
| `defaultOutput` | `true` | Scan outputs for MCPs not explicitly listed |

#### Per-MCP scanning configuration

Per-MCP scanning is configured in each MCP's `package.json` manifest via the `guardianScan` field (see [Declaring `guardianScan` in MCP manifests](#declaring-guardianscan-in-mcp-manifests) above). The `guardianConfig.input` and `guardianConfig.output` maps in `guardian.ts` serve as legacy overrides but are currently empty — all per-MCP config lives in manifests.

MCPs without a `guardianScan` field inherit the global defaults (`defaultInput: true`, `defaultOutput: true`).

#### Defaults for unknown MCPs

When a new MCP is auto-discovered or hot-reloaded (via `external-mcps.json`), it won't have an explicit entry in the config. The defaults apply:

- **Input:** `defaultInput: true` — arguments sent to the new MCP are scanned
- **Output:** `defaultOutput: true` — responses from the new MCP are scanned before reaching Thinker/Claude

Unknown MCPs are untrusted by default. Both directions are scanned to protect Hexa Puffs from malicious content flowing in from external tools and to prevent injected content from reaching downstream MCPs.

#### Per-agent overrides

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

**Source:** [guardian.ts:80-99](../Orchestrator/src/config/guardian.ts#L80-L99)

---

### Fail Modes

When Guardian MCP is unavailable (crashed, not started, or returning errors), the `failMode` setting determines behavior:

#### `'closed'` (default — secure)

All tool calls to guarded MCPs are **blocked**. The system returns:

```typescript
{ allowed: false, risk: 'high', reason: 'Guardian MCP unavailable - blocking in fail-closed mode' }
```

This is the secure default: if the security layer is down, nothing gets through.

#### `'open'` (availability-first)

All tool calls to guarded MCPs are **allowed without scanning**. The system returns:

```typescript
{ allowed: true, risk: 'none', reason: 'Guardian MCP unavailable - allowing in fail-open mode' }
```

Use this when availability is more important than security (e.g., during Guardian model updates).

#### When fail mode triggers

Fail mode applies in three scenarios:
1. Guardian MCP process is not running (`isAvailable: false`)
2. Guardian's `scan_content` tool call fails (`result.success: false`)
3. Guardian throws an exception during scanning

**Source:** [guardian-types.ts:81-98](../Orchestrator/src/mcp-clients/guardian-types.ts#L81-L98)

---

### Risk Level Derivation

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

### SecurityError Propagation

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

`SecurityError` extends `OrchestratorError` with code `SECURITY_ERROR`. It propagates to the caller (Thinker/Claude). The downstream MCP **never sees** the blocked request. For output blocks, the MCP has already executed, but its result is discarded before reaching the caller.

**Source:** [errors.ts:18-23](../Orchestrator/src/utils/errors.ts#L18-L23)

---

### Threat Types

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

### External MCPs

External MCPs added via `external-mcps.json` (see [external-mcp.md](./external-mcp.md)) receive the same Guardian treatment as built-in MCPs:

1. When an external MCP is hot-reloaded, `maybeGuard()` is called on it
2. Since external MCPs are typically not listed in the config, they get the **defaults**:
   - Input scanning: `true` (via `defaultInput`)
   - Output scanning: `true` (via `defaultOutput`)
3. Both directions are scanned because external MCPs are untrusted — their responses could contain prompt injections targeting Thinker/Claude
4. To relax scanning for a trusted external MCP, add a `guardianScan` field to its config or add its name to the `input` and/or `output` maps in `guardian.ts`

**Source:** [orchestrator.ts:849](../Orchestrator/src/core/orchestrator.ts#L849)

---

### Health Monitoring

Guardian participates in the Orchestrator's periodic health check cycle:

- Health checks run on all stdio clients, including Guardian
- If Guardian fails a health check, the Orchestrator attempts an automatic restart
- A restarted Guardian is **not** re-registered with the ToolRouter (it's internal)
- While Guardian is down, the `failMode` governs behavior for all guarded MCPs

**Source:** [orchestrator.ts:253-293](../Orchestrator/src/core/orchestrator.ts#L253-L293)

---

### Slash Commands

The `/security` slash command provides runtime visibility into Guardian's status:

#### `/security`

Shows Guardian configuration and availability:

```
Guardian Security
Status: enabled | Fail mode: closed
Guardian MCP: available

Default scanning: input=on, output=on
Per-MCP overrides from manifests (guardianScan field)
```

Also displays total scan counts and threat statistics when available.

#### `/security N`

Shows the last N security threats (default: 10). Pulls from Guardian's audit log via the `get_scan_log` tool with `threats_only: true`.

**Source:** [slash-commands.ts:999-1070](../Orchestrator/src/commands/slash-commands.ts#L999-L1070)

---

### Audit Logging

Guardian maintains its own JSONL audit log at `Guardian/logs/audit.jsonl`. Each scan is logged with:

- `scan_id` — UUID for tracing
- `content_hash` — SHA-256 truncated to 16 hex chars (content is never stored raw)
- `safe`, `confidence`, `threats` — scan results
- `model` — which provider handled the scan
- `latency_ms` — response time

The content hashing ensures raw scanned content is never persisted to disk, protecting user privacy even in audit logs.

The Orchestrator queries this log via the `get_scan_log` tool for `/security` and `/status summary` commands.

For full details on log format and rotation, see [logging.md](./logging.md).

---

### Guardian Configuration Reference

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

#### Disabling Guardian

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

---

## Tool Policies

Per-agent tool access control via glob-based allow/deny lists. This layer is independent of Guardian — it restricts **which tools** an agent can call, while Guardian scans the **content** of those calls.

### How it works

Each agent in `agents.json` can declare `allowedTools` and `deniedTools` arrays. When the Orchestrator spawns a Thinker agent, these lists are used to filter which tools are visible and callable:

```json
{
  "agentId": "research-assistant",
  "allowedTools": ["web_search", "news_search", "store_fact", "retrieve_memories"],
  "deniedTools": []
}
```

### Resolution logic

1. If `allowedTools` is empty → all tools are allowed (no allowlist filtering)
2. If `allowedTools` is non-empty → only tools matching at least one pattern are allowed
3. `deniedTools` is evaluated **after** `allowedTools` — deny always wins
4. Both lists support glob patterns via `*` wildcard

### Glob pattern examples

| Pattern | Matches |
|---------|---------|
| `*` | All tools |
| `telegram_*` | `telegram_send_message`, `telegram_get_messages`, etc. |
| `*_search` | `web_search`, `news_search`, `search_messages` |
| `store_*` | `store_fact`, `store_conversation`, `store_skill` |

### Use cases

**Restrict an agent to communication only:**
```json
{
  "allowedTools": ["send_message", "get_messages", "send_email", "list_emails", "get_email", "reply_email"],
  "deniedTools": []
}
```

**Allow everything except file operations:**
```json
{
  "allowedTools": [],
  "deniedTools": ["create_file", "update_file", "delete_file", "move_file", "copy_file"]
}
```

**Allow everything except destructive operations (belt-and-suspenders with destructive blocking):**
```json
{
  "allowedTools": [],
  "deniedTools": ["*delete*", "*remove*", "*destroy*"]
}
```

### Enforcement points

- **Tool listing:** `getFilteredToolDefinitions(allowedTools, deniedTools)` returns only tools the agent is permitted to see. The agent's LLM never learns about restricted tools.
- **Tool calls:** `isToolAllowed(toolName, allowedTools, deniedTools)` checks before routing. Even if an agent somehow names a restricted tool, the call is rejected.

**Source:** [tool-router.ts:432-468](../Orchestrator/src/routing/tool-router.ts#L432-L468)

---

## Destructive Tool Blocking

The ToolRouter automatically blocks tools whose names match a destructive pattern (`delete`, `remove`, `destroy`) unless the MCP's manifest explicitly opts in via `allowDestructiveTools: true`.

### How it works

During tool discovery, the ToolRouter checks each tool name against:
```typescript
/^(.*_)?(delete|remove|destroy)(_.*)?$/i
```

If matched, the tool is only registered in the public route table when the source MCP's metadata has `allowDestructiveTools: true`. Otherwise it's blocked from the agent-facing routes but still available via `routeToolCallPrivileged()` for trusted internal callers (slash commands).

### Configuring per-MCP

In the MCP's `package.json` manifest:
```json
{
  "hexa-puffs": {
    "mcpName": "filer",
    "allowDestructiveTools": true
  }
}
```

### Privileged bypass

Slash commands and other trusted internal callers use `routeToolCallPrivileged()` which routes through `allRoutes` (includes blocked tools). This allows admin operations like `/delete` without exposing destructive tools to the AI agent.

**Source:** [tool-router.ts:271-300](../Orchestrator/src/routing/tool-router.ts#L271-L300), [tool-router.ts:539-560](../Orchestrator/src/routing/tool-router.ts#L539-L560)

---

## Cost Controls

Anomaly-based token consumption monitoring that acts as a security safety net against runaway agents. Detects unusual LLM usage via spike detection and hard caps, automatically pausing agents and sending Telegram alerts.

This is a security feature because a compromised or looping agent could cause unbounded API costs and execute an unbounded number of tool calls.

### Summary

1. Orchestrator reads `costControls` from `agents.json` and injects them as env vars when spawning Thinker
2. Thinker's `CostMonitor` records token usage after every LLM call
3. If a threshold fires (spike or hard cap), Thinker returns `{ paused: true }` to Orchestrator
4. Orchestrator marks the agent as paused, blocks future messages, and sends a Telegram alert
5. Admin resumes via `POST /agents/{agentId}/resume`

### Thresholds

- **Hard cap** — Absolute token limit per rolling 60-minute window. Always active, no baseline needed.
- **Spike detection** — Compares short-window token rate against baseline rate. Only activates after the baseline accumulates `minimumBaselineTokens`. Uses a `minimumBaselineRate` floor to prevent false positives.

For full configuration, algorithm details, tuning guide, and API reference, see [cost-controls.md](./cost-controls.md).

---

## Error Hierarchy

Security-related errors follow a structured hierarchy:

```
BaseError (Shared)
  └── OrchestratorError
        ├── SecurityError         — Guardian blocks content (code: SECURITY_ERROR)
        ├── MCPClientError        — MCP communication failure
        │     └── MCPUnavailableError — MCP process not running
        ├── ToolExecutionError    — Tool call failed
        ├── ConfigurationError    — Bad config
        └── ValidationError       — Invalid input
```

`SecurityError` carries threat details in its `details` field:
```typescript
{
  tool: string;      // Which tool was blocked
  mcp: string;       // Which MCP it belongs to
  risk: 'high' | 'medium' | 'low';
  threats: string[]; // e.g. ['prompt_injection', 'social_engineering']
}
```

**Source:** [errors.ts](../Orchestrator/src/utils/errors.ts)
