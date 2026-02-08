# Annabelle vs OpenClaw — Full Capability Comparison

*Based on README documentation (Annabelle) and actual source code exploration (OpenClaw, 300+ files examined).*

---

## At a Glance

| Dimension | Annabelle | OpenClaw |
|---|---|---|
| **Codebase scale** | ~8 MCP packages, ~65 tools | 300+ TS files in `/src`, 309 in agents alone, 124 config files, 52 skills |
| **Philosophy** | Security-first, MCP-native microservices | Channel-first, gateway-based platform with plugin SDK |
| **Architecture** | Orchestrator hub spawning stdio/HTTP MCP servers | Local WebSocket Gateway (:18789) as control plane |
| **Primary interface** | Claude Desktop / Claude Code / Telegram | Any of 13+ messaging channels + companion apps + TUI + WebChat |
| **Agent runtime** | Thinker (ReAct loop, Vercel AI SDK, maxSteps: 8) | Pi embedded runner (tool + block streaming, subagent spawning, session compaction) |
| **LLM providers** | 4 (Groq, LM Studio, Ollama, Claude) | **9+** (Anthropic, OpenAI, Gemini, Bedrock, GitHub Copilot, Ollama, Qianfan, Minimax, Venice) |
| **Deployment** | Shell scripts (`start-all.sh`), Docker optional | `npm install -g openclaw && openclaw onboard --install-daemon` (systemd/launchd/Windows) |
| **CLI commands** | Telegram slash commands (~15) | **181 CLI commands** covering auth, agents, diagnostics, models, sandbox, security |
| **Team / community** | Solo developer project | 176k GitHub stars, 28.9k forks, 7-person core team |

---

## 1. Messaging Channels

| Channel | Annabelle | OpenClaw |
|---|---|---|
| Telegram | **Full MTProto** (user account via GramJS, 16 tools) | Yes (grammY library, bot API) |
| WhatsApp | No | Yes (Baileys library + CLI skill) |
| Slack | No | Yes (native `@slack/bolt` integration) |
| Discord | No | Yes (native `discord.js` integration) |
| Signal | No | Yes (with install helper) |
| iMessage | No | Yes (via BlueBubbles bridge) |
| Microsoft Teams | No | Yes (extension) |
| Google Chat | No | Yes (built-in) |
| Matrix | No | Yes (extension, `matrix-js-sdk`) |
| Zalo | No | Yes (extension, + personal variant) |
| Line | No | Yes |
| Mattermost | No | Yes (extension) |
| Nextcloud Talk | No | Yes (extension) |
| Twitch | No | Yes |
| WebChat | No | Yes (46-file web module with QR login, auto-reply, media compression) |
| TUI (terminal) | No | Yes (full terminal UI with themes, overlays, input history) |
| Claude Desktop/Code (MCP) | **Yes — native MCP stdio server** | No |

**Per-channel features in OpenClaw:** allowlist/blocklist per channel, mention gating, command gating, conversation labeling, acknowledgment tracking, reply chain preservation, location and sender identity tracking.

**Verdict:** OpenClaw supports **17+ communication surfaces** vs Annabelle's 2 (Telegram + Claude Desktop). However, Annabelle's Telegram integration is deeper — full user-account MTProto access (not bot API), 16 dedicated tools, real-time GramJS event capture, and message queue management. Annabelle's unique advantage is being a native MCP server that plugs directly into Claude Desktop/Code.

---

## 2. AI Agent System

