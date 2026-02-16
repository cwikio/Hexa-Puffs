# Plan: MCP Spec Compliance + External MCP Integration

## Context

Evaluate whether Annabelle follows the latest MCP specification (2025-11-25), assess compatibility with external MCPs (PostHog, Vercel, Neon), and enable a "how are my apps?" workflow where Annabelle aggregates health/status across all connected services.

---

## Part 1: MCP Spec Compliance Audit

### What's Correct

| Area | Status | Details |
|------|--------|---------|
| **Stdio transport** | ✅ | All stdio MCPs use SDK's `StdioServerTransport` / `StdioClientTransport` correctly |
| **Tool annotations** | ✅ | All migrated MCPs use `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` |
| **Tool registration** | ✅ | `registerTool()` via shared wrapper + `McpServer` (SDK 1.25+) |
| **JSON-RPC format** | ✅ | SDK handles this internally |
| **Zod input validation** | ✅ | All tools validate with Zod schemas |

### What's Non-Compliant or Outdated

| Area | Issue | Severity |
|------|-------|----------|
| **HTTP+SSE transport** | Internal HTTP MCPs use the **deprecated** HTTP+SSE transport (spec 2024-11-05). The 2025-11-25 spec replaces it with **Streamable HTTP** | **High** — but solvable by converting all internal MCPs to stdio |
| **Custom REST endpoints** | HTTP MCPs expose non-standard `/tools/list` (GET) and `/tools/call` (POST). The spec defines NO such endpoints | **High** — eliminated by going stdio-only |
| **HttpMCPClient doesn't speak MCP** | `BaseMCPClient` uses raw `fetch()` to custom REST endpoints instead of SDK transport. Skips initialization, capability negotiation, protocol version exchange | **High** — replaced by SDK-based client for external MCPs |
| **SDK version** | Locked at `1.25.3` (declared `^1.0.0`). May not support Streamable HTTP transport | **Medium** |

### Summary

**Stdio MCPs are spec-compliant.** The SDK handles protocol negotiation internally. The non-compliant parts are all in the HTTP layer — which we can **eliminate for internal MCPs** (convert them all to stdio) and **build properly for external MCPs** (using SDK transport).

---

## Part 2: Why HTTP Exists & What to Do About It

### Current state

HTTP transport in Annabelle serves three purposes:

| Purpose | Needed? | Details |
|---------|---------|---------|
| **Orchestrator serves Thinker** (port 8010) | **Yes** | Thinker connects via REST/HTTP. This is the agent API, not MCP protocol — stays as-is |
| **Internal MCPs as HTTP services** (Searcher 8007, Gmail 8008, Telegram 8002, Filer 8004, Browser) | **No** | These are launched by `start-all.sh` with `TRANSPORT=http`. The Orchestrator already spawns stdio MCPs as child processes — these can all be converted to stdio |
| **dual-transport for debugging** (curl /tools/call) | **Nice to have** | Custom REST endpoints for testing. Not required — integration tests use SDK stdio client |

### Decision: Convert all internal MCPs to stdio, remove HTTP layer

- **Fewer processes:** 5 fewer standalone services to manage
- **Fewer ports:** Free up 8002, 8004, 8007, 8008
- **No custom protocol:** Eliminates all non-standard REST endpoints
- **Spec-compliant:** Stdio is a first-class MCP transport in the 2025-11-25 spec
- **Simpler `start-all.sh`:** Only Orchestrator + Inngest need to be launched; Orchestrator spawns all MCPs

**What we lose:** Ability to curl individual MCPs directly. Mitigated by integration tests and Orchestrator's tool router.

**What stays HTTP:** The Orchestrator's own HTTP server (port 8010) for Thinker. This is not MCP protocol — it's the agent dispatch API.

---

## Part 3: External MCP Integration

### All three external MCPs support stdio

| MCP | Stdio support | Command |
|-----|--------------|---------|
| **PostHog** | ✅ via npx | `npx -y @posthog/mcp` |
| **Vercel** | ✅ via npx | `npx -y vercel-mcp` (or `@vercel/mcp`) |
| **Neon** | ✅ via npx | `npx -y @neondatabase/mcp-server-neon` |

Since all three support stdio, and the Orchestrator already handles stdio MCPs perfectly, we don't need Streamable HTTP client support at all for this use case.

### Config: `~/.annabelle/external-mcps.json`

New config file for external MCPs (same format as Claude Desktop / Cursor):

```json
{
  "posthog": {
    "command": "npx",
    "args": ["-y", "@posthog/mcp"],
    "env": { "POSTHOG_API_KEY": "${POSTHOG_API_KEY}" }
  },
  "neon": {
    "command": "npx",
    "args": ["-y", "@neondatabase/mcp-server-neon"],
    "env": { "NEON_API_KEY": "${NEON_API_KEY}" }
  },
  "vercel": {
    "command": "npx",
    "args": ["-y", "vercel-mcp"],
    "env": { "VERCEL_TOKEN": "${VERCEL_TOKEN}" },
    "metadata": {
      "allowDestructiveTools": false
    }
  }
}
```

