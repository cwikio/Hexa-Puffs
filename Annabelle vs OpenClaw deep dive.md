# Annabelle Architecture Deep Dive — Comparison with OpenClaw & Roadmap Recommendations

*Based on source code exploration of both projects. Annabelle: ~8 MCP packages, ~65 tools. OpenClaw: 300+ TypeScript files, 309 in agents alone, 52 skills, 176k GitHub stars.*

---

## 1. Agent Runtime

### How Annabelle Works

Annabelle's Thinker is a **bounded executor** built on Vercel AI SDK's `generateText` with `maxSteps: 8`. The flow is straightforward: Orchestrator sends a message via `POST /process-message`, Thinker builds a context (system prompt + persona + facts + conversation history + playbook instructions), passes it to the LLM, and the SDK handles the ReAct loop internally — iterating tool calls until the LLM emits a final text response or hits the step limit. On failure, it does one retry with tools, then falls back to text-only mode.

The agent has access to **65+ pre-built tools** across 8 MCP servers (Telegram, Gmail, Memory, Filer, Searcher, Guardian, 1Password, plus Orchestrator's own). Dynamic tool selection uses keyword-based routing to pick only relevant tool groups per message, keeping the context window manageable.

The ceiling of what Thinker can do in a single turn is defined entirely by what tools have been pre-built. If it encounters a task no existing tool covers — parsing a CSV, transforming data, running calculations — it cannot improvise.

### How OpenClaw Works

OpenClaw's Pi is an **embedded agent runtime** imported directly as a library via `createAgentSession()`, not spawned as a subprocess. Pi's core philosophy is radical minimalism: it ships with exactly **4 coding tools** — `read`, `write`, `edit`, `exec` — plus process management. The idea is that the LLM extends itself by writing and executing code. If it needs a capability, it writes a script, runs it, reads the output, fixes errors, and re-runs.

OpenClaw layers its own tools on top (browser, canvas, nodes, cron, sessions, messaging), but Pi's real power comes from arbitrary code execution. The runtime is streaming-first with sophisticated block chunking — it respects paragraph and code fence boundaries (never splitting a code block mid-fence), soft-chunks output at 800–1,200 characters with a break preference hierarchy (paragraph → newline → sentence → whitespace → hard break).

The agent loop follows: intake → context assembly → model inference → tool execution → streaming replies → persistence. No explicit task planner, no step tracker, no DAG of subtasks — the LLM itself drives the entire workflow.

### Which Architecture Is Superior

**OpenClaw's runtime is superior for autonomy and flexibility.** An agent that can write and execute arbitrary code can handle novel problems without pre-built tooling. When confronted with an unexpected task, Pi writes a solution on the fly. Annabelle's Thinker would fail or produce a text-only response explaining what it can't do.

**Annabelle's runtime is superior for safety, auditability, and governance.** Every action maps to a named tool with defined parameters. Guardian can scan inputs and outputs. Per-agent tool policies can restrict what each agent does. Cost monitors track usage predictably. When Pi writes and executes arbitrary code, none of these safety layers apply to the generated code — you can't pre-scan what the LLM is about to write and run.

For a **personal assistant that handles real tasks with real API costs**, Annabelle's predictable model is safer. For a **power-user agent expected to solve arbitrary problems**, OpenClaw's self-programming model is more capable.

### Recommendations

**Recommendation 1: Add an `execute_code` tool to the MCP ecosystem.**

Implement a single new tool that accepts a language (Python, Node, Bash), a code string, and an optional timeout. It writes the code to a temp file in `~/.annabelle/sandbox/`, executes it in a subprocess, captures stdout/stderr, cleans up, and returns the output. Output should be truncated (first 2,000 + last 2,000 characters if large).

*Justification:* This gives Annabelle Pi's core capability — the ability to improvise solutions by writing and running code — without abandoning the existing tool-rich architecture. The 65+ existing tools remain the primary path for known tasks (faster, safer, pre-scanned). Code execution becomes the escape hatch for novel problems. With `maxSteps: 8`, the agent has room to write code, run it, see an error, fix it, and re-run. This eliminates the single biggest capability gap between the two systems.

**Recommendation 2: Gate `execute_code` behind Guardian scanning and tool policy.**

Before execution, scan the code string with Guardian for dangerous patterns (file deletion outside sandbox, network calls to unexpected hosts, credential access attempts). After execution, scan the output for PII leakage. Use the existing `allowedTools`/`deniedTools` glob system so untrusted or Telegram-facing agents can have `deniedTools: ["execute_code"]` while the primary agent gets full access.

*Justification:* This is what makes the self-programming capability safe in Annabelle's architecture and what OpenClaw cannot do. Pi's code execution is a core primitive below the safety system — there's no interception point. Annabelle's MCP architecture means every tool call, including code execution, flows through Orchestrator where Guardian can inspect it. This turns a potential vulnerability into a governed capability.

**Recommendation 3: Use Docker containers for code execution isolation.**

Run generated code in a Docker container with no network access, mounted to a specific workspace directory, with CPU/memory/time limits. The existing 1Password MCP separation ensures credentials are never in the Thinker's environment, so spawned subprocesses can't access them.

*Justification:* Process-level sandboxing prevents the most dangerous failure mode: an LLM-generated script that accesses the file system, network, or credentials in unintended ways. Docker provides resource limits (preventing runaway CPU/memory consumption), network isolation (preventing data exfiltration), and filesystem isolation (preventing access to sensitive files outside the workspace). For a lighter alternative, `child_process.spawn` with `uid`/`gid` restrictions and stripped environment variables works but provides weaker isolation.

**Recommendation 4: Add output streaming for long-running tool calls.**

Currently, Thinker blocks until a tool call completes, which works for API calls (milliseconds to seconds) but not for code execution (potentially minutes). Add a streaming mechanism so the user sees partial output from long-running code executions via Telegram, rather than waiting in silence.

*Justification:* Code execution introduces a new class of tool call — one that may run for 30+ seconds. Without streaming, the user has no feedback. OpenClaw's block streaming solves this at the runtime level. For Annabelle, a simpler approach would work: the `execute_code` tool periodically sends progress updates via Telegram during execution, then returns the final result. This maintains the existing tool-call model while adding visibility.

---

## 2. Multi-Agent Architecture

### How Annabelle Works

Annabelle spawns each agent as a **separate OS process**. `AgentManager` calls `spawn('node', ['Thinker/dist/index.js'], { env: ... })` with per-agent environment variables for port, LLM provider, model, system prompt path, and cost control thresholds. Each agent is a full Thinker instance on its own HTTP port. Orchestrator communicates via REST (`POST /process-message`).

Health checks run every 30 seconds. Crashed agents auto-restart with a 10-second cooldown and maximum 5 attempts. If an agent's cost monitor triggers a spike, Orchestrator marks it paused and stops dispatching messages. The halt manager persists state to disk, surviving Orchestrator restarts.

Channel routing uses bindings: `(channel, chatId) → agentId` with exact match → wildcard → default fallback. Per-agent tool policies use glob-based `allowedTools`/`deniedTools` patterns.

### How OpenClaw Works

OpenClaw runs all agents within a **single gateway process** with session-level isolation. Agents are defined via workspace `AGENTS.md` files rather than process configuration. Spinning up a new agent creates a session object in memory — negligible overhead. Routing uses session keys in the format `agent:<agentId>:<channel>:<accountId>:dm:<peerId>`.

Each session has its own "lane" for serialized execution — no race conditions between concurrent messages to the same session. Agent identity comes from workspace files (`SOUL.md`, `IDENTITY.md`), and model selection is configured per-agent via `models-config.ts`.

Tool policies exist via `tools.allow` and `tools.deny` in configuration, similar to Annabelle's approach.

### Which Architecture Is Superior

**Annabelle's process-per-agent model is superior for isolation, safety, and operational control.** A crashed agent doesn't take down others. A memory leak in one agent doesn't poison the rest. Cost monitoring is per-process with independent sliding windows. The kill switch can stop one agent without affecting others. These are real production concerns when agents handle real work with real money — as demonstrated by Annabelle's documented $100 runaway incident.

**OpenClaw's shared-process model is superior for resource efficiency and configuration simplicity.** Adding a new agent is editing a markdown file, not provisioning a new process with its own port and health check loop. 50 agents in one process use a fraction of the memory that 50 separate Node.js processes would.

**On a 128GB MacBook Pro, the resource argument is irrelevant.** A typical Thinker process idles at 50–80MB, peaks at 150–200MB under load. At 200MB per agent, 128GB supports 600+ simultaneous agents. Even accounting for macOS overhead (16–20GB), that leaves room for 500+ agents. In practice, the bottleneck is LLM API rate limits, not local resources. The CPU overhead is also negligible — each Thinker mostly waits on network I/O, using essentially zero CPU while idle.

For Annabelle's use case (single user, single machine, handful of agents), **process isolation is essentially free** — you get real safety boundaries without paying any meaningful resource cost.

### Recommendations

**Recommendation 1: Keep process-per-agent architecture.**

Do not move to a shared-process model. The isolation buys real safety (cost containment, crash isolation, independent health monitoring) at zero practical cost on your hardware. Every safety feature you've built — cost monitor, halt manager, auto-restart — depends on process boundaries.

*Justification:* The shared-process model's only advantage is resource efficiency, which is irrelevant on a 128GB machine running single-digit agents. Moving to shared-process would require re-architecting cost monitoring (currently per-process), crash isolation (currently automatic via process boundaries), and the kill switch (currently process-level SIGTERM). The engineering cost would be high and the benefit zero for your use case.

**Recommendation 2: Add lazy-spawn and idle-kill for inactive agents.**

Instead of spawning all agents at Orchestrator startup, spawn them on first message and kill them after a configurable idle timeout (e.g., 30 minutes with no messages). AgentManager already tracks agent state — add a `lastActivityAt` timestamp and a periodic check.

*Justification:* If you define 10 agents but only 2 are actively used, the other 8 consume memory and health-check cycles for no reason. Lazy spawning reduces startup time and idle resource usage. This matters not for RAM (which is abundant) but for operational cleanliness — fewer processes, fewer log entries, fewer health-check cycles. The first message to a cold agent adds ~2 seconds of latency for process startup, which is acceptable.

**Recommendation 3: Consider shared HTTP server with path-based routing.**

Instead of each Thinker opening its own HTTP port (8006, 8016, etc.), have Orchestrator run a single HTTP server and route to agents via path: `POST /agents/annabelle/process-message`, `POST /agents/work-assistant/process-message`. Thinker processes would receive messages via stdin/stdout (like downstream MCPs already do) instead of running their own HTTP servers.

*Justification:* Port-per-agent works fine at small scale but becomes unwieldy if you add 10+ agents. A shared server with path routing simplifies firewall rules, reduces port conflicts, and makes the system easier to monitor (one endpoint instead of many). This is a low-priority optimization — the current approach works — but would clean up the architecture as agent count grows.

---

## 3. Subagent Spawning

### How OpenClaw Works

OpenClaw allows agents to spawn child agents for parallel work. The `sessions_spawn` call is non-blocking — it returns `{ status: "accepted", runId, childSessionKey }` immediately. The subagent runs in a fully isolated session with its own transcript, memory, and context window. When it finishes, it announces results back to the parent's chat channel.

Key constraints: subagents **cannot spawn subagents** (single level only). A `maxConcurrent` safety valve limits resource consumption. Sending `/stop` in the parent chat aborts both the parent session and all active subagents spawned from it. Control commands (`/subagents send <id> <message>`, `/subagents info`) allow inspection and interaction.

Design goals: parallelize research and long tasks without blocking the main conversation, keep subagents isolated through session separation and optional sandboxing.

Known issues in OpenClaw's implementation: session write lock timeouts causing premature termination, model override not applied to subagents. These are symptoms of shared-process contention — the parent and child compete for the same process resources.

### How Annabelle Would Handle This

Annabelle does not currently have subagent spawning. However, its architecture is **better suited for this capability than OpenClaw's**, precisely because of process isolation.

Spawning a subagent in Annabelle would mean `AgentManager` starts another Thinker process with a scoped configuration: a parent reference, a narrower tool policy (inherited from parent, possibly further restricted), a callback URL or event to report results, and a timeout after which Orchestrator kills it. Because it's a separate process, the parent agent keeps working uninterrupted. If the subagent goes haywire, the cost monitor catches it independently, or the kill switch stops it without touching the parent.

All existing safety infrastructure — health checks, auto-restart limits, cost anomaly detection, the halt manager — applies automatically to subagents without any new code.

### Which Architecture Is Superior

**Annabelle's (future) process-based subagent spawning would be superior to OpenClaw's shared-process approach.** OpenClaw's known issues (write lock timeouts, resource contention) are direct consequences of running parent and child in the same process. In Annabelle's model, these problems don't exist — separate processes can't contend on each other's write locks or memory.

**OpenClaw is superior in that it has the feature and Annabelle doesn't.** The capability itself — parallel work, offloading long tasks, isolating risky operations — is genuinely useful and missing from Annabelle.

### Should Subagents Be Full Agents or Simple Sessions?

**Full agents, not simple sessions.** A session is just state (conversation history, context). A subagent is an actor with a reasoning loop that can use tools, make multi-step decisions, and report back. The value of subagent spawning is specifically that the child can think and act independently — research a topic, execute multiple tool calls, synthesize results — while the parent does something else.

If you narrowed it to simple sessions (just state without a reasoning loop), you'd get shared context but not parallel work. The parent would still need to do all the thinking and tool-calling itself, sequentially. That defeats the purpose.

Annabelle's Thinker is already a self-contained actor. A subagent is just a dynamically-spawned Thinker with additional metadata (parent ID, completion callback, scoped permissions, auto-kill timeout).

### Recommendations

**Recommendation 1: Add a `spawn_subagent` tool to Orchestrator.**

The tool creates a temporary agent configuration (inheriting from parent's LLM provider, model, and tool policy), passes it to `AgentManager`, and returns immediately with a `subagentId` and `status: "accepted"`. When the subagent's Thinker finishes processing, Orchestrator routes the result back to the parent's session (or sends it to Telegram if the parent has completed).

*Justification:* This is the single most impactful capability addition for autonomous agent work. Currently, if Annabelle needs to research 3 competitors, it does so sequentially — research #1, then #2, then #3. With subagent spawning, it fires off 3 subagents in parallel and synthesizes results when they return. For a task that takes 30 seconds each, this reduces wall-clock time from 90 seconds to ~35 seconds. More importantly, the parent agent remains responsive to the user during the work.

**Recommendation 2: Enforce single-level depth (subagents cannot spawn subagents).**

Add a `parentAgentId` field to the subagent config. If a Thinker instance with a non-null `parentAgentId` attempts to call `spawn_subagent`, Orchestrator rejects it.

*Justification:* OpenClaw learned this constraint through experience. Multi-level subagent spawning creates exponential resource consumption and makes the execution graph impossible to reason about. A parent spawning 3 children is manageable. A parent spawning 3 children that each spawn 3 grandchildren is 13 concurrent agents from a single user message. Single-level depth keeps the system predictable and bounded.

**Recommendation 3: Inherit parent tool policies with optional further restriction.**

Subagents receive the parent's `allowedTools`/`deniedTools` by default. The `spawn_subagent` call can optionally specify additional `deniedTools` to further restrict the child (but never expand beyond the parent's permissions).

*Justification:* Security principle of least privilege. If the parent agent is denied `execute_code`, its children shouldn't be able to use it either. The optional further restriction allows a parent to spawn a read-only research subagent (denied all write/send tools) while keeping its own full permissions.

**Recommendation 4: Wire cascade-kill through the existing halt manager.**

When a parent agent is stopped (via `/kill`, cost pause, or timeout), Orchestrator automatically kills all its active subagents. Extend the halt manager to track parent-child relationships and cascade SIGTERM.

*Justification:* Without cascade-kill, orphaned subagents continue consuming resources and potentially taking actions after the parent has been stopped. OpenClaw implements this (`/stop` in parent chat kills children), but their shared-process model makes it a session-level operation. Annabelle's process-level kill is cleaner and more reliable — SIGTERM to a process is guaranteed to stop it, while canceling a session within a shared process depends on cooperative shutdown.

**Recommendation 5: Set `maxConcurrent` per parent agent (3–5).**

Add a `maxSubagents` field to agent configuration. Default to 3. Orchestrator rejects `spawn_subagent` calls that would exceed this limit.

*Justification:* Without a limit, a malfunctioning agent could spawn dozens of subagents, each consuming LLM API calls. Even with per-agent cost monitors, the aggregate cost across many subagents could be significant before individual monitors trigger. A concurrency limit bounds the worst case. 3–5 is enough for useful parallelism (research 3 topics, process 5 files) without excessive resource consumption.

---

## 4. Session Persistence ✅

> **STATUS: IMPLEMENTED** — Session persistence and compaction were implemented in February 2026. Recommendations 1, 2, and 4 are complete. Recommendation 3 (soft-trimming for large tool results) remains open.

### How Annabelle Works

Thinker now persists session state to **JSONL files** at `~/.annabelle/sessions/<agentId>/<chatId>.jsonl`. Each file starts with a header entry (chatId, agentId, timestamp, version), followed by turn entries (user text, assistant text, tools used, token counts) and optional compaction entries (LLM summary replacing older turns).

The in-memory `Map<chatId, AgentState>` serves as a **hot cache** backed by JSONL on disk. On cache miss (first message for a chatId after restart), the session is lazy-loaded from disk. On every turn, the new exchange is appended to the JSONL file. Sessions survive restarts, crashes, and memory eviction.

**Session compaction** automatically manages context growth. When estimated tokens exceed a configurable threshold (~12,500 tokens / 50K chars) and the conversation has 15+ turns, a **dedicated cheap model** (Llama 3.1 8B Instant on Groq) summarizes older turns into a compaction entry. The 10 most recent turns are kept intact. The JSONL file is atomically rewritten (temp file + rename). The compaction summary is injected into the system prompt as "Previous Conversation Context" for subsequent messages. A 5-minute cooldown prevents excessive compaction.

Periodic cleanup (every 5 minutes) deletes session files with no activity in 7 days (configurable via `THINKER_SESSION_MAX_AGE_DAYS`).

### How OpenClaw Works

OpenClaw persists sessions as **JSONL files** at `~/.openclaw/agents/<agentId>/sessions/<SessionId>.jsonl`. The first line is a session header (`type: "session"`, includes ID, working directory, timestamp, optional parent session reference). Subsequent lines are session entries forming a tree structure via `parentId` references. A session store (`sessions.json`) maps session keys to session IDs and metadata.

Sessions survive restarts, crashes, and even model switches mid-session. Automatic repair handles corrupted JSONL files. Write locking prevents concurrent writes to the same session file.

**Session compaction** automatically manages context window limits. When the conversation approaches the token limit, older messages are summarized into a compaction entry that replaces them. The default reserve floor is 20,000 tokens — headroom for multi-turn housekeeping before compaction becomes unavoidable. For a 200K context window with ratio 0.4, compaction chunks are capped at 80K tokens. Tool results exceeding 4,000 characters are soft-trimmed: first 1,500 characters + last 1,500 characters, preserving both the beginning (usually the key result) and the end (usually error messages or final status).

### Which Architecture Is Superior

**Both systems now have robust session persistence with JSONL files and automatic compaction.** The core capability gap has been closed.

**OpenClaw's session system is more mature in some details:** automatic JSONL repair for corrupted files, write locking for concurrent access, tree-structured entries via `parentId` references, and soft-trimming of large tool results (head+tail pattern). These are incremental improvements over Annabelle's simpler implementation.

**Annabelle's compaction model is more cost-efficient:** it uses a dedicated cheap model (Llama 3.1 8B Instant) for summarization rather than the main agent model, reducing compaction cost to a fraction of a cent per call. The compaction model is independently configurable (provider + model) and falls back to the main model if not configured.

**Annabelle's lazy-loading approach is cleaner:** sessions load from disk only on cache miss, avoiding unnecessary I/O. The in-memory Map acts as a transparent cache. OpenClaw's session store requires a `sessions.json` index file alongside the JSONL files.

### Remaining Gaps

**Recommendation (remaining): Implement soft-trimming for large tool results.**

When a tool result exceeds 4,000 characters, store only the first 1,500 + last 1,500 characters in the session history (with a `[... truncated ...]` marker). Store the full result in a separate file referenced by the session entry.

*Justification:* Tool results (especially from web search, email listing, or future code execution) can be very large. Storing them verbatim in session history wastes context window tokens on subsequent LLM calls. The head+tail pattern preserves the most useful parts: the beginning (typically the key answer or first results) and the end (typically error messages, final status, or the last results). OpenClaw uses exactly this pattern with the same thresholds.

---

## 5. Playbooks vs Skills

### How Annabelle Works

Playbooks are **database-driven workflow templates** stored in Memory MCP's `skills` table. Each has a name, description, trigger keywords, priority (5–15), step-by-step instructions in Markdown, required tools, and enabled/disabled status. The `classifyMessage` function does simple lowercase substring matching — if the user says "check my email," the `email-triage` playbook matches on "email" and its instructions get injected into the system prompt as "## Workflow Guidance."

Twelve default playbooks are seeded on first startup (email triage, research, daily briefing, task management, file organization, etc.). Multiple playbooks can match a single message, ranked by priority. They're cached in-memory with a 5-minute refresh from the database.

Critically, playbooks are **runtime-editable** — the agent itself can create, modify, or delete playbooks via Memory MCP tools. An agent that notices a repeated pattern (e.g., the user always wants email summaries formatted a certain way) can create a new playbook encoding that preference.

### How OpenClaw Works

Skills are **file-based directories** containing a `SKILL.md` with YAML frontmatter (name, description, emoji, OS requirements, binary dependencies, installation instructions) and Markdown instructions. They load from three tiers with clear precedence: `<workspace>/skills` (highest) → `~/.openclaw/skills` → bundled skills (lowest).

Skills can be user-invocable (exposed as `/slash-commands` with `user-invocable: true`) or model-only. Some use `command-dispatch: tool` to bypass the LLM entirely and execute a tool directly. Skills are filtered at load time based on environment, platform, and binary availability — a macOS-only skill won't load on Linux.

ClawHub provides a **marketplace of 52 installable skills** covering notes (Apple Notes, Obsidian, Notion), music (Spotify, Sonos), smart home (Philips Hue), development (GitHub, Coding Agent), and more. A vulnerability scanner (`skill-scanner.ts`) checks skills for security issues before installation.

Skills are injected into the system prompt as a compact XML list via `formatSkillsForPrompt()`.

### Which Architecture Is Superior

**OpenClaw's skill system is superior for distribution, curation, and ecosystem building.** File-based skills with YAML frontmatter are easy to share, version, and review. The three-tier precedence (workspace → user → bundled) allows clean customization without modifying upstream. ClawHub with 52 skills demonstrates a functioning ecosystem. The vulnerability scanner adds safety.

**Annabelle's playbook system is superior for autonomous learning and runtime adaptation.** Database-driven playbooks can be created and modified by the agent itself at runtime — this is something OpenClaw's file-based skills cannot do (the agent would need to write files to disk, which is a different operation with different permissions). A learning assistant that creates new playbooks based on observed patterns is more valuable long-term than a static set of pre-written skills.

Neither system is strictly better — they solve different problems. Playbooks are for dynamic, agent-learned workflows. Skills are for curated, distributable capabilities.

### Recommendations

**Recommendation 1: Keep database-driven playbooks for agent-created workflows.**

The ability for the agent to create, modify, and delete playbooks at runtime is a genuine differentiator. Don't replace it with file-based skills.

*Justification:* Runtime-editable playbooks enable a learning loop: the agent observes a pattern → creates a playbook → applies it next time → refines based on feedback. This gets more valuable over time as the agent accumulates more playbooks tailored to the specific user's needs. Pre-written skills can't adapt this way. This is one of Annabelle's few features that OpenClaw lacks entirely.

**Recommendation 2: Add a file-based skill loading path alongside playbooks.**

Create a `~/.annabelle/skills/` directory. At startup, scan for `SKILL.md` files, parse YAML frontmatter + Markdown instructions, and register them alongside database playbooks. Give file-based skills higher priority than database playbooks (but lower than user-created playbooks with elevated priority).

*Justification:* This enables curated, version-controlled skills that don't require database manipulation. You (the developer) can ship a set of well-tested skills as files. You can share skills between machines by copying directories. You can version them with git. This complements the database-driven playbooks — files for curated skills, database for agent-learned workflows. The two systems coexist with clear precedence.

---

## 6. Persona Configuration

### How Annabelle Works

Persona lives in Memory MCP's `profiles` table as a JSON blob: `{ persona: { name, style, tone, system_prompt }, capabilities: {...}, proactive_behaviors: {...} }`. The system prompt has a priority chain: custom file (if `THINKER_SYSTEM_PROMPT_PATH` env var is set) → profile override → built-in `DEFAULT_SYSTEM_PROMPT`. Profile history is tracked in a `profile_history` table with rollback capability.

To change the persona, you either call `update_profile` through a tool, edit the SQLite database directly, or modify the `THINKER_SYSTEM_PROMPT_PATH` file. The profile is loaded once at Thinker startup via the context manager and cached for the session.

### How OpenClaw Works

OpenClaw uses **workspace markdown files** at `~/.openclaw/workspace/`, initialized with `git init` for version tracking:

- `SOUL.md` — behavioral philosophy, values, decision-making stance
- `IDENTITY.md` — name, vibe, emoji (created during a "bootstrap ritual")
- `AGENTS.md` — operating instructions, rules, priorities, tool usage preferences
- `USER.md` — user preferences and context
- `TOOLS.md` — capability documentation
- `HEARTBEAT.md` — monitoring and health configuration

At session start, the Pi agent reads these files from disk and injects their contents into the system prompt — `AGENTS.md` content goes into operating instructions, `SOUL.md` into behavioral guidance, `USER.md` into user context. There is no hot-reload; the next session picks up changes. The git tracking is passive — it exists for the user to run `git diff` or `git checkout`, not used programmatically by OpenClaw.

### Which Architecture Is Superior

**OpenClaw's file-based approach is superior for usability.** Editing a markdown file in any text editor is faster and more natural than calling `update_profile` through a tool or editing a SQLite row. The separation of concerns (instructions vs identity vs user context) makes each file focused and easier to reason about. Git tracking provides change history without needing a custom `profile_history` table.

**Annabelle's database approach is superior for programmatic modification.** If an agent needs to update its own persona based on learned preferences (e.g., adjusting communication style after feedback), API-driven profile updates are cleaner than writing to markdown files on disk. The profile history table with rollback is more structured than git for automated use.

**OpenClaw's soul/identity philosophy is irrelevant for a worker agent.** `SOUL.md` with behavioral philosophy and `IDENTITY.md` with a "bootstrap ritual" are product design choices aimed at emotional engagement. For an effective worker assistant, these add complexity without value. The mechanism (markdown files, separation of concerns) is worth adopting; the spiritual framing is not.

### Recommendations

**Recommendation 1: Move static agent configuration to markdown files.**

Create `~/.annabelle/agents/<agentId>/instructions.md` for each agent. This file contains the system prompt, behavioral rules, tool usage preferences, and response style guidelines. Read it at Thinker startup and prepend it to the system prompt. A single `instructions.md` per agent — no need for OpenClaw's 5-file separation.

*Justification:* The current approach requires calling `update_profile` through a tool or editing SQLite to change how an agent behaves. A markdown file can be opened in any editor, modified, and saved. The next agent session picks up the changes. This is faster iteration for the developer (you) when tuning agent behavior. It also makes agent configuration visible and versionable — you can commit `instructions.md` to git alongside the rest of the codebase.

**Recommendation 2: Keep Memory MCP profiles for dynamic runtime state only.**

Continue using the `profiles` table for facts the agent learns, dynamic preferences, and runtime state. Don't store static configuration (system prompt, behavioral rules) in the database — that belongs in the file.

*Justification:* Clean separation: files for what you (the developer) configure, database for what the agent learns. This eliminates the ambiguity of the current system where the system prompt might come from an env var, a profile override, or a built-in default. Static config lives in one place (the file), dynamic state lives in another (the database). Each is edited with the appropriate tool (text editor vs API).

**Recommendation 3: Optionally initialize agent config directories with `git init`.**

When creating a new agent config directory, run `git init` and commit the initial `instructions.md`. This provides change history for free.

*Justification:* Low-cost, high-value. When you tweak an agent's instructions and it starts behaving worse, `git diff` shows exactly what changed. `git checkout` reverts it. This replaces the `profile_history` table for static configuration with a tool that's more powerful and already familiar. The implementation is trivial — a single `git init && git add . && git commit -m "initial"` at directory creation time.

---

## 7. Learning About the User

### How Annabelle Works

Annabelle learns about the user through two mechanisms: **explicit fact storage** and **conversation logging**.

**Explicit fact storage** relies on the LLM deciding during conversation that something is worth remembering. The system prompt instructs Thinker to call `store_fact` when it encounters user preferences, background information, patterns, projects, contacts, or decisions. Each fact gets a category, a confidence score (0.0–1.0), and optional tags. When the agent encounters "I prefer dark mode in all my apps," it's expected to call `store_fact({ fact: "User prefers dark mode in all apps", category: "preference", confidence: 0.9 })`. The 60% keyword-overlap deduplication prevents storing the same fact twice with slightly different wording.

**Conversation logging** stores every exchange in the `conversations` table — user message, agent response, timestamp, agent ID. This is append-only archival, not active learning. The agent can later search conversations via `search_conversations`, but this is reactive retrieval, not proactive extraction.

**Context assembly** at message time loads the user profile (from the `profiles` table) and relevant facts (via keyword matching against the incoming message). These get injected into the system prompt so the LLM has prior knowledge when responding.

The README mentions "automatic fact extraction from conversations" and "periodic synthesis of learnings," but from the architecture documents, these appear to be planned rather than fully implemented. The current system depends entirely on the LLM choosing to call `store_fact` during the natural flow of conversation — there is no post-conversation extraction pipeline that reviews what was said and distills new facts.

### How OpenClaw Works

OpenClaw learns about the user through three layers: **workspace files**, **agent-written memory files**, and **session compaction**.

**`USER.md`** is a static workspace file the user edits directly. It contains preferences, context, and background that the user wants the agent to know. This isn't "learning" — it's manual configuration. The agent reads it at session start and injects it into the system prompt. The user updates it when their preferences change.

**Memory files** in `~/.openclaw/memory/<agentId>/` are markdown documents the agent writes during conversations. When the agent learns something, it writes to a memory file using the standard `write` tool (one of Pi's 4 core tools). These files are chunked and embedded for later retrieval via hybrid search. The agent can create new memory files, append to existing ones, or organize them into subdirectories. Because Pi can write arbitrary files, the memory format is flexible — the agent structures its notes however it finds most useful.

**Session compaction** is an indirect learning mechanism. When a long conversation is compacted, the summary preserves key facts, decisions, and context. This compacted context persists across sessions. While not explicitly "learning about the user," it means that important user information discussed early in a conversation survives even when the raw messages are compressed.

The QMD (query/memory document) manager handles the retrieval side — when the agent needs to recall something about the user, it searches memory files using hybrid vector + BM25 search. The semantic understanding of vector search means loosely related information surfaces even without exact keyword matches.

### Which Architecture Is Superior

**For extraction quality: roughly equal, but with different failure modes.** Both systems depend on the LLM deciding what's worth remembering during conversation. Annabelle uses a dedicated `store_fact` tool with structured categories. OpenClaw uses general-purpose file writing. Neither has a post-conversation extraction pipeline that systematically reviews exchanges and extracts facts the LLM missed in the moment. Both fail when the LLM is focused on completing a task rather than noting user preferences revealed along the way — which is frequent during tool-heavy conversations.

**For storage structure: Annabelle is superior.** Categorized facts with confidence scores, tags, and deduplication are more organized than free-form markdown files. When you have 500 facts, knowing that 80 are preferences, 120 are project-related, and 45 are contacts is structurally useful for querying, auditing, and management. OpenClaw's markdown files can contain anything in any format — flexible but harder to query systematically and impossible to audit at a glance.

**For retrieval: OpenClaw is superior.** As covered in the Memory Architecture section — vector embeddings with hybrid search find semantically related facts that keyword matching misses. A fact stored as "prefers terminal-based workflows" will match a query about "command line preferences" in OpenClaw but not in Annabelle.

**For user control and transparency: Annabelle is superior.** The 11 memory tools (list, delete, search, export, import) give explicit control over what the agent knows. The memory export to `~/.annabelle/memory-export/` makes everything visible and editable. OpenClaw's `USER.md` is manually editable (good), but the agent-written memory files in `~/.openclaw/memory/` are less structured and harder to audit comprehensively.

**For passive/ambient learning: OpenClaw is slightly superior.** Session compaction means that user information mentioned in passing during long conversations gets preserved in compressed form, even if nobody explicitly stored it as a fact. In Annabelle, if the LLM didn't call `store_fact`, that information exists only in the `conversations` table — retrievable by manual search but not proactively surfaced in future context assembly.

**Overall: neither system is good at this.** Both depend on the LLM volunteering to remember things, which is unreliable. The real gap in both systems is the absence of a **systematic extraction pipeline** — a post-conversation process that reviews what was discussed and identifies new facts to store. Neither project has solved this well. This represents an opportunity for Annabelle to leapfrog OpenClaw's approach.

### Recommendations

**Recommendation 1: Add a post-conversation fact extraction step.**

After each conversation turn (or after a conversation goes idle for 5 minutes), send the exchange to a lightweight LLM call with a focused prompt: "Review this conversation. Extract any new facts about the user (preferences, background, decisions, contacts, projects, patterns) that aren't already in the known facts list. Return structured facts or an empty list." Compare against existing facts using the 60% deduplication check, and store new ones automatically.

*Justification:* This closes the biggest gap in both systems — facts that the LLM didn't think to store during the conversation. During a task-focused exchange ("send this email to my colleague Jan at jan@example.com"), the LLM is focused on sending the email, not on noting that Jan is a colleague with that email address. A post-conversation extraction pass catches these implicit facts. The cost is one additional LLM call per conversation (a few hundred tokens with a small model like Groq's llama-3.3), which is negligible. This would make Annabelle's learning meaningfully better than both its current state and OpenClaw's approach, which has no equivalent mechanism.

**Recommendation 2: Add periodic memory synthesis via Inngest.**

Schedule a weekly Inngest job that loads all facts and recent conversations, sends them to the LLM with a prompt like "Review these facts and conversations. Identify patterns, contradictions, or facts that should be updated. Suggest merges for duplicate facts. Flag stale facts that may no longer be accurate." Store the synthesis results and apply suggested updates (with logging).

*Justification:* Individual facts accumulate but don't get refined. After 6 months, you might have "prefers dark mode" (stored January), "switched to light mode for presentations" (stored March), and "uses auto dark mode" (stored May). A synthesis step would consolidate these into "uses auto dark mode; prefers dark for coding, light for presentations" — one coherent fact instead of three potentially contradictory ones. This is already in Annabelle's architecture plan (Phase 3) and the Inngest infrastructure to run it already exists. OpenClaw has no equivalent.

**Recommendation 3: Add fact extraction from conversation history backfill.**

Run a one-time Inngest job that scans the existing `conversations` table, sends batches to the LLM for fact extraction, and populates the `facts` table with historical learnings. This recovers information from past conversations where `store_fact` wasn't called.

*Justification:* Months of conversation history exist in the database but were never mined for facts. A backfill extracts user preferences, project details, contacts, and patterns that the LLM learned but didn't store during real-time conversation. This is a one-time cost (process N conversations × small LLM call each) that immediately enriches the fact base. After this, Recommendation 1 (post-conversation extraction) handles future conversations continuously.

**Recommendation 4: Keep structured facts — don't switch to free-form markdown files.**

OpenClaw's approach of writing unstructured markdown to memory files is flexible but loses the queryability of categorized, tagged, confidence-scored facts. Keep the current `store_fact` structure.

*Justification:* Structured facts enable queries that free-form files can't: "list all contact facts," "show preferences with confidence below 0.7," "delete all facts in the project category for project X." These are useful for memory management and transparency. When vector search is added (see Memory Architecture section), structured facts get the best of both worlds — semantic retrieval through embeddings plus structured querying through categories and tags. Free-form markdown files only get semantic retrieval, losing the ability to filter, categorize, and audit systematically.

---

## 8. Memory Architecture

### How Annabelle Works

Memory MCP uses SQLite with 4 tables: `facts`, `conversations`, `profiles`, `skills`. Retrieval in `retrieve_memories` splits the query into keywords, runs `LIKE %keyword%` queries against the facts table, and ranks results by a combination of keyword overlap and confidence/freshness. Facts are categorized (preference, background, pattern, project, contact, decision) with 60% keyword-overlap deduplication on storage. There are 11 memory tools covering store, list, delete, search, profile management, stats, export, and import.

The system has no semantic understanding. "I enjoy cycling" stored as a fact will not match a query about "hobbies" or "exercise" because there is no keyword overlap. Similarly, "Tomasz lives in Kraków" won't match "where does the user live in Europe?" because "Europe" doesn't appear in the stored fact. As the fact count grows, keyword matching becomes increasingly inadequate — relevant facts are missed while irrelevant ones (with coincidental keyword matches) are returned.

### How OpenClaw Works

OpenClaw's memory system spans **43 files** with a fundamentally different architecture. The source of truth is markdown files in `~/.openclaw/memory/<agentId>/`. SQLite serves as an acceleration index over these files, with two key extensions:

**Vector search (default 70% weight):** Markdown files are chunked and embedded. Embeddings are stored in SQLite via the `sqlite-vec` extension (a SQLite loadable extension for vector operations). Retrieval uses cosine similarity against the query embedding. Embedding providers auto-select in priority order: local `node-llama-cpp` (auto-downloads GGUF models from HuggingFace on first use) → OpenAI → Google Gemini → fallback to keyword-only.

**BM25 keyword search (default 30% weight):** SQLite FTS5 (Full-Text Search 5) provides proper tokenized keyword matching, far more sophisticated than `LIKE %keyword%`. Score conversion: `textScore = 1 / (1 + max(0, bm25Rank))`.

**Hybrid search** takes the **union** (not intersection) of both result sets. Final ranking: `finalScore = vectorWeight * vectorScore + textWeight * textScore`. Configuration: `hybrid: { enabled: true, vectorWeight: 0.7, textWeight: 0.3, candidateMultiplier: 4 }`.

**Graceful degradation:** If embeddings are unavailable (provider down, model not loaded, zero-vector returned), the system runs BM25-only and returns keyword matches. If all providers fail, it degrades to keyword-only search. The system never hard-fails on memory retrieval.

### Which Architecture Is Superior

**OpenClaw's memory architecture is clearly superior.** This is the largest capability gap between the two systems.

Vector embeddings with hybrid search solve a fundamental problem that keyword matching cannot: semantic similarity. "Where does the user live in Europe?" finds "Tomasz lives in Kraków" because the embeddings for these sentences are geometrically close in the embedding space, even with zero keyword overlap. As fact count grows (hundreds to thousands), semantic retrieval becomes not just better but necessary — keyword matching at scale returns too many false positives (coincidental word matches) and misses too many true positives (semantically relevant facts with different wording).

OpenClaw's architecture is also more resilient. The auto-fallback chain (local → OpenAI → Gemini → BM25-only) means memory always works, with degraded but functional retrieval when embedding providers are unavailable. Annabelle's `LIKE %keyword%` doesn't have a better mode to fall back from — it's already the minimum viable implementation.

The union-based hybrid approach (rather than intersection) is a particularly smart design choice. It ensures that both semantically similar results AND exact keyword matches contribute to the final ranking. A query for "error ERR_CONNECTION_REFUSED" benefits from BM25 matching the exact error code, while a query for "network problems" benefits from vector similarity even if no stored fact contains those exact words.

### Recommendations

**Recommendation 1: Add `sqlite-vec` for vector storage in Memory MCP.**

Install the `sqlite-vec` SQLite extension and add a `vec_facts` table alongside the existing `facts` table. When a fact is stored, compute its embedding and store the vector in `vec_facts`. When querying, compute the query embedding and use cosine similarity to find the closest facts.

*Justification:* This is the single highest-impact improvement to Annabelle's memory system. It transforms retrieval from literal keyword matching to semantic understanding. Every fact stored becomes findable by meaning, not just by exact words. The implementation is additive — the existing `facts` table and keyword-based retrieval remain unchanged. Vector search is layered on top, and results from both are merged. `sqlite-vec` keeps everything in the existing SQLite database — no new infrastructure (no Postgres, no Pinecone, no separate vector database).

**Recommendation 2: Implement hybrid search with weighted scoring.**

Combine vector similarity (70% weight) with FTS5 full-text search (30% weight). Take the union of both result sets. Use OpenClaw's proven scoring formula: `finalScore = 0.7 * vectorScore + 0.3 * textScore`.

*Justification:* Neither vector search nor keyword search alone is optimal. Vector search excels at semantic similarity but can miss exact matches (specific error codes, names, dates). BM25 keyword search excels at exact token matching but misses semantic relationships. The weighted union gives the best of both — semantic understanding from vectors, precision from keywords. OpenClaw's 70/30 split is empirically validated across their user base.

**Recommendation 3: Start with local embeddings, fall back to API providers.**

Use `node-llama-cpp` with an auto-downloaded GGUF embedding model for local, free, offline-capable embeddings. Fall back to OpenAI's `text-embedding-3-small` if local fails. Fall back to BM25-only if both fail.

*Justification:* Local embeddings are free, fast (no API latency), and work offline. On a 128GB MacBook Pro, running a small embedding model locally is trivial — embedding models are 50–200MB, not multi-gigabyte LLMs. The fallback chain ensures memory always works: best quality with local embeddings → good quality with API embeddings → acceptable quality with keyword-only search. This mirrors OpenClaw's resilience model.

**Recommendation 4: Migrate existing facts to vector storage.**

After implementing vector search, run a one-time migration that computes embeddings for all existing facts and populates the `vec_facts` table. Add a background job (Inngest) that re-embeds facts periodically if the embedding model changes.

*Justification:* Without migration, existing facts would only be findable via keyword search until they're re-stored. A one-time migration ensures all historical facts benefit from semantic retrieval immediately. The Inngest background job handles the edge case where you switch embedding models (different models produce incompatible vectors). Re-embedding ~1,000 facts with a local model takes seconds.

---

## 9. Summary — Prioritized Recommendations

Recommendations ranked by impact-to-effort ratio, with codebase change estimates.

### ✅ Priority 1: Session Persistence + Compaction
**Impact: Critical | Effort: Medium | Codebase change: ~300 lines | Implemented Feb 2026**

Sessions now persist to JSONL files at `~/.annabelle/sessions/<agentId>/<chatId>.jsonl`. Lazy-loaded on cache miss, append-only during normal operation, atomically rewritten during compaction. Compaction uses a dedicated cheap model (Llama 3.1 8B Instant on Groq) configurable via `THINKER_COMPACTION_PROVIDER` / `THINKER_COMPACTION_MODEL`. Periodic cleanup removes sessions older than 7 days.

Files added: `Thinker/src/session/store.ts`, `types.ts`, `index.ts`. Files modified: `agent/loop.ts`, `agent/types.ts`, `llm/factory.ts`, `llm/providers.ts`, `config.ts`, `index.ts`. No changes to Orchestrator or other MCPs.

**Remaining gap:** Soft-trimming for large tool results (head+tail pattern for results >4K chars) is not yet implemented.

### ⬜ Priority 2: Vector Memory (sqlite-vec + Hybrid Search)
**Impact: High | Effort: Medium-High | Codebase change: ~400–500 lines**

The second largest gap. As fact count grows, keyword matching becomes actively harmful — missing relevant facts and returning irrelevant ones. Vector search transforms memory from a simple lookup to genuine understanding.

The change is primarily in Memory MCP: add `sqlite-vec` as a dependency, create a `vec_facts` table, add embedding computation on `store_fact`, add vector search path in `retrieve_memories`, implement hybrid scoring. Touch points: `Memorizer-MCP/src/db/` (schema + queries), `Memorizer-MCP/src/embeddings/` (new module for local + API providers), `Memorizer-MCP/src/tools/` (modified retrieval logic). A migration script for existing facts. No changes to Orchestrator or Thinker — the memory interface stays the same.

### ✅ Priority 3: Post-Conversation Fact Extraction
**Impact: High | Effort: Low-Medium | Codebase change: ~100–150 lines | Implemented Feb 2026**

After a conversation goes idle for 5 minutes (configurable via `THINKER_FACT_EXTRACTION_IDLE_MS`), Thinker reviews recent turns using the cheap compaction model (Groq Llama 8B) and extracts user facts that were missed during task-focused exchanges. It fetches existing facts first to avoid duplicates, then stores new discoveries via the Memory MCP's `store_fact` tool. This complements the existing per-turn extraction in Memorizer-MCP by adding multi-turn context awareness and known-fact deduplication.

Files added: `Thinker/src/agent/fact-extractor.ts`. Files modified: `Thinker/src/agent/loop.ts` (idle timer scheduling + extraction orchestration), `Thinker/src/agent/types.ts` (`lastExtractionAt` on `AgentState`), `Thinker/src/config.ts` (`FactExtractionConfigSchema` + env vars), `Thinker/src/orchestrator/client.ts` (`listFacts` method). No changes to Memorizer-MCP, Orchestrator, or other MCPs.

### ⬜ Priority 4: Conversation History Backfill
**Impact: High (one-time) | Effort: Low | Codebase change: ~50–80 lines**

Recovers user knowledge from months of existing conversation history that was never mined for facts. A one-time Inngest background job that processes the `conversations` table in batches.

Touch points: a new Inngest function in `Orchestrator/src/jobs/` that reads conversation batches, sends them to the LLM for fact extraction, and calls `store_fact` for new discoveries. Uses existing Memory MCP tools and Inngest infrastructure. No changes to Thinker, Orchestrator core, or other MCPs. Run once, then disable.

### ⬜ Priority 5: Memory Synthesis (Weekly)
**Impact: Medium-High | Effort: Low-Medium | Codebase change: ~80–120 lines**

Consolidates accumulated facts over time — merging duplicates, resolving contradictions, flagging stale information. Already planned in Annabelle's Phase 3 and the Inngest infrastructure exists.

Touch points: a new Inngest cron function in `Orchestrator/src/jobs/` that loads all facts, groups by category, sends to LLM for synthesis, and applies updates via Memory MCP tools. Similar to backfill — uses existing infrastructure, no structural changes.

### ⬜ Priority 6: Code Execution Tool
**Impact: High | Effort: Medium | Codebase change: ~150–250 lines**

Closes the biggest capability gap in agent runtime. Enables the agent to solve novel problems by writing and running code, without abandoning the existing tool-rich architecture.

New MCP or new tools in Filer MCP: `execute_code` tool implementation, Docker sandbox configuration, Guardian integration for code scanning. Touch points: new `CodeExec-MCP/` package (or additions to `Filer-MCP/src/tools/`), Guardian config update to scan code execution inputs/outputs. If using Docker, a `Dockerfile` for the sandbox container. Orchestrator auto-discovers the new MCP — no Orchestrator code changes needed.

### ⬜ Priority 7: Subagent Spawning
**Impact: High | Effort: Medium | Codebase change: ~300–400 lines**

Enables parallel work — the most requested capability for autonomous agents. Your architecture is naturally suited for it.

Touch points: new `spawn_subagent` tool in Orchestrator, `AgentManager` modifications for dynamic agent spawning with parent tracking, cascade-kill logic in halt manager, result callback routing. `Orchestrator/src/agents/agent-manager.ts` (spawn/track/kill), `Orchestrator/src/core/tool-router.ts` (new tool), `Orchestrator/src/core/halt-manager.ts` (cascade logic). No Thinker changes — subagents are just Thinker instances with additional metadata.

### ⬜ Priority 8: File-Based Persona Configuration
**Impact: Medium | Effort: Low | Codebase change: ~50–100 lines**

Improves developer experience for tuning agent behavior. Small change, immediate quality-of-life improvement.

Create `~/.annabelle/agents/<agentId>/instructions.md`. Add file-reading logic to Thinker's context manager. Touch points: `Thinker/src/agent/loop.ts` (read file at session start), `Thinker/src/config.ts` (new config path). Optionally, a setup script that initializes the directory with `git init`. No changes to Memory MCP — profiles continue to work for dynamic state.

### ⬜ Priority 9: File-Based Skill Loading
**Impact: Medium | Effort: Low-Medium | Codebase change: ~100–150 lines**

Complements existing playbooks with curated, version-controlled skills. Low risk, additive change.

Add a skill scanner to Thinker that reads `~/.annabelle/skills/` at startup, parses YAML frontmatter + Markdown instructions, and registers them alongside database playbooks. Touch points: new `Thinker/src/agent/skill-loader.ts`, modifications to `Thinker/src/agent/playbook-classifier.ts` (merge file-based skills into matching). No database changes — file-based skills coexist with database playbooks.

### ⬜ Priority 10: Lazy-Spawn / Idle-Kill for Agents
**Impact: Low | Effort: Low | Codebase change: ~50–80 lines**

Operational cleanliness. Not critical on a 128GB machine but good practice.

Touch points: `Orchestrator/src/agents/agent-manager.ts` (add `lastActivityAt` tracking, periodic idle check, lazy spawn on first message). No changes to Thinker or other MCPs.

### ⬜ Priority 11: Shared HTTP Server with Path Routing
**Impact: Low | Effort: Medium | Codebase change: ~200–300 lines**

Architectural cleanup. Only matters if agent count grows beyond ~10. Defer unless port management becomes a real problem.

Touch points: `Orchestrator/src/index.ts` (add agent routes), `Thinker/src/index.ts` (switch from own HTTP server to stdin/stdout communication), `AgentManager` (change from port-based to stdio-based spawning). This is a refactor of existing code, not new functionality — moderate risk of breaking things.