| Feature | Annabelle | OpenClaw |
|---|---|---|
| Agent runtime | Thinker (Vercel AI SDK `generateText` + `maxSteps`) | **Pi embedded runner** (309 files, tool/block streaming, session compaction) |
| Multi-agent support | Yes — N Thinker instances, per-agent port/LLM/prompt | Yes — multi-agent with `AGENTS.md` config, subagent registry |
| Subagent spawning | No | **Yes** — agents can spawn child agents |
| Agent routing | Channel bindings: `(channel, chatId) → agentId` | Per-channel agent assignment with session-key routing |
| Per-agent tool policies | **Yes** — glob-based `allowedTools` / `deniedTools` | Yes — `tools.allow` / `tools.deny` in config |
| Per-agent LLM config | **Yes** — each agent uses different provider/model | Yes — per-agent model selection via `models-config.ts` |
| Per-agent cost controls | **Yes** — anomaly-based spike detection, sliding-window algorithm, hard caps, auto-pause + Telegram alert | Not found in code |
| Agent health monitoring | Auto-restart crashed agents via AgentManager | Not found in code |
| Agent kill switch | **Persistent halt manager** (survives restarts), target-specific `/kill` + `/resume` | Not found in code |
| Session compaction | No (conversation history only) | **Yes** — automatic summarization of older context to manage token limits |
| Session persistence | Conversation stored in Memory MCP (SQLite) | **JSONL session files** with automatic repair, write locking, transcript restoration |
| Dynamic tool selection | Keyword-based tool group routing per message | Not documented |
| Playbooks | 12 default playbooks (email triage, research, daily briefing, etc.) | Handled via 52 skills in ClawHub |
| Context window management | Dynamic system prompt from persona + facts + history | **Session compaction** + context window guards + custom instructions |
| Persona configuration | Memory MCP profile + system prompt file | **Workspace files**: `SOUL.md`, `IDENTITY.md`, `USER.md`, `AGENTS.md` |

**Verdict:** Both have multi-agent with tool policies and routing. Annabelle has more explicit cost/safety controls (sliding-window anomaly detection, kill switch, auto-restart) that are battle-hardened through real incidents. OpenClaw has a more sophisticated agent runtime with subagent spawning, session compaction (critical for long conversations), and a much larger codebase (309 files vs ~15 for Thinker). OpenClaw's workspace-file-based persona config (`SOUL.md`, `IDENTITY.md`) is more user-friendly than Annabelle's Memory MCP profile approach.

---

## 3. LLM Provider Support

| Provider | Annabelle | OpenClaw |
|---|---|---|
| Anthropic Claude | Yes (via Claude Desktop MCP) | **Yes** (native SDK, `@anthropic-ai/sdk`) |
| OpenAI / GPT-4 | No direct support | **Yes** (native SDK) |
| Google Gemini | No | **Yes** (native `@google/generative-ai`) |
| AWS Bedrock | No | **Yes** (`@aws-sdk/client-bedrock-runtime`) |
| GitHub Copilot | No | **Yes** |
| Groq | **Yes** (via OpenAI-compatible endpoint) | Not listed |
| LM Studio | **Yes** (OpenAI-compatible, local) | Possible via OpenAI compat |
| Ollama | **Yes** (OpenAI-compatible, local) | **Yes** (native) |
| Qianfan | No | **Yes** |
| Minimax | No | **Yes** |
| Venice | No | **Yes** |
| Local models (llama.cpp) | Via Ollama only | **Yes** (`llama-cpp-js` native) |
| Model discovery | Static env vars | **Dynamic model catalog** with live filtering |

**Verdict:** OpenClaw supports **9+ provider families** with native SDKs. Annabelle supports 4 providers via OpenAI-compatible endpoints. OpenClaw's dynamic model discovery and catalog is more sophisticated than Annabelle's env-var-based switching.

---

## 4. Task Management & Scheduling

| Feature | Annabelle | OpenClaw |
|---|---|---|
| Cron jobs | **Inngest-powered**, validated expressions, IANA timezones | Yes — built-in cron tool |
| One-time scheduled jobs | **Yes** — future timestamp scheduling | Not found |
| Background task queuing | **Yes** — immediate async execution | Not found |
| Multi-step workflows | **Yes** — step dependencies, 3x exponential retries | Not found |
| Job dashboard | **Yes** — real-time Inngest UI at `:8288` | Not found |
| Webhook integration | Planned (Pattern 4) | **Yes** — built-in webhook tool |
| Gmail Pub/Sub | Background polling with configurable interval | **Yes** — native Pub/Sub integration |
| Wakeups / heartbeats | Not implemented | **Yes** — `HEARTBEAT.md` config + wakeup cron tool |

**Verdict:** Annabelle has a significantly more robust job system — Inngest gives it cron, one-shot scheduling, background tasks, multi-step workflows with retries, and a real-time monitoring dashboard. OpenClaw has cron and webhooks but no equivalent workflow engine or job dashboard.

---

## 5. Security

