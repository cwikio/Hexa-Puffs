# Annabelle vs OpenClaw — Capability Comparison

## At a Glance

| Dimension | Annabelle (your codebase) | OpenClaw |
|---|---|---|
| **Philosophy** | Security-first, MCP-native microservices | Channel-first, gateway-based unification |
| **Architecture** | Orchestrator hub spawning stdio/HTTP MCP servers | Local WebSocket Gateway (port 18789) as control plane |
| **Primary interface** | Claude Desktop / Claude Code / Telegram | Any messaging app (12+ channels) + companion apps |
| **Agent runtime** | Thinker (ReAct loop, Vercel AI SDK, maxSteps: 8) | Pi runtime (RPC mode, tool + block streaming) |
| **LLM support** | Groq, LM Studio, Ollama, Claude (model-agnostic) | Anthropic Claude, OpenAI (configurable) |
| **Deployment** | Shell scripts (`start-all.sh`), Docker optional | `npm install -g openclaw && openclaw onboard --install-daemon` |
| **Maturity focus** | Deep vertical: security, cost controls, memory | Broad horizontal: channels, devices, voice, canvas |

---

## 1. Messaging Channels

| Channel | Annabelle | OpenClaw |
|---|---|---|
| Telegram | **Full MTProto** (user account via GramJS, not bot API) | Yes |
| WhatsApp | No | Yes |
| Slack | No | Yes |
| Discord | No | Yes |
| Signal | No | Yes |
| iMessage | No | Yes |
| Microsoft Teams | No | Yes |
| Google Chat | No | Yes |
| Matrix | No | Yes |
| Zalo | No | Yes |
| WebChat | No | Yes |
| Claude Desktop/Code | **Yes (MCP stdio)** | No (not an MCP server) |

**Verdict:** OpenClaw wins massively on channel breadth (12+ platforms). Annabelle is deeper on Telegram (full user-account access, MTProto, real-time event capture, 16 tools, slash commands) and uniquely integrates as a native MCP server inside Claude Desktop/Code — meaning Claude itself can invoke all 65+ Annabelle tools directly.

---

## 2. AI Agent Deployment & Multi-Agent

| Feature | Annabelle | OpenClaw |
|---|---|---|
| Multi-agent support | Yes — Orchestrator spawns N Thinker instances, each with own port, LLM config, system prompt | Yes — multi-agent routing with isolated per-agent sessions |
| Agent routing | Channel bindings: `(channel, chatId) → agentId`, exact → wildcard → default | Per-channel agent assignment |
| Per-agent tool policies | **Yes** — glob-based `allowedTools` / `deniedTools` per agent | Not documented |
| Per-agent security overrides | **Yes** — Guardian scan flags overridable per agent | Not documented |
| Per-agent LLM config | **Yes** — each agent can use different provider/model | Not documented |
| Per-agent cost controls | **Yes** — anomaly-based spike detection, hard token caps, auto-pause with Telegram alert | Not documented |
| Agent health monitoring | Auto-restart crashed agents via AgentManager | Not documented |
| Agent kill switch | Persistent halt manager (survives restarts), target-specific `/kill` and `/resume` | Not documented |

**Verdict:** Annabelle has significantly more documented depth in agent management — per-agent tool policies, security overrides, cost controls, and health monitoring are all implemented and battle-tested (including two real incident post-mortems). OpenClaw supports multi-agent routing but the documentation doesn't detail the same level of per-agent governance.

---

## 3. Task Management & Scheduling

| Feature | Annabelle | OpenClaw |
|---|---|---|
| Cron jobs | **Yes** — Inngest-powered, validated cron expressions, IANA timezone support | Yes — cron job scheduling |
| One-time scheduled jobs | **Yes** — schedule for a specific future timestamp | Not documented |
| Background task queuing | **Yes** — immediate async execution | Not documented |
| Multi-step workflows | **Yes** — step dependencies, automatic retries (3x exponential backoff) | Not documented |
| Job dashboard | **Yes** — real-time at `:8288` (Inngest Dev Server) | Not documented |
| Webhook integration | Planned (Pattern 4 in architecture) | Yes |
| Playbooks | **12 default playbooks** seeded on first startup (email triage, research, daily briefing, etc.) | Skills platform (ClawHub) — managed, bundled, workspace-specific |

