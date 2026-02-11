# Cloud-Readiness Analysis: Annabelle MCP Ecosystem

**Date:** 2026-02-10

---

## The Big Picture

The system is a **local-first microservices architecture** using MCP as the protocol. The Orchestrator is the hub, some MCPs talk over HTTP (already network-capable), and others talk over stdio (must live on the same machine). That split is the most important factor for cloud migration.

---

## Three Deployment Models

### 1. Single VM in the Cloud (easiest)

Move everything to an EC2/Droplet/VPS. Everything runs on one machine, just not the local Mac. Requires:

- Install Ollama on the VM (or switch Guardian/embeddings to Groq/cloud APIs)
- Pre-generate Gmail OAuth token and Telegram session locally, copy them over
- Deal with 1Password CLI auth (service account token)
- Mount persistent storage for `~/.annabelle/`

Minimal code changes, but single point of failure.

### 2. Containerized Services (medium effort)

Each MCP becomes its own container. The stdio vs HTTP split matters most here.

**Already HTTP (can run anywhere today):**

| MCP | Port | Notes |
|-----|------|-------|
| Searcher | 8007 | Stateless, proxies Brave Search API |
| Gmail | 8008 | Stateless after OAuth setup |
| Telegram | 8002 | Stateless after session setup |
| Filer | 8004 | Needs volume mount for workspace |

**Currently stdio (tied to Orchestrator's machine):**

| MCP | Conversion Difficulty | Notes |
|-----|----------------------|-------|
| Guardian | Easy | Just calls Groq/Ollama, straightforward HTTP wrap |
| CodeExec | Easy | Needs sandboxed filesystem, otherwise simple |
| Browser | Medium | Needs Playwright + Chromium (~1GB) |
| 1Password | Hard | Depends on `op` CLI binary and auth session |
| Memorizer | Hardest | SQLite + sqlite-vec + FTS5, all native bindings |

The `Shared` package (`@mcp/shared`) is referenced as `file:../Shared` everywhere -- in containers, either copy it into each image or publish to a private npm registry.

### 3. Fully Distributed / Serverless (hardest)

Each service scales independently, databases are managed services. This is where the real architectural questions live.

---

## The Three Hard Problems

### Problem 1: Memorizer + SQLite

Biggest blocker. `better-sqlite3` and `sqlite-vec` are native C bindings. SQLite is single-writer, file-based, can't be shared across containers.

**Options:**
- **Keep SQLite** -- run Memorizer as a single container with persistent volume (simplest)
- **Migrate to PostgreSQL + pgvector** -- cloud-managed databases, replication, backups, multi-writer. But the hybrid search (sqlite-vec + FTS5 + LIKE fallback) needs reimplementation with pgvector + pg_trgm or similar

### Problem 2: Stdio to HTTP Conversion

5 of 9 MCPs use stdio. The good news: `Shared/Transport/dual-transport.ts` already has an HTTP/SSE transport abstraction. The conversion for each MCP: wrap in Express server, add `/health` endpoint, expose tools over HTTP. Orchestrator already knows how to talk to HTTP MCPs via `HttpMCPClient` -- just update the manifest (`transport: "http"`) and set a port.

### Problem 3: Local-Only Dependencies

- **Ollama** (embeddings for Memorizer, fallback for Guardian) -- replace with cloud embedding API (OpenAI, Cohere, Groq)
- **1Password CLI** -- switch to 1Password REST API + service account tokens instead of `op` binary
- **Playwright/Chromium** -- works in containers but needs system deps and ~1GB disk

---

## What's Already Good

- **Environment-based config**: Almost everything overridable via env vars (`MEMORY_DB_PATH`, `WORKSPACE_PATH`, `${NAME}_MCP_URL`, etc.)
- **Auto-discovery**: `package.json` manifest system means adding/removing MCPs is declarative
- **Thinker is already cloud-ready**: REST API, uses cloud LLM providers (Groq/Anthropic), communicates over HTTP
- **Inngest**: Just needs API key change to switch from dev server to Inngest Cloud
- **Token auth**: `ANNABELLE_TOKEN` pattern works in cloud (though a proper secrets manager would be better)
- **Health endpoints exist**: Basic `/health` on all HTTP services
- **HTTP MCPs have retry logic**: Exponential backoff in `BaseMCPClient`

---

## What's Missing for Cloud

- **No service discovery**: Everything is `localhost:PORT` -- need DNS-based discovery or service mesh
- **No container orchestration**: Bash scripts manage everything; Kubernetes/Docker Compose would replace this
- **No centralized logging**: All logs go to `~/.annabelle/logs/` files -- need stdout logging for container runtimes
- **No distributed tracing**: No correlation IDs across services
- **No secrets management**: `.env` files and plaintext token files -- need Vault/AWS Secrets Manager/similar
- **No backup strategy**: SQLite databases have no automated backups
- **Shallow health checks**: `/health` returns "ok" without checking downstream dependencies

---

## The UI Question

A separate Next.js app is the cleanest integration path. The Orchestrator already exposes an HTTP API on port 8010 with token auth, so a Next.js frontend is just another HTTP client. Considerations:

- Add CORS for the frontend's domain
- Possibly add WebSocket support for streaming responses from Thinker
- Decide whether Next.js server-side talks to Orchestrator (server-to-server) or the browser does (token exposure)

---

## Current Cloud-Readiness: ~40%

The architecture is sound -- hub-and-spoke with MCP protocol is a good pattern. The main gaps are **operational** (no containers, no orchestration, file-based everything) rather than fundamental design flaws.

**Fastest path to cloud:** Single VM -> Docker Compose -> Kubernetes (if scaling needed). The stdio-to-HTTP conversion is mechanical. The Memorizer database is the only truly hard decision.

---

## Areas for Further Exploration

- **Memorizer migration**: SQLite -> PostgreSQL/pgvector trade-offs, hybrid search rewrite
- **Stdio to HTTP conversion**: Effort per MCP, implementation details
- **Next.js UI integration**: Auth model, streaming, server-to-server vs browser-to-Orchestrator
- **Deployment strategy**: Docker Compose vs K8s, CI/CD, staging/prod environments
