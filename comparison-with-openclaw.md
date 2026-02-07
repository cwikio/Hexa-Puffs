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

## Deep Dive: Ishi (Supervisory Agent)

### How It Works in OpenClaw

Ishi is a second, narrower agent that sits between OpenClaw and tool execution. When OpenClaw plans a high-risk action (shell command, file delete, sending money), the plan gets passed to Ishi along with AI SAFE² policy rules. Ishi evaluates and returns go/no-go. It can also require human confirmation for certain action categories.

The relationship: OpenClaw is the operator, AI SAFE² is the security harness, and Ishi is the supervisor that reads the harness signals and the operator's plans and says "go/no-go" on sensitive actions.

### Do We Need Ishi?

**Not urgently.** Annabelle already has structural enforcement that OpenClaw lacks:

- **Tool policy** (`allowedTools`/`deniedTools`) — a restricted agent literally cannot see or call denied tools. OpenClaw relies on Ishi to *review* tool calls that are already technically available.
- **Guardian ML scanning** — input/output scanning catches prompt injection and PII leakage at the protocol level, not by asking another LLM "does this look safe?"
- **Per-agent Guardian overrides** — fine-grained scan flags per agent.

Ishi solves a real problem, but it's a **soft control** — an LLM judging another LLM's plan. That's inherently probabilistic. Our tool policies and Guardian scanning are **hard controls** — enforced in code, not in prompts.

### Where Ishi Would Add Value for Us

- **Destructive actions within allowed tools** — an agent allowed `gmail_*` could send embarrassing emails. Tool policy can't distinguish "send routine reply" from "send angry rant to boss." A supervisory review step could.
- **Cost-sensitive operations** — if an agent triggers an expensive LLM chain or sends 50 messages in a loop.
- **Human-in-the-loop for production** — "Agent wants to send this email, approve?" before actual delivery.

### Ishi Verdict

When agents do real autonomous work (sending emails, modifying files), consider adding a lightweight **approval gate** — but it doesn't need to be a full LLM agent like Ishi. A rule-based pre-flight check (is this a destructive tool? is the message unusually long? has this agent sent >N messages this hour?) would be cheaper and more deterministic.

---

## Deep Dive: Heartbeat

### How Heartbeat Works in OpenClaw

Every N minutes (default 30), the gateway sends the agent a "wake up" prompt. The agent reads a `HEARTBEAT.md` checklist from its workspace and checks for pending tasks — new emails, calendar events, CI failures, etc. If nothing needs attention, it replies `HEARTBEAT_OK` (silently suppressed). If something is urgent, it sends an alert to the user.

**Key configuration:**

- Interval: `30m` default (extends to `1h` with Anthropic OAuth)
- Active hours: restrict to e.g. 09:00–22:00 with timezone
- Per-agent: if any agent specifies heartbeat, only those agents run it
- Delivery: `target: "last"` (last active channel), `"none"` (silent), or explicit channel
- Cost optimization: if `HEARTBEAT.md` is empty, execution is skipped entirely

**Two-tier cost optimization pattern:**

- **Tier 1 (free)** — Lightweight rule-based checks via shell scripts/API calls: "Is the repo dirty? Are there open PRs? Did a job fail?" If nothing changed, output `HEARTBEAT_OK`.
- **Tier 2 (paid)** — Only when Tier 1 detects changes, invoke an LLM to summarize alerts and recommend actions.

### Do We Need Heartbeat?

**No.** We already have the core capability, structured differently:

| Capability | Annabelle (Inngest) | OpenClaw Heartbeat |
| --- | --- | --- |
| Periodic checks | Cron jobs (configurable schedule, timezone-aware) | Gateway heartbeat prompt every Nm |
| Proactive actions | Cron triggers tool calls via Orchestrator | Agent reads HEARTBEAT.md, runs tools |
| Notifications | Cron jobs send Telegram messages directly | Agent sends to last active channel |
| Cost model | Tool calls only, **no LLM token cost** | Full LLM turn every heartbeat ($5-30/day on Opus) |

Our Inngest cron jobs are **code-driven** (deterministic, free, no LLM tokens). OpenClaw's heartbeat is **LLM-driven** (flexible, expensive, can reason about what to check).

### Pros of Adding Heartbeat

1. **Flexible task discovery** — Instead of hardcoding "check email every hour" as a cron job, the agent decides what to check based on context. It might notice "user mentioned a meeting at 3pm" and proactively remind them.
2. **Unified checklist** — One `HEARTBEAT.md` file instead of multiple cron job definitions. Easier for users to edit.
3. **Context-aware** — The agent has conversation history, so it can prioritize checks based on what it knows about the user's current activity.

### Cons of Adding Heartbeat