**Verdict:** Annabelle has a more fully documented job/task system with Inngest providing cron, one-shot scheduling, background tasks, workflows, retries, and a monitoring dashboard. OpenClaw has cron and webhooks but the documentation is lighter on details. OpenClaw's skills platform (ClawHub) is more of an extension/plugin marketplace, which Annabelle doesn't have.

---

## 4. Security

| Feature | Annabelle | OpenClaw |
|---|---|---|
| Prompt injection scanning | **Guardian MCP** — 3 backends: Groq Llama Guard, Groq Safeguard, Ollama (local) | Not documented |
| Jailbreak detection | Yes (Guardian) | Not documented |
| PII leak prevention | Yes — output scanning on sensitive tools | Not documented |
| Defense-in-depth layers | **7 layers** documented (input validation → scanning → tool auth → output scan → MCP isolation → credential separation → cost controls) | Pairing mode for unknown DMs, optional Docker sandboxing for group sessions |
| Per-tool scanning config | Yes — input/output scanning toggled per MCP, per agent | Not documented |
| Credential management | **1Password MCP** — AI never sees raw credentials | Not documented |
| Audit logging | Full JSONL audit trail, content hashed (not stored) for privacy | Not documented |
| Fail modes | Configurable: closed (block when Guardian down) vs open (allow through) | Default to pairing mode |
| LLM cost safety | Anomaly-based spike detection, sliding-window algorithm, hard caps, auto-pause + Telegram alert | Not documented |

**Verdict:** Annabelle's security posture is substantially more developed and documented. The Guardian MCP with multiple scanning backends, 7-layer defense-in-depth, per-tool/per-agent scan configuration, and battle-tested cost controls (with documented incident history) is a standout feature. OpenClaw takes a simpler approach with pairing mode and Docker sandboxing.

---

## 5. Memory & Personalization

| Feature | Annabelle | OpenClaw |
|---|---|---|
| Fact storage | Yes — categorized (preference, background, pattern, project, contact, decision) | Not documented |
| Conversation logging | Yes — searchable, per-agent | Not documented |
| User profiles | Yes — per agent, editable | Not documented |
| Memory transparency | **Yes** — user can see and edit everything AI knows (exported to files) | Not documented |
| Memory import/export | Yes — 11 memory tools total | Not documented |
| Persona configuration | Config-driven system prompts, loaded from Memory MCP | Not documented |
| Context management | Dynamic system prompt built from persona + facts + conversation history | Per-agent sessions |

**Verdict:** Annabelle has a fully built-out memory system with transparency as a core design principle. OpenClaw doesn't document an equivalent persistent memory/personalization layer.

---

## 6. Device & Voice Integration

| Feature | Annabelle | OpenClaw |
|---|---|---|
| macOS companion app | No | Yes |
| iOS companion app | No | Yes |
| Android companion app | No | Yes |
| Voice interaction | No | **Yes — always-on speech via ElevenLabs** (macOS/iOS/Android) |
| Screen recording | No | Yes (via mobile nodes) |
| Camera access | No | Yes (via mobile nodes) |
| Location sharing | No | Yes (via mobile nodes) |
| Live Canvas (visual workspace) | No | **Yes — agent-driven A2UI visual workspace** |

**Verdict:** OpenClaw wins entirely here. Annabelle has no device companion apps, no voice, no visual workspace. OpenClaw's always-on speech, mobile device integration, and Live Canvas are capabilities Annabelle doesn't attempt.

---

## 7. Tool Ecosystem

