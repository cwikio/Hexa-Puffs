# Next.js Frontend — Connectivity Architecture

**Created:** 2026-02-13

---

## Context

Add a Next.js frontend as the user-facing UI for the Annabelle ecosystem. Deployed to Vercel for mobile access. The key challenge: Vercel is cloud, the backend stack is local.

---

## The Bridge: Exposing Local Services

**Recommended: Cloudflare Tunnel**
- Free, stable, custom subdomains (e.g. `orchestrator.yourdomain.com`)
- Cloudflare Access for zero-trust auth before traffic reaches the machine
- Runs as a daemon, survives reboots
- Alternatives: Tailscale Funnel, ngrok (flaky for persistent use), VPS relay

---

## Connectivity Options

### Option A: Next.js → Orchestrator REST API (Recommended Starting Point)

The Orchestrator already exposes REST endpoints that Thinker uses. Next.js API routes would call these via `fetch()` through the tunnel.

**Pros:**
- Zero changes to Orchestrator — already proven (Thinker does this)
- Simple `fetch()` calls, works naturally with serverless (stateless request/response)
- Easy to debug

**Cons:**
- No automatic tool discovery (need to know endpoints)
- Manual type definitions for request/response

### Option B: Next.js → Thinker (for AI Chat)

Thinker already manages LLM conversations with tool access. Next.js becomes a web chat client for Thinker via its REST endpoints (`/api/converse`, etc.).

**Pros:**
- AI conversation layer already built
- Multi-turn context, fact extraction, hallucination guard all come for free

**Cons:**
- Thinker designed for single-client use — may need session management changes
- LLM response streaming needed to avoid Vercel serverless timeouts

### Option C: Next.js → Both (Likely End State)

- Chat/AI features → Thinker
- Direct tool calls / dashboards / settings → Orchestrator
- Thin Next.js API layer in `/app/api/` handles routing, auth, streaming

### Option D: Next.js as MCP Client → Orchestrator as MCP Server

Full MCP protocol between Next.js and Orchestrator.

**What it requires:**
- Add `StreamableHTTPServerTransport` to Orchestrator (new upstream MCP server layer)
- Use MCP SDK `Client` in Next.js API routes

**Killer feature:** Dynamic tool discovery — `client.listTools()` returns all tools with schemas. Frontend auto-adapts as MCPs are added/removed.

**Major concern:** Serverless impedance mismatch. MCP assumes persistent connections; Vercel functions are ephemeral. Each request pays handshake overhead.

**Verdict:** Overkill to start. The main benefit (tool discovery) can be achieved with a simpler REST endpoint.

---

## Middle Ground: REST + Auto-Discovery

Get 80% of Option D's benefit without MCP overhead:
- Add `/api/tools/list` REST endpoint to Orchestrator returning all tools + schemas
- Next.js fetches this on load for dynamic UI generation
- Tool invocations go through existing REST API
- Auto-discovery without protocol overhead

---

## Data Exchange Patterns

| Pattern | Use Case | Notes |
|---------|----------|-------|
| REST | Tool invocations | Already how Orchestrator works |
| SSE / Streaming | LLM responses from Thinker | Vercel AI SDK (`ai` package) has first-class support |
| WebSockets | Real-time push | Hard on Vercel serverless; use Pusher/Ably if needed |

---

## Auth Layers

1. **Cloudflare Access** — outer perimeter (email OTP or device-based)
2. **API key / bearer token** — between Next.js API routes and local services
3. **Optional: Clerk/NextAuth** — if you want a proper login UI

**Important:** Never expose tunnel URLs to the browser. Next.js API routes proxy all calls server-side.

---

## Vercel Gotchas

- Serverless function timeouts: 10s (free), 60s (pro) — streaming solves this for LLM calls
- No persistent connections from server side — each request is independent
- Edge functions for lower latency but more limited runtime
- Env vars for tunnel URLs: `ORCHESTRATOR_URL`, `THINKER_URL`

---

## Recommended Sequence

1. **Cloudflare Tunnel** exposing Orchestrator (:8010) and Thinker (:8006) with Cloudflare Access
2. **Next.js API routes** as thin proxy — auth, CORS, streaming
3. **REST to Orchestrator** for tool calls (Option A)
4. **SSE to Thinker** for chat (Option B)
5. **`/api/tools/list` endpoint** on Orchestrator for dynamic tool discovery (Middle Ground)
6. **Evaluate full MCP** only if the REST approach hits real limitations