| Feature | Annabelle | OpenClaw |
|---|---|---|
| Prompt injection scanning | **Guardian MCP** — 3 backends (Groq Llama Guard, Groq Safeguard, Ollama) | Not found in code |
| Jailbreak detection | **Yes** (Guardian) | Not found |
| PII leak prevention | **Yes** — output scanning on sensitive tools | Not found |
| Defense-in-depth layers | **7 documented layers** (input → scanning → tool auth → output → isolation → credentials → cost) | 3 layers (pairing → sandboxing → tool allowlists) |
| Per-tool input/output scanning | **Yes** — toggleable per MCP, per agent | No |
| Credential management | **1Password MCP** — AI never sees raw credentials | 1Password skill available; OAuth profile system with provider-specific credentials |
| Audit logging | JSONL audit trail, content hashed for privacy | **Yes** — dedicated audit module (13 files: `audit.ts`, `audit-fs.ts`, `audit-extra.ts`) |
| Skill/extension scanning | No | **Yes** — `skill-scanner.ts` for vulnerability scanning |
| DM pairing (unknown senders) | No (Telegram only, known user) | **Yes** — code verification for unknown DMs |
| Sandbox isolation | MCP process isolation (stdio) | **Docker containers** for group/channel sessions |
| File system auditing | File grants with ACLs | **Yes** — `audit-fs.ts` + Windows ACL support |
| Access control protocol | Tool policy globs per agent | **ACP module** (13 files: client, server, session, commands) |
| Fail modes | **Configurable** (closed = block, open = allow) when Guardian unavailable | Not documented |
| LLM cost controls | **Anomaly detection** — sliding window, spike multiplier, hard cap, auto-pause + alert | Not found |

**Verdict:** Different security philosophies. Annabelle focuses on **AI-specific threats** — prompt injection, jailbreak, PII leakage, LLM cost runaway — with a dedicated Guardian MCP and 7-layer defense. OpenClaw focuses on **platform security** — sandboxing untrusted sessions in Docker, DM pairing for unknown senders, skill vulnerability scanning, file system auditing, and a formal access control protocol. Neither covers what the other does well.

---

## 6. Memory & Personalization

| Feature | Annabelle | OpenClaw |
|---|---|---|
| Memory architecture | Memory MCP (SQLite, key-value + text) | **43-file memory module** with SQLite + vector embeddings |
| Fact storage | Categorized (preference, background, pattern, project, contact, decision) | QMD (query/memory document) manager |
| Semantic search | **No** (planned for Phase 3) | **Yes** — vector embeddings with hybrid search |
| Embedding providers | None | **3 providers**: OpenAI, Google Gemini, Voyage (with batch processing) |
| Conversation logging | Yes — searchable, per-agent | Yes — session files with compaction |
| User profiles | Per-agent, editable | Workspace files (`USER.md`, `SOUL.md`, `IDENTITY.md`) |
| Memory transparency | **Yes** — user can view/edit all stored facts (export to `~/.annabelle/memory-export/`) | Workspace markdown files are directly editable |
| Memory import/export | **Yes** — 11 memory tools | File sync (`sync-memory-files.ts`) |
| Automatic fact extraction | Yes — from conversations | Not documented separately |
| Context building | Dynamic system prompt from persona + facts + history | Session compaction + custom instructions + workspace files |
| Memory tools | 11 tools (store, list, delete, search, profile, stats, export, import) | Memory access with citations (agent tool) |

**Verdict:** OpenClaw has the more advanced memory system — **vector embeddings with 3 providers and hybrid search** is a major advantage over Annabelle's simple key-value/text storage. Annabelle's memory is more structured (categorized facts, 11 explicit tools, transparency exports) and gives users more granular control. Annabelle explicitly planned to add vector search in Phase 3.

---

## 7. Device, Voice & Visual

| Feature | Annabelle | OpenClaw |
|---|---|---|
| macOS app | No | **Yes** (menu bar app) |
| iOS app | No | **Yes** (companion node) |
| Android app | No | **Yes** (companion node) |
| Shared native kit | No | **Yes** (`OpenClawKit` shared across platforms) |
| Voice wake/activation | No | **Yes** — always-on voice |
| Talk mode (continuous voice) | No | **Yes** |
| Speech-to-text | No | **Yes** — OpenAI Whisper (local + API), Deepgram, Sherpa ONNX |
| Text-to-speech | No | **Yes** — ElevenLabs, Sherpa ONNX TTS |
| Camera access | No | **Yes** — CamSnap skill + device node camera |
| Screen recording | No | **Yes** — device node screen recording |
| Location | No | **Yes** — device node `location.get` |
| Live Canvas | No | **Yes** — A2UI visual workspace (present, push, snapshot, eval) |

