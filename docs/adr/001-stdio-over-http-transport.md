# ADR-001: Stdio Over HTTP as Default MCP Transport

**Status:** Accepted
**Date:** 2026-02-15

## Context

MCP servers can communicate via two transports: **stdio** (Orchestrator spawns the MCP as a child process, communicates over stdin/stdout) or **HTTP** (MCP runs independently, Orchestrator connects via HTTP/SSE).

Early versions of the system used HTTP for some MCPs (Searcher on :8007, Gmail on :8008), requiring each to manage its own HTTP server, port allocation, and lifecycle.

## Decision

**All internal MCPs use stdio transport by default.** The Orchestrator spawns each MCP as a child process and communicates via stdin/stdout JSON-RPC.

HTTP transport is reserved for MCPs that genuinely need it (webhooks, OAuth callbacks, long-running connections).

## Consequences

**Benefits:**
- No port conflicts — stdio MCPs don't bind ports
- Simplified lifecycle — Orchestrator manages process start/stop
- Cleaner startup — one process (Orchestrator) launches everything
- Auto-discovery works naturally — scan directories, spawn processes

**Trade-offs:**
- MCPs can't be restarted independently (must restart Orchestrator or use hot-reload)
- Debugging is harder (stdout is the protocol channel; all logging must go to stderr)
- HTTP MCPs are still supported via `transport: "http"` in the manifest for cases that need it

## Related

- `Orchestrator/README.md` — Architecture diagram
- `CONVENTIONS.md` — Logging to stderr convention