**Security Feature: Destructive Tool Blocking**

By default, external MCPs have destructive tools (delete, remove, destroy) **blocked** for safety. The Orchestrator will:
- Detect tools matching patterns: `*delete*`, `*remove*`, `*destroy*`
- Hide them from the agent unless explicitly allowed
- Notify on startup which tools were blocked

To enable destructive tools for a specific MCP, add `"allowDestructiveTools": true` to its metadata:

```json
{
  "vercel": {
    "command": "npx",
    "args": ["-y", "vercel-mcp"],
    "env": { "VERCEL_TOKEN": "${VERCEL_TOKEN}" },
    "metadata": {
      "allowDestructiveTools": true  // ⚠️ Allows vercel_deleteDeployment
    }
  }
}
```

The Orchestrator reads this at startup, spawns each via `StdioMCPClient`, discovers tools, prefixes them (`posthog_*`, `neon_*`, `vercel_*`), and routes calls through the existing `ToolRouter`. Identical to how internal MCPs work.

### Adding a new external MCP

1. Edit `~/.annabelle/external-mcps.json` — add a new entry with command/args/env
2. Set the env var (API key) in your shell or `.env`
3. Restart Orchestrator (or call a future `reload_external_mcps` tool)

Same UX as adding an MCP in Cursor — just a different JSON file.

---

## Part 4: "How Are My Apps?" Feature

Once external MCPs are connected, two approaches:

### Option A: Thinker Skill (simpler, no code changes)

Store a skill in Memorizer:
```
name: "System Health Check"
instructions: "Check the health of all connected services:
  1. Call get_status for internal MCP health
  2. Call vercel_list_deployments to check deployment statuses
  3. Call neon_list_projects to check database health
  4. Call posthog_list_errors for recent error rates
  Synthesize into a brief health report."
required_tools: ["vercel_*", "neon_*", "posthog_*", "get_status"]
trigger_type: "manual"
```

### Option B: Orchestrator `system_health_check` tool (more robust)

A dedicated tool that runs all checks in parallel and returns structured results. Better for cron-based monitoring.

### Recommendation: Start with Thinker skill, add dedicated tool later if needed.

---

## Part 5: Implementation Phases

### Phase 1 — Convert Internal HTTP MCPs to Stdio
1. Update `start-all.sh` to NOT launch Searcher, Gmail, Telegram, Filer, Browser as HTTP services
2. Update their `package.json` manifests: `"transport": "stdio"` (or remove transport field — stdio is default)
3. Orchestrator spawns them all via `StdioMCPClient`
4. Remove or deprecate `HttpMCPClient`, `BaseMCPClient`
5. Simplify `dual-transport.ts` — remove HTTP/SSE server code, keep stdio
6. Upgrade SDK to latest across all packages

### Phase 2 — Add External MCP Support
1. Create `~/.annabelle/external-mcps.json` config schema (Zod-validated)
2. Add loader in Orchestrator that reads config and creates `StdioMCPClient` for each
3. External MCPs get prefixed and routed like internal ones
4. Env var substitution for auth tokens (`${POSTHOG_API_KEY}` → actual value)

### Phase 3 — Health Aggregation
1. Register PostHog, Vercel, Neon MCPs with valid API keys
2. Create Thinker skill for "system health check"
3. Test with "how are my apps?" query
4. Optionally add cron trigger for periodic health checks

---

## Key Files to Modify

| File | Change |
|------|--------|
| `start-all.sh` | Remove HTTP MCP launches (Searcher, Gmail, Telegram, Filer, Browser) |
| All MCP `package.json` files | Set `"transport": "stdio"`, upgrade SDK |
| `Shared/Transport/dual-transport.ts` | Simplify — stdio only, remove HTTP/SSE server |
| `Orchestrator/src/mcp-clients/base.ts` | Remove or deprecate (no more HTTP clients for internal MCPs) |
| `Orchestrator/src/mcp-clients/http-client.ts` | Remove or deprecate |
| `Orchestrator/src/core/orchestrator.ts` | Load external MCPs from config, spawn via stdio |
| `Orchestrator/src/config/schema.ts` | Add external MCP config schema |
| `Shared/Discovery/scanner.ts` | Optionally merge external MCP config into discovery |

## Verification

1. Convert internal MCPs to stdio → `./test.sh` passes
2. Add Neon MCP to external config → Orchestrator discovers `neon_*` tools → call `neon_list_projects`
3. Add PostHog + Vercel → verify tool discovery
4. Test "how are my apps?" via Thinker → get aggregated health report
5. `npx tsc --noEmit` in each modified package