**Verdict:** OpenClaw is in a completely different league here. Native apps for 3 platforms, voice with multiple STT/TTS providers, device sensor access, and a visual AI workspace. Annabelle has none of these capabilities.

---

## 8. Browser Automation

| Feature | Annabelle | OpenClaw |
|---|---|---|
| Browser control | No | **Yes** — full implementation |
| Chrome DevTools Protocol | No | **Yes** (`cdp.ts`) |
| Playwright integration | No | **Yes** (`pw-session.ts`, `pw-tools-core.ts`) |
| Tab/window management | No | **Yes** — multi-target control |
| Screenshot capture | No | **Yes** — screenshots + ARIA role snapshots |
| Browser profiles | No | **Yes** — Chrome profile management |
| Download management | No | **Yes** — response interception |
| Activity tracking | No | **Yes** — monitoring |

**Verdict:** OpenClaw has a production-grade browser automation system. Annabelle has no browser capabilities.

---

## 9. Tool & Skills Ecosystem

| Category | Annabelle | OpenClaw |
|---|---|---|
| Total built-in tools | **65+** across 8 MCP servers, each with named parameters | **60+ first-class tools** + 52 installable skills |
| Email (Gmail) | **18 tools** (messages, drafts, labels, attachments, OAuth2, polling) | Gmail Pub/Sub + Himalaya email skill |
| File operations | **13 tools** (CRUD, grants, search, audit, workspace isolation) | Exec tool + file read/write/patch |
| Web search | Brave Search (web + news) | **Yes** — web-search + web-fetch tools |
| Browser | No | **CDP + Playwright** (status, snapshot, act, screenshot) |
| Canvas/visual | No | **A2UI** (present, push, snapshot, eval) |
| Device nodes | No | **Camera, screen, location, notifications** |
| Messaging (cross-platform) | Telegram only (16 tools) | **Per-channel tools** for Discord, Slack, Telegram, WhatsApp, iMessage |
| Media processing | No | **Yes** — image analysis (multi-provider), audio via Deepgram, video frames |
| Link understanding | No | **Yes** — webpage parsing, content extraction, format normalization |
| Credential management | 1Password MCP | 1Password skill + OAuth profile system |
| Smart home | No | **Philips Hue** (openhue), **Sonos** (sonoscli) |
| Health/fitness | No | **Sleep tracking** (eightctl) |
| Notes | No | **Apple Notes, Apple Reminders, Bear Notes, Notion, Obsidian, Things** |
| Music | No | **Spotify, Sonos, SongSee** |
| Development | No | **GitHub skill, Coding Agent skill** |
| Extensibility model | MCP auto-discovery (drop folder + manifest) | **Plugin SDK** with channel adapters, hooks, tools, services, schema validation |
| Extension marketplace | No | **ClawHub** — 52 skills, install gating, workspace management |

**Verdict:** Both have ~60+ core tools, but the ecosystems are very different. Annabelle's tools are deeper in email (18 Gmail tools) and file management (13 tools with grants/audit). OpenClaw's ecosystem is vastly wider — browser automation, media processing, smart home, notes apps, music, development tools, and 52 installable skills. OpenClaw's Plugin SDK is a full development framework; Annabelle's MCP auto-discovery is simpler but less powerful.

---

## 10. Architecture & Developer Experience

| Aspect | Annabelle | OpenClaw |
|---|---|---|
| Protocol | **MCP (Model Context Protocol)** — open standard | WebSocket Gateway + custom JSON-RPC frames |
| Transport | stdio (spawned children) + HTTP (independent services) | WebSocket (:18789) + HTTP on same port |
| MCP integration | **Is an MCP server** — plugs into Claude Desktop/Code | Not an MCP server |
| OpenAI compatibility | No | **Yes** — OpenAI HTTP proxy in gateway |
| Configuration | Env vars + JSON config (`agents.json`) | **124-file config system** with Zod validation, hot-reload, env substitution |
| Workspace config | `~/.annabelle/` | `~/.openclaw/workspace/` with editable `.md` files |
| Startup | `start-all.sh` / Docker Compose | `openclaw onboard --install-daemon` → persistent system service |
| Daemon support | Manual (`start-all.sh`) | **Cross-platform**: systemd (Linux), launchd (macOS), Task Scheduler (Windows) |
| Remote access | Not built-in | **Tailscale Serve/Funnel, SSH tunnels** |
| CLI | ~15 Telegram slash commands | **181 CLI commands** (auth, agents, diagnostics, models, sandbox, security, channels, webhooks) |
| Diagnostics | Health checks | **`openclaw doctor`** — comprehensive diagnostics (auth, config, gateway, workspace, security) |
| Dashboard | Inngest (:8288) for jobs | No web dashboard |
| Testing | Vitest + curl integration tests | **Vitest** with colocated tests, Docker E2E, coverage reports |
| Code quality | TypeScript strict | TypeScript + **Oxlint + Oxfmt** |
| Package management | npm | **pnpm workspaces** (monorepo) |

