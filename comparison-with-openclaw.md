# Annabelle vs OpenClaw — Architecture Comparison

## Core Architecture

| Aspect | Annabelle | OpenClaw |
| --- | --- | --- |
| **Architecture style** | Orchestrator + spawned agent processes | Gateway + in-process agent runtime |
| **Agent isolation** | **OS-level process isolation** — each agent is a separate Node.js process spawned by AgentManager | Logical isolation (scoped configs, separate memory dirs); Docker for hard boundaries |
| **Tool protocol** | MCP standard (stdio/HTTP) — interoperable with Claude Desktop, any MCP client | Custom skills registry — installable scripts/APIs invoked by the agent loop |
| **Channel I/O** | Orchestrator owns all channel I/O (ChannelPoller), agents are passive | Gateway routes platform messages to agent sessions directly |
| **LLM integration** | Thinker uses Vercel AI SDK (Groq, LM Studio, Ollama) | Model Resolver with automatic failover and rate-limit cooldown |
| **Security model** | Guardian MCP — dedicated ML model (Granite Guardian) scans for prompt injection, PII, jailbreaks | AI SAFE² — memory vaccine (400+ lines of directives), scanner.py, gateway proxy |
| **Credential management** | 1Password MCP (read-only, never in prompts) | Env vars / config files |
| **Memory** | Memory MCP (SQLite — facts, conversations, profiles) | JSONL transcripts + curated markdown files |
| **Concurrency** | Natural process isolation — agents can't corrupt each other's state | "Default Serial, Explicit Parallel" — in-process lane model |
| **Config format** | `agents.json` (Zod-validated schemas) | YAML/TOML config files per agent |

## Feature Comparison

| Feature | Annabelle | OpenClaw |
| --- | --- | --- |
| Multi-agent spawning | AgentManager (auto-spawn, health check, auto-restart) | Multiple instances with distinct configs |
| Channel routing | MessageRouter with config-driven bindings (exact → wildcard → default) | Platform adapters with session mapping |
| Per-agent tool policies | `allowedTools`/`deniedTools` glob patterns enforced at Orchestrator | Skills registry with per-agent enable/disable |
| Per-agent security overrides | Guardian scan flags per agent (`getEffectiveScanFlags`) | Per-agent AI SAFE² config |
| Supervisory agent | **Not implemented** | Ishi — reviews plans before high-risk actions, can approve/deny |
| Channel connectors | Telegram, Gmail (2 channels) | Discord, Slack, Telegram, and more (50+ integrations) |
| Browser automation | **Not implemented** | Built-in browser skill |
| Shell execution | **Not implemented** (agents only use MCP tools) | Built-in shell skill |
| LLM cost controls | **Not implemented** | Gateway-level `max_request_size_bytes`, budget limits |
| Semantic/vector memory | **Not implemented** | QMD-based memory plugin (v2026.2.2) |
| Job scheduling | Inngest (cron, background tasks, retries) | **Not built-in** (external tools) |
| Webhook ingestion | **Not implemented** (polling-based) | Platform adapter webhooks |
| Claude Desktop integration | Native MCP stdio (works as Claude Desktop MCP server) | **Not supported** (different protocol) |
| Agent-to-agent delegation | **Not implemented** | **Not implemented** (separate instances) |

## Annabelle Advantages

1. **True process isolation** — A crashed agent cannot take down others. No shared memory, no state corruption risk. OpenClaw relies on logical isolation within a single process (or Docker as opt-in).

2. **MCP protocol standard** — Annabelle speaks MCP natively, meaning it works with Claude Desktop, Claude Code, and any future MCP client out of the box. OpenClaw uses a proprietary skills interface.

3. **ML-based security scanning** — Guardian uses an actual ML model (Granite Guardian) to detect prompt injection and PII leakage. OpenClaw's "memory vaccine" is essentially a large prompt injection defense embedded in context — clever but relies on the LLM honoring it.

4. **Centralized tool routing with policy enforcement** — Tool policies are enforced at the Orchestrator level before the tool call reaches any downstream MCP. The agent never even sees denied tools. OpenClaw enforces at the gateway/config level but tools are invoked in-process.

5. **1Password integration** — Secrets never appear in prompts or logs. OpenClaw uses env vars.

6. **Inngest job system** — Built-in cron scheduling, background tasks, retries with timezone support. OpenClaw has no equivalent.

## Annabelle Disadvantages

1. **Far fewer integrations** — Only Telegram + Gmail. OpenClaw has 50+ connectors (Discord, Slack, etc.).

2. **No supervisory agent** — OpenClaw's Ishi provides a human-in-the-loop safety net for risky actions. Annabelle has no equivalent.

3. **Polling, not webhooks** — ChannelPoller polls Telegram every 10s. OpenClaw uses platform webhooks for instant delivery.

4. **No semantic memory** — SQLite-based fact storage only. OpenClaw now has QMD-based memory with semantic retrieval.

5. **Higher resource usage** — One OS process per agent. For 5 agents, that's 5 Node.js processes + the Orchestrator. OpenClaw runs everything in one process.

6. **No cost controls** — No LLM API budget limits, no request size caps. A runaway agent could burn through API credits.

7. **No browser/shell tools** — Agents are limited to MCP tools (Telegram, Gmail, files, search, memory). No browser automation or shell execution.

8. **Single-user design** — Personal assistant only. OpenClaw supports multi-tenant deployment.

## Missing / To Improve

| Priority | Item | Notes |
| --- | --- | --- |
| High | More channel connectors (Discord, Slack, WhatsApp) | Only Telegram + Gmail currently. Biggest gap vs OpenClaw. |
| High | Webhook-based message ingestion | Replace polling with real-time webhooks for lower latency |
| High | LLM cost controls / budget limits | Per-agent spend caps, request size limits, rate limiting |
| Medium | Supervisory agent / human-in-the-loop | Review dangerous tool calls before execution (like Ishi) |
| Medium | Semantic/vector memory | Embeddings for better fact retrieval, currently just SQLite text search |
| Medium | Agent-to-agent delegation | Let agents hand off tasks to specialists |
| Medium | Browser automation tool | Web scraping, form filling, etc. as an MCP |
| Low | LLM failover / model resolver | Auto-switch providers on rate limit or failure |
| Low | Shell execution MCP | Controlled shell access as an MCP tool (with Guardian scanning) |
| Low | Multi-tenant support | Not needed for personal assistant, but limits team use |

---

Sources:
- [OpenClaw Architecture for Beginners (Jan 2026)](https://cyberstrategyinstitute.com/openclaw-architecture-for-beginners-jan-2026/)
- [OpenClaw Architecture Guide — Vertu](https://vertu.com/ai-tools/openclaw-clawdbot-architecture-engineering-reliable-and-controllable-ai-agents/)
- [What is OpenClaw — DigitalOcean](https://www.digitalocean.com/resources/articles/what-is-openclaw)
- [OpenClaw v2026.2.2 Release](https://evolutionaihub.com/openclaw-2026-2-2-ai-agent-framework-onchain/)
- [OpenClaw on Medium — Viplav Fauzdar](https://medium.com/@viplav.fauzdar/clawdbot-building-a-real-open-source-ai-agent-that-actually-acts-f5333f657284)