1. **Token cost** — Every heartbeat is a full LLM turn. At 30min intervals, that's 48 turns/day per agent. With Groq it's cheap, but with cloud models it adds up fast.
2. **Latency** — An LLM call to "check if anything needs doing" takes 2-5 seconds. Our Inngest cron fires instantly.
3. **Unreliability** — LLM might forget to check something, hallucinate an alert, or misinterpret the checklist. Cron jobs are deterministic.
4. **We already have the infrastructure** — Inngest cron + Orchestrator tool calls covers the same ground without LLM overhead.

### Heartbeat Verdict

Not needed now. If we want the "flexible reasoning about what to check" capability later, the cheapest path would be a **hybrid approach**:

1. Add an Inngest cron job that runs every 30min
2. It does cheap checks first (new emails? unread Telegram messages? upcoming calendar?)
3. Only if something changed, dispatch to a Thinker agent for LLM-powered summarization

This gives the two-tier pattern without the always-on LLM cost.

---

## Deep Dive: Webhook-Based Message Ingestion

### Current Approach (Polling)

ChannelPoller calls `telegram_get_messages` via ToolRouter every 10 seconds. Messages are deduplicated via `processedMessageIds`, filtered (skip bot's own, old >2min, bot-like patterns, max 3/cycle), and dispatched to agents via MessageRouter. This works for a single platform but has inherent tradeoffs.

### How OpenClaw Does It

OpenClaw uses platform adapter webhooks — each platform (Discord, Slack, Telegram) pushes messages to the gateway via HTTP POST. The gateway routes them to agent sessions immediately. No polling loop, no wasted API calls.

### Pros of Webhooks

1. **Near-instant delivery** — Messages arrive in milliseconds instead of up to 10s polling delay. Users notice the difference in back-and-forth conversations.

2. **Zero wasted API calls** — ChannelPoller makes a `get_messages` call every 10 seconds even when nothing has arrived. That's ~8,640 API calls/day per platform with zero messages. Webhooks only fire when there's actual data.

3. **Scales with platforms** — Adding Discord, Slack, WhatsApp means adding more polling loops, each with its own interval, rate limits, and deduplication logic. Webhooks are a single `POST /webhook/:platform` endpoint — the platform pushes to you.

4. **Rate limit safety** — Telegram's Bot API has rate limits. Aggressive polling (especially across many chats) can hit them. Webhooks don't consume rate limit quota for reading.

5. **Simpler deduplication** — With polling, you need `processedMessageIds` to avoid reprocessing. Webhooks deliver each message exactly once (with retry semantics if your server is down).

6. **Event-driven fit** — The Orchestrator already dispatches messages to agents via HTTP POST. Webhooks arriving as HTTP POST → MessageRouter → AgentManager is a natural pipeline with no polling loop to manage.

### Cons of Webhooks

1. **Requires a public URL** — Polling works behind NAT, firewalls, home networks. Webhooks need a publicly routable HTTPS endpoint. For local dev, you'd need ngrok or Cloudflare Tunnel. This is significant friction — currently everything runs on `localhost`.

2. **SSL/TLS mandatory** — Telegram, Slack, Discord all require HTTPS for webhooks. That means real certs (Let's Encrypt) or a reverse proxy.

3. **Increased attack surface** — A public endpoint is a target. You'd need to validate webhook signatures (Telegram sends a secret token, Slack signs payloads with HMAC), handle replay protection, and rate-limit incoming requests. The current polling model has zero inbound surface.

4. **Missed messages during downtime** — If the Orchestrator is down or restarting, webhook deliveries fail. Most platforms retry (Telegram retries for ~24h with exponential backoff), but there's a window for message loss. Polling can catch up on missed messages when it comes back.

5. **GramJS/MTProto conflict** — The Telegram MCP uses GramJS with MTProto (user client protocol), not the Bot API. Telegram webhooks are Bot API only. To use Telegram webhooks, you'd need to either switch from GramJS to Bot API (losing user-client features), run both protocols in parallel, or keep polling for Telegram and use webhooks for other platforms.

6. **Infrastructure overhead** — DNS, TLS, reverse proxy, process manager to keep the webhook endpoint alive. Currently we just run `node` processes on localhost.

7. **Harder local development** — `curl localhost:8010` is simpler to test than setting up ngrok, registering a webhook URL with Telegram, sending a real message, and inspecting what arrived.

### Webhook Verdict

**Not needed yet.** The main driver for webhooks is multi-platform support. With only Telegram + Gmail, polling is fine. The GramJS/MTProto constraint means Telegram webhooks aren't directly possible without switching protocols.

**When it becomes worth it:**

- When adding Discord or Slack (both webhook-native — polling is unnatural for them)
- When the 10s polling delay becomes a user experience problem
- When deploying to a server with a public URL (VPS, cloud)

**Recommended path:** A hybrid model — webhook ingestion for platforms that push natively (Discord, Slack, Gmail via Pub/Sub), polling retained for Telegram (GramJS/MTProto). The Orchestrator's `dispatchMessage` method already accepts messages from any source. The MessageRouter doesn't care how the message arrived.

---

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