| Category | Annabelle | OpenClaw |
|---|---|---|
| Total tools | **65+** across 8 MCP servers | Not enumerated |
| Email (Gmail) | **18 tools** — messages, drafts, labels, attachments, OAuth2, background polling | Gmail Pub/Sub |
| File operations | **13 tools** — CRUD, grants, search, audit log, workspace isolation | System command execution (macOS) |
| Web search | Brave Search (web + news) | Not documented separately |
| Credential management | 1Password (read-only) | Not documented |
| Browser control | No | **Yes — dedicated Chrome/Chromium instance** |
| System commands | No | Yes (macOS) |
| Extensibility | **Auto-discovery** — drop a folder with `package.json` manifest, Orchestrator finds it at startup | **Skills platform (ClawHub)** — bundled, managed, workspace-specific extensions with installation gating |

**Verdict:** Annabelle has more documented, enumerated tools (65+ with specific tool names and parameters). OpenClaw has browser control and system command execution that Annabelle lacks. OpenClaw's ClawHub is a more mature extension/plugin distribution model; Annabelle's auto-discovery is developer-friendly but doesn't have a marketplace.

---

## 8. Architecture & Developer Experience

| Aspect | Annabelle | OpenClaw |
|---|---|---|
| Protocol | **MCP (Model Context Protocol)** — native standard | WebSocket Gateway + custom RPC |
| Transport | stdio (spawned children) + HTTP (independent services) | WebSocket (local port 18789) |
| MCP integration | **Is an MCP server itself** — plugs directly into Claude Desktop/Code | Not an MCP server |
| Configuration | Env vars + JSON config files | YAML config |
| Startup | `start-all.sh` / Docker Compose | `openclaw onboard --install-daemon` (system service) |
| Remote access | Not built-in | **Tailscale / SSH tunnels** |
| Dashboard | Inngest (:8288) for jobs | Not documented |
| Testing | Multi-level test suite (health checks, curl tests, vitest) | Not documented |

**Verdict:** Annabelle is deeply MCP-native, which means it integrates seamlessly with Claude Desktop and any future MCP client. OpenClaw uses its own gateway protocol, which gives it more flexibility for non-MCP clients but doesn't plug into the MCP ecosystem. OpenClaw has built-in remote access; Annabelle doesn't.

---

## Summary: Where Each Excels

### Annabelle's strengths
- **Security depth** — 7-layer defense, Guardian scanning with 3 backends, per-agent overrides, audit trails
- **Agent governance** — per-agent tool policies, cost controls with anomaly detection, kill switches, health monitoring
- **MCP-native** — integrates directly into Claude Desktop/Code as a first-class MCP server
- **Memory system** — persistent, transparent, editable, categorized fact storage
- **Task scheduling** — full Inngest integration with cron, one-shot, background, workflows, dashboard
- **Gmail depth** — 18 tools covering the full email lifecycle
- **Battle-tested** — documented incidents and post-mortems showing real-world hardening

### OpenClaw's strengths
- **Channel breadth** — 12+ messaging platforms out of the box
- **Device integration** — macOS, iOS, Android companion apps with camera, screen, location
- **Voice** — always-on speech with ElevenLabs across devices
- **Visual workspace** — Live Canvas with A2UI
- **Browser control** — dedicated Chrome/Chromium instance
- **Extension marketplace** — ClawHub skills platform for community extensions
- **Remote access** — built-in Tailscale/SSH tunnel support
- **Easy onboarding** — single `npm install -g` + `onboard --install-daemon`

### What each project lacks

| Annabelle is missing | OpenClaw is missing |
|---|---|
| Multi-channel support beyond Telegram | MCP protocol integration |
| Voice / speech capabilities | Documented security scanning / prompt injection defense |
| Device companion apps | Documented persistent memory system |
| Browser automation | Per-agent tool policies & cost controls |
| Extension marketplace | Detailed tool enumeration (65+ documented tools) |
| Remote access | Job management dashboard |
| Easy one-command install | Memory transparency (user can see what AI knows) |