**Verdict:** OpenClaw has a more mature development infrastructure — 181 CLI commands, cross-platform daemon support, comprehensive diagnostics (`doctor`), hot-reload config, and a full Plugin SDK. Annabelle's key architectural advantage is being MCP-native, which means seamless integration with Claude Desktop/Code and the broader MCP ecosystem.

---

## 11. User Interface Options

| Interface | Annabelle | OpenClaw |
|---|---|---|
| Claude Desktop (rich GUI) | **Yes** — primary interface via MCP | No |
| Terminal UI (TUI) | No | **Yes** — themed, overlays, input history, gateway chat |
| WebChat | No | **Yes** — 46-file module, QR login, auto-reply, media compression |
| Mobile apps | No | **Yes** — iOS, Android, macOS |
| Telegram as UI | **Yes** — full slash commands, real-time responses | Yes — as one of many channels |
| Job dashboard | **Yes** — Inngest at `:8288` | No |

**Verdict:** OpenClaw offers 4+ user interface options (TUI, WebChat, mobile apps, any messaging channel). Annabelle relies on Claude Desktop (excellent UX but tied to one client) and Telegram.

---

## Summary Scorecard

| Category | Annabelle | OpenClaw | Notes |
|---|---|---|---|
| Messaging channels | 2 | **17+** | OpenClaw dominates |
| LLM provider support | 4 | **9+** | OpenClaw has native SDKs for more providers |
| Agent governance & safety | **Strong** | Moderate | Annabelle's cost controls, kill switch, Guardian are unique |
| Task management & scheduling | **Strong** | Basic | Inngest gives Annabelle workflows, dashboard, retries |
| AI-specific security | **Strong** | None found | Guardian MCP is a standout Annabelle feature |
| Platform security | Basic | **Strong** | OpenClaw has Docker sandboxing, DM pairing, skill scanning, ACP |
| Memory system | Structured | **Advanced** | OpenClaw has vector embeddings + hybrid search |
| Voice & devices | None | **Full** | OpenClaw is in a different league |
| Browser automation | None | **Full** | CDP + Playwright |
| Tool/skill ecosystem | Deep (65+ specific) | **Wide (60+ core + 52 skills)** | Different strengths |
| Developer extensibility | MCP auto-discovery | **Plugin SDK + ClawHub** | OpenClaw's SDK is more comprehensive |
| MCP protocol native | **Yes** | No | Annabelle's unique advantage |
| Deployment maturity | Scripts | **System daemon** | Cross-platform daemon with diagnostics |
| CLI experience | ~15 commands | **181 commands** | OpenClaw is far more complete |

---

## The Real Difference

**Annabelle is a security-hardened, MCP-native orchestration layer** built by a solo developer with deep attention to cost safety, prompt injection defense, and operational controls. It excels at things that matter when you're running autonomous agents with real API costs — anomaly-based cost detection (born from a $100 incident), Guardian scanning with configurable fail modes, and granular per-agent governance. Its 18-tool Gmail integration and Inngest workflow engine are best-in-class for their scope.

**OpenClaw is a full-platform AI assistant** built by a 7-person team with 176k GitHub stars. It's designed to be your AI everywhere — in every messaging app, on every device, with voice, browser control, visual canvas, and a 52-skill plugin ecosystem. Its memory system with vector embeddings and hybrid search is more advanced, its agent runtime supports subagent spawning and session compaction, and its 181 CLI commands cover every operational need.

**If you want a secure, cost-controlled autonomous agent that lives inside Claude Desktop → Annabelle.**
**If you want an AI assistant accessible from every device and messaging platform → OpenClaw.**
