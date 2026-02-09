# Annabelle Architecture Deep Dive v2 — Comparison with OpenClaw & Roadmap

*Updated February 2026. Reflects 9 of 11 original recommendations now implemented. Based on source code exploration of both projects.*

*Annabelle: ~8 MCP packages, ~65 tools. OpenClaw: 300+ TypeScript files, 309 in agents alone, 52 skills, 176k GitHub stars.*

---

## Progress Since v1

The original deep dive (January 2026) identified 11 prioritized recommendations. Nine have been implemented:

| # | Recommendation | Status |
|---|---|---|
| 1 | Session Persistence + Compaction | ✅ Implemented |
| 2 | Vector Memory (sqlite-vec + Hybrid Search) | ✅ Implemented |
| 3 | Post-Conversation Fact Extraction | ✅ Implemented |
| 4 | Conversation History Backfill | ✅ Implemented |
| 5 | Memory Synthesis (Weekly) | ✅ Implemented |
| 6 | Code Execution Tool | ⬜ Open |
| 7 | Subagent Spawning | ✅ Implemented |
| 8 | File-Based Persona Configuration | ✅ Implemented |
| 9 | File-Based Skill Loading | ✅ Implemented |
| 10 | Lazy-Spawn / Idle-Kill | ✅ Implemented |
| 11 | Shared HTTP Server | ⬜ Open |

This changes the competitive picture materially. Several sections where Annabelle was behind are now at parity or ahead. The reassessment below reflects the current state of the codebase, not aspirational plans.

---

## 1. Agent Runtime

### How Annabelle Works

Annabelle's Thinker is a **bounded executor** built on Vercel AI SDK's `generateText` with `maxSteps: 8`. Orchestrator sends a message via `POST /process-message`, Thinker builds context (system prompt + persona file + facts + conversation history + compacted context + playbook/skill instructions), passes it to the LLM, and the SDK handles the ReAct loop — iterating tool calls until the LLM emits a final text response or hits the step limit. On failure, it retries once with tools, then falls back to text-only.

The agent has access to **65+ pre-built tools** across 8 MCP servers. Dynamic tool selection uses keyword-based routing to pick only relevant tool groups per message. The ceiling of what Thinker can do in a single turn is defined by what tools exist. If it encounters a task no tool covers — parsing a CSV, transforming data, running calculations — it cannot improvise.

### How OpenClaw Works

OpenClaw's Pi is an **embedded agent runtime** imported as a library via `createAgentSession()`. Pi ships with exactly **4 coding tools** — `read`, `write`, `edit`, `exec` — plus process management. The philosophy is that the LLM extends itself by writing and executing code. Need a capability? Write a script, run it, read the output, fix errors, re-run.

OpenClaw layers its own tools on top (browser, canvas, nodes, cron, sessions, messaging), but Pi's real power is arbitrary code execution. The runtime is streaming-first with sophisticated block chunking — paragraph and code fence boundary awareness, soft-chunks at 800–1,200 characters.

### Which Architecture Is Superior — Updated Assessment

**OpenClaw's runtime remains superior for autonomy and flexibility.** An agent that writes and executes arbitrary code handles novel problems without pre-built tooling. This gap has not changed — Annabelle still cannot improvise when no tool exists for a task.

**Annabelle's runtime remains superior for safety, auditability, and governance.** Every action maps to a named tool with defined parameters. Guardian scans inputs and outputs. Per-agent tool policies restrict what each agent does. Cost monitors track usage. When Pi writes and executes arbitrary code, none of these safety layers apply to the generated code.

**Net change since v1: None.** This is the largest remaining capability gap. The code execution tool (Priority 6) would close it.

### Remaining Recommendations

**Add an `execute_code` tool to the MCP ecosystem.** A single new tool that accepts a language (Python, Node, Bash), a code string, and optional timeout. Executes in a subprocess, captures stdout/stderr, returns output. Gate it behind Guardian scanning and tool policy. Consider Docker containers for isolation.

*This is now the single most impactful open recommendation.* It would give Annabelle Pi's core capability while keeping the safety architecture intact — something OpenClaw structurally cannot do because code execution sits below their safety layer, not above it.

**Add output streaming for long-running tool calls.** Code execution introduces tool calls that may run for 30+ seconds. Without streaming, the user has no feedback. A simpler approach than OpenClaw's block streaming: the `execute_code` tool sends periodic Telegram progress updates during execution.

---

## 2. Multi-Agent Architecture

### How Annabelle Works

Each agent is a **separate OS process**. `AgentManager` calls `spawn('node', ['Thinker/dist/index.js'], { env: ... })` with per-agent environment variables. Each agent is a full Thinker instance on its own HTTP port. Health checks every 30 seconds. Crashed agents auto-restart (10-second cooldown, max 5 attempts). Cost monitor per-agent with spike detection. Halt manager persists state to disk.

Channel routing: `(channel, chatId) → agentId` with exact → wildcard → default fallback. Per-agent tool policies via glob-based `allowedTools`/`deniedTools`.

### How OpenClaw Works

All agents in a **single gateway process** with session-level isolation. Agents defined via workspace `AGENTS.md`. Spinning up a new agent creates a session object in memory. Routing via session keys. Each session has its own serialized execution "lane." Agent identity from workspace files (`SOUL.md`, `IDENTITY.md`).

### Which Architecture Is Superior — Updated Assessment

**No change from v1.** Annabelle's process-per-agent model remains superior for isolation, safety, and operational control. OpenClaw's shared-process model remains superior for resource efficiency and configuration simplicity. On a 128GB MacBook Pro, the resource argument remains irrelevant — 200MB per agent × 500+ agents possible.

### What Changed Since v1

**Lazy-spawn and idle-kill (Priority 10) are now implemented.** AgentManager registers agents on startup without spawning them. `ensureRunning()` lazy-spawns on first message with deduplication (concurrent callers share one spawn). An idle scanner runs every 5 minutes and kills agents with no activity beyond their `idleTimeoutMinutes` (configurable per-agent, default 30 minutes). `lastActivityAt` tracking, `AgentState` enum (`stopped`, `starting`, `running`, `stopping`), and graceful `stopAgent()` with prompt file cleanup. ~200 lines across `agent-manager.ts` and `orchestrator.ts`.

### Remaining Recommendations

**Shared HTTP server with path routing (Priority 11).** Replace port-per-agent with path-based routing: `POST /agents/annabelle/process-message`. Only matters if agent count grows beyond ~10. Defer unless port management becomes a real problem.

---

## 3. Subagent Spawning ✅ IMPLEMENTED

### How OpenClaw Works

Agents spawn child agents for parallel work. `sessions_spawn` returns `{ status: "accepted", runId, childSessionKey }` immediately. Subagent runs in a fully isolated session. Single-level depth only (subagents cannot spawn subagents). `maxConcurrent` safety valve. `/stop` cascades to all children.

Known issues: session write lock timeouts, model override not applied to subagents — both symptoms of shared-process contention.

### How Annabelle Works — Current State

Annabelle now has a **`spawn_subagent` tool** that agents can call to delegate tasks to temporary subagent processes. The implementation leverages the process-per-agent architecture for true isolation.

**How it works:**

1. Parent agent calls `spawn_subagent` with a task description and optional tool restrictions
2. `AgentManager.spawnSubagent()` creates a new agent definition inheriting the parent's config (LLM provider, model) with `port: 0` for OS-assigned dynamic port allocation
3. A new Thinker process spawns and announces its actual port via `LISTENING_PORT=XXXXX` on stdout
4. `AgentManager.waitForPortAnnouncement()` parses the port, creates a client, and waits for health
5. The task is dispatched to the subagent via `POST /process-message`
6. The tool **blocks until the subagent finishes** — synchronous from the LLM's perspective
7. The subagent is **immediately killed and cleaned up** after returning its result
8. A safety auto-kill timer (default 5 minutes, configurable up to 30) kills hung subagents

**Safety features:**

- **Single-level depth** — `spawn_subagent` is auto-denied for subagents, preventing recursive spawning
- **Max 5 concurrent subagents per parent** — `subagentsByParent` tracking with concurrency limit
- **Tool policy inheritance** — subagent tools are a subset of parent's; `deniedTools` merge (parent + subagent + `spawn_subagent`)
- **Cascade-kill** — stopping a parent agent cascades to all child subagents via `killSubagent()`
- **Auto-kill timer** — subagents that exceed their timeout are forcefully killed
- **Prompt file cleanup** — temporary system prompt files are deleted on subagent kill

**Implementation:** `Orchestrator/src/tools/spawn-subagent.ts` (tool definition + handler), `Orchestrator/src/core/agent-manager.ts` (spawnSubagent, killSubagent, waitForPortAnnouncement, cascade-kill), `Orchestrator/src/core/orchestrator.ts` (registerAgentDefinition/unregisterAgentDefinition), `Thinker/src/index.ts` (LISTENING_PORT announcement, agentRef health gate), `Thinker/src/config.ts` (port 0 validation).

### Which Architecture Is Superior — Updated Assessment

**Annabelle is now superior.** It has the feature AND the better architecture for it.

Annabelle's process-per-agent model gives subagents true OS-level isolation. Each subagent is a full Thinker process with its own memory space, LLM context, and tool access — no shared state, no write lock contention. OpenClaw's known issues (session write lock timeouts, model override not applied) are structurally impossible in Annabelle's design.

The synchronous model (tool call blocks until subagent finishes) is simpler than OpenClaw's async model and aligns naturally with how MCP tool calls work. Async can be added later if needed.

### No Remaining Recommendations

All five original recommendations are implemented:

1. ✅ **`spawn_subagent` tool in Orchestrator** — dynamic spawning with parent tracking, result return
2. ✅ **Single-level depth** — `isSubagent` flag, `spawn_subagent` auto-denied for subagents
3. ✅ **Inherit parent tool policies** — `allowedTools` filtered to parent's subset, `deniedTools` merged
4. ✅ **Cascade-kill** — `stopAgent()` cascades to all child subagents
5. ✅ **Max concurrent per parent (5)** — `subagentsByParent` map with `MAX_SUBAGENTS_PER_PARENT` check

---

## 4. Session Persistence ✅ IMPLEMENTED

### How Annabelle Works — Current State

Thinker persists sessions to **JSONL files** at `~/.annabelle/sessions/<agentId>/<chatId>.jsonl`. Each file starts with a header (chatId, agentId, timestamp, version), followed by turn entries (user text, assistant text, tools used, token counts) and optional compaction entries.

The in-memory `Map<chatId, AgentState>` is a **hot cache** backed by JSONL on disk. On cache miss, the session lazy-loads from disk. Every turn appends to the JSONL file. Sessions survive restarts, crashes, and memory eviction.

**Session compaction** triggers when estimated tokens exceed ~12,500 tokens / 50K chars and the conversation has 15+ turns. A **dedicated cheap model** (Llama 3.1 8B Instant on Groq, configurable via `THINKER_COMPACTION_PROVIDER`/`THINKER_COMPACTION_MODEL`) summarizes older turns. The 10 most recent turns are kept intact. JSONL is atomically rewritten (temp + rename). Compaction summary injected into system prompt as "Previous Conversation Context." 5-minute cooldown prevents excessive compaction. Periodic cleanup removes sessions with no activity in 7 days.

Implementation: `Thinker/src/session/store.ts`, `types.ts`, `index.ts`. Modified: `agent/loop.ts`, `agent/types.ts`, `llm/factory.ts`, `llm/providers.ts`, `config.ts`, `index.ts`.

### How OpenClaw Works

JSONL files at `~/.openclaw/agents/<agentId>/sessions/<SessionId>.jsonl`. Header + tree-structured entries via `parentId`. Session store (`sessions.json`) maps keys to IDs. Automatic repair for corrupted files. Write locking for concurrent access. Compaction with 20K token reserve floor. Soft-trimming of large tool results (first 1,500 + last 1,500 chars).

### Which Architecture Is Superior — Updated Assessment

**Parity, with different strengths.**

This was the #1 priority in v1 because Annabelle had no persistence at all. That gap is fully closed.

**Annabelle is now ahead on cost efficiency.** Compaction uses a dedicated cheap model (Llama 3.1 8B Instant) rather than the main agent model. This reduces compaction cost to a fraction of a cent per call. The compaction model is independently configurable and falls back to the main model if not set. OpenClaw uses the session's own model for compaction, which is more expensive.

**Annabelle's lazy-loading is cleaner.** Sessions load from disk only on cache miss. OpenClaw's session store requires a `sessions.json` index file alongside JSONL files.

**OpenClaw has more defensive details.** Automatic JSONL repair for corrupted files, write locking for concurrent access, tree-structured entries via `parentId`, and soft-trimming of large tool results. These are incremental improvements — nice to have, not critical.

### Remaining Gap

Soft-trimming for large tool results (head+tail pattern for results >4K chars) is not yet implemented. Low priority — useful primarily when code execution is added, which will produce large outputs.

---

## 5. Playbooks vs Skills ✅ PARTIALLY REIMAGINED

### How Annabelle Works — Current State

Annabelle now has **two complementary systems** running side by side:

**Database-driven playbooks** remain unchanged. 12 defaults in the `skills` table, keyword-matched via `classifyMessage()`, runtime-editable by the agent itself. The agent can create, modify, or delete playbooks based on observed patterns.

**File-based skills** (new) follow the [Agent Skills](https://agentskills.io) open standard. Skills are directories containing `SKILL.md` with YAML frontmatter + markdown instructions, placed in `~/.annabelle/skills/{skill-name}/SKILL.md`. Annabelle-specific extensions (`keywords`, `priority`, `required_tools`) use the spec's `metadata` block. Skills with keywords are matched via `classifyMessage()` identically to playbooks. Skills without keywords are injected as an `<available_skills>` XML block in the system prompt for progressive disclosure — the LLM reads descriptions and decides when to activate.

Implementation: `Thinker/src/agent/skill-loader.ts` (scanner + parser), `playbook-cache.ts` (merges file skills with DB playbooks, `getDescriptionOnlySkills()`), `playbook-classifier.ts` (`source: 'database' | 'file'`), `loop.ts` (progressive disclosure injection). 17 unit tests.

### How OpenClaw Works

File-based directories with `SKILL.md` + YAML frontmatter. Three-tier precedence: `<workspace>/skills` → `~/.openclaw/skills` → bundled. User-invocable skills exposed as `/slash-commands`. ClawHub marketplace of 52 installable skills. Vulnerability scanner for skill security.

### Which Architecture Is Superior — Updated Assessment

**Annabelle's dual system is now arguably superior to OpenClaw's file-only approach.**

Annabelle has everything OpenClaw has for curated skills (file-based, YAML frontmatter, standard-compliant) *plus* runtime-editable database playbooks that the agent itself can create and modify. OpenClaw can only use file-based skills — the agent would need to write files to disk to create new skills, which is a different operation. Annabelle's adoption of the Agent Skills open standard means future interoperability with other Agent Skills-compatible tools.

**OpenClaw remains superior for ecosystem breadth.** ClawHub with 52 installable skills and a vulnerability scanner is a functioning marketplace. Annabelle has no equivalent distribution mechanism. But for a solo-user system, the marketplace advantage is less relevant — what matters is having the skills you need, not having 52 to browse.

**The progressive disclosure pattern is a smart addition.** Skills without keywords don't clutter every message's context — they sit in the system prompt as available options, and the LLM activates them when relevant. This scales better than OpenClaw's approach of injecting all skills into every system prompt.

### No Remaining Recommendations

Both original recommendations (keep DB playbooks + add file-based skills) are implemented. The system is more capable than originally envisioned, with the Agent Skills standard and progressive disclosure pattern going beyond what was recommended.

---

## 6. Persona Configuration ✅ IMPLEMENTED

### How Annabelle Works — Current State

Agent persona lives in an **editable markdown file** at `~/.annabelle/agents/{agentId}/instructions.md`. The default persona is version-controlled in the codebase at `Thinker/defaults/personas/annabelle/instructions.md` and auto-copied to the runtime directory by `start-all.sh` on first startup (never overwrites user edits).

The Thinker loads the persona file at startup and uses it in the system prompt priority chain: `THINKER_SYSTEM_PROMPT_PATH` > persona file > profile override > hardcoded `DEFAULT_SYSTEM_PROMPT`. Both `buildContext()` (user messages) and `processProactiveTask()` (Inngest skills) use the same chain.

Memory MCP's `profiles` table still exists for dynamic runtime state — facts the agent learns, profile preferences set via API. The separation is clean: **files for what the developer configures, database for what the agent learns.**

Implementation: `Thinker/defaults/personas/annabelle/instructions.md`, modified `agent/loop.ts`, `config.ts`, `start-all.sh`.

### How OpenClaw Works

Workspace markdown files at `~/.openclaw/workspace/`:
- `SOUL.md` — behavioral philosophy, values
- `IDENTITY.md` — name, vibe, emoji (bootstrap ritual)
- `AGENTS.md` — operating instructions, rules
- `USER.md` — user preferences
- `TOOLS.md` — capability docs
- `HEARTBEAT.md` — monitoring config

Read at session start, injected into system prompt. Git-initialized workspace for passive change tracking.

### Which Architecture Is Superior — Updated Assessment

**Parity for practical purposes, with different design philosophies.**

Both systems now use editable markdown files for persona configuration. Both read at session start and inject into the system prompt.

**Annabelle's single-file approach is simpler and equally effective.** One `instructions.md` per agent covers everything OpenClaw spreads across 5–6 files. For a worker assistant (not a soul with a bootstrap ritual), the separation of `SOUL.md` from `IDENTITY.md` from `AGENTS.md` adds cognitive overhead without adding capability. The content that matters — behavioral rules, tool usage preferences, response style — fits naturally in one file.

**OpenClaw's git-initialized workspace provides change tracking.** Annabelle's codebase-default + runtime-copy pattern achieves something similar: the default persona is version-controlled in git with the codebase, while user edits at runtime are preserved separately. For explicit version tracking of runtime edits, `git init` in the agent config directory would be trivial to add.

**Annabelle's dual path (file + database) is a genuine advantage.** Static configuration in files, dynamic learned state in the database. OpenClaw puts everything in files, which means dynamic updates require file writes — a heavier operation than a database insert.

### No Remaining Recommendations

All three original recommendations (move to markdown files, keep DB for dynamic state, optional git init) are effectively implemented. The only remaining nicety is explicit `git init` in the agent config directory, which is a one-line addition to `start-all.sh` if desired.

---

## 7. Learning About the User ✅ MAJOR ADVANCEMENT

### How Annabelle Works — Current State

Annabelle now has **four mechanisms** for learning about the user, three of which were implemented since v1:

**1. Real-time fact storage** (existing) — The LLM calls `store_fact` during conversation when it encounters user preferences, background, patterns, projects, contacts, or decisions. Categorized with confidence scores and tags. 60% keyword-overlap deduplication.

**2. Post-conversation fact extraction** (new, Priority 3) — After a conversation goes idle for 5 minutes (configurable via `THINKER_FACT_EXTRACTION_IDLE_MS`), Thinker reviews recent turns using the cheap compaction model (Groq Llama 8B) and extracts facts that were missed during task-focused exchanges. Fetches existing facts first to avoid duplicates. File: `Thinker/src/agent/fact-extractor.ts`.

**3. Conversation history backfill** (new, Priority 4) — An event-triggered Inngest job processes the `conversations` table in batches of 10, using the Memorizer-MCP's `FactExtractor`. Finds unprocessed conversations via LEFT JOIN. Rate-limited at 3 seconds between batches for Groq's rate limits. Sends Telegram notifications at start and completion. File: `Memorizer-MCP/src/tools/backfill.ts`.

**4. Memory synthesis** (new, Priority 5) — Weekly Inngest cron (Sunday 3 AM) consolidates facts per category: merging duplicates, resolving contradictions, flagging stale information. Processes up to 100 oldest facts per category. Validates LLM-suggested changes against actual fact IDs before applying. Sends Telegram summary with per-category breakdown. File: `Memorizer-MCP/src/tools/synthesis.ts`.

**Context assembly** at message time loads the user profile and relevant facts (keyword matching against incoming message) into the system prompt.

### How OpenClaw Works

Three layers, unchanged from v1:

**`USER.md`** — static workspace file the user edits manually. Not learning, just configuration.

**Memory files** in `~/.openclaw/memory/<agentId>/` — markdown documents the agent writes during conversations using Pi's `write` tool. Chunked and embedded for later retrieval via hybrid search. Flexible format, agent-structured.

**Session compaction** — indirect learning. Long conversation summaries preserve facts, decisions, and context across sessions.

No post-conversation extraction. No periodic synthesis. No history backfill. No structured deduplication.

### Which Architecture Is Superior — Updated Assessment

**Annabelle is now clearly superior for user learning.** This is a reversal from v1, where both systems were rated roughly equal (with different failure modes).

The shift comes from three implementations that OpenClaw has no equivalent for:

**Post-conversation extraction closes the biggest gap in both systems.** The universal problem — LLMs focused on tasks don't volunteer to store facts learned along the way — is solved by a dedicated extraction pass after conversation idle. When the user says "email my colleague Jan at jan@example.com," the LLM focuses on sending the email. Five minutes later, the extractor catches "Jan is a colleague, email jan@example.com" and stores it. OpenClaw has no mechanism for this.

**History backfill recovers months of lost knowledge.** Past conversations that were never mined for facts are now processed. This is a one-time catch-up that immediately enriches the fact base with everything that was discussed but never stored. OpenClaw has no equivalent — its memory files only contain what the agent explicitly wrote during conversations.

**Weekly synthesis keeps the fact base clean.** After 6 months, you might have "prefers dark mode" (January), "switched to light mode for presentations" (March), and "uses auto dark mode" (May). Synthesis consolidates these into one coherent fact. Without synthesis, fact quality degrades over time as contradictions and duplicates accumulate. OpenClaw has no equivalent.

**Annabelle is now also at parity or ahead on retrieval.** With the addition of sqlite-vec + FTS5 hybrid search (Priority 2, now implemented), Annabelle uses the same core technique as OpenClaw: vector embeddings combined with text search, union-ranked with configurable weights (60% vector / 40% FTS5 by default). Embedding providers are local-first (Ollama with nomic-embed-text, or LM Studio), with graceful degradation to FTS5-only or LIKE fallback if embeddings are unavailable. New facts are automatically embedded on creation, re-embedded on update, and cleaned up on deletion. A `backfill_embeddings` tool processes existing facts in batches. Combined with the superior extraction and synthesis pipeline, Annabelle now has better data *and* comparable retrieval.

**Annabelle remains superior for transparency and control.** 11 memory tools, structured categories, confidence scores, export to `~/.annabelle/memory-export/`. OpenClaw's free-form markdown files are harder to audit.

### Remaining Recommendations

**No remaining recommendations for user learning.** With vector memory now implemented (see Section 8), Annabelle is comprehensively ahead of OpenClaw on every dimension of user learning — better extraction, better maintenance, AND better retrieval.

---

## 8. Memory Architecture ✅ VECTOR MEMORY IMPLEMENTED

### How Annabelle Works — Current State

Memory MCP uses SQLite with 4 tables (`facts`, `conversations`, `profiles`, `skills`) plus two virtual tables: **`facts_fts`** (FTS5 with porter stemming) and **`vec_facts`** (sqlite-vec for vector embeddings). 12+ memory tools including the new `backfill_embeddings`.

**Retrieval uses a 3-tier hybrid search strategy:**

1. **Full hybrid** (when embedding provider is configured): vector similarity search via sqlite-vec runs in parallel with FTS5 BM25 text search. Results are union-ranked with configurable weights (default 60% vector / 40% text). Min-max normalization ensures fair scoring across both strategies.
2. **FTS5-only** (when no embedding provider): full-text search with porter stemming. Still far better than the old keyword matching — "running" matches "run", BM25 scoring ranks by relevance.
3. **LIKE fallback** (if FTS5 returns nothing): the original `LIKE %keyword%` search as a last resort.

**Embedding providers are local-first:** Ollama (default model: nomic-embed-text, 768 dimensions) or LM Studio. No external API calls — embeddings run on the local machine. Provider set via `EMBEDDING_PROVIDER` env var (`ollama`, `lmstudio`, or `none`).

**Automatic embedding lifecycle:** New facts are embedded on `store_fact` via `embedFact()`. Updated facts are re-embedded via `reembedFact()` (delete + re-insert). Deleted facts have their embeddings cleaned up via `deleteFactEmbedding()`. Embedding failures never block fact storage — they log a warning and continue.

**Backfill for existing facts:** The `backfill_embeddings` tool finds facts without entries in `vec_facts` (via LEFT JOIN), embeds them in configurable batches (default 50, max 200), and reports progress (processed/embedded/failed/remaining). Call repeatedly until remaining is 0.

**FTS5 stays in sync automatically** via SQLite triggers on INSERT/UPDATE/DELETE. The FTS5 index is fully rebuilt on every startup to prevent SQLITE_CORRUPT_VTAB errors from content table drift.

Implementation: `Memorizer-MCP/src/embeddings/` (provider interface, Ollama provider, LM Studio provider, fact embedding helpers), `db/schema.ts` (FTS5 + vec0 DDL, triggers), `tools/memory.ts` (hybrid search with `vectorSearch()`, `fts5Search()`, `likeFallbackSearch()`, `hybridRank()`, `normalizeScores()`), `tools/backfill-embeddings.ts`, `config/schema.ts` (EmbeddingConfigSchema). Tests: `embeddings.test.ts`, `hybrid-search.test.ts`, `vector-search.test.ts`.

### How OpenClaw Works

43-file memory module. Markdown files chunked and embedded in SQLite via `sqlite-vec`. Hybrid search: vector (70% weight) + BM25 (30% weight), union-based. Embedding providers: local `node-llama-cpp` → OpenAI → Google Gemini → fallback to keyword-only. Graceful degradation — memory always works.

### Which Architecture Is Superior — Updated Assessment

**Annabelle is now ahead on the complete memory pipeline.** This is a reversal from v1, where OpenClaw had clearly superior retrieval.

**Retrieval is now at parity.** Both systems use sqlite-vec for vector search combined with text search (FTS5/BM25), union-ranked with configurable weights. Both support local embedding providers and graceful degradation to text-only search. The core retrieval technique is identical. OpenClaw has a wider provider chain (node-llama-cpp → OpenAI → Gemini → keyword), Annabelle has a simpler two-provider setup (Ollama or LM Studio) with FTS5 as a strong middle tier before the LIKE fallback.

**Annabelle is ahead on data quality.** Post-conversation extraction, history backfill, and weekly synthesis have no equivalent in OpenClaw. Better retrieval of a well-maintained fact base beats equivalent retrieval of an unsynthesized one.

**Annabelle is ahead on transparency.** 12+ structured memory tools, fact categories, confidence scores, export capability. OpenClaw's free-form markdown files are harder to audit and manage.

**OpenClaw remains ahead on storage format flexibility.** Markdown chunks can store arbitrary structured content — code snippets, long-form notes, lists. Annabelle's facts are short strings. For a personal assistant, short facts cover the vast majority of user knowledge; for a coding assistant that needs to remember entire file structures, markdown chunks would be better.

### No Remaining Recommendations

All four original recommendations have been implemented:

1. ✅ **sqlite-vec for vector storage** — `vec_facts` table with `vec0(embedding float[768])`, embeddings computed on `store_fact`.
2. ✅ **Hybrid search** — vector (60%) + FTS5 BM25 (40%), union of both result sets, min-max normalized.
3. ✅ **Local embeddings** — Ollama (nomic-embed-text) or LM Studio, graceful fallback to FTS5-only then LIKE.
4. ✅ **Migrate existing facts** — `backfill_embeddings` tool processes unembedded facts in batches.

---

## 9. Summary — Revised Priority List

With 9 of 11 recommendations implemented, the remaining 2 are re-ranked by current impact-to-effort ratio.

### Completed ✅

| # | What | When | Key Outcome |
|---|---|---|---|
| 1 | Session Persistence + Compaction | Feb 2026 | Sessions survive restarts. Compaction uses cheap model. Context stays manageable. |
| 2 | Vector Memory (sqlite-vec + Hybrid Search) | Feb 2026 | Hybrid retrieval: vector (60%) + FTS5 (40%). Local embeddings via Ollama. Graceful degradation. Backfill tool for existing facts. |
| 3 | Post-Conversation Fact Extraction | Feb 2026 | Facts caught that LLM missed during task focus. Idle-triggered, deduped. |
| 4 | Conversation History Backfill | Feb 2026 | Months of past conversations mined for facts. One-time catch-up. |
| 5 | Memory Synthesis (Weekly) | Feb 2026 | Duplicates merged, contradictions resolved, stale facts flagged. |
| 7 | Subagent Spawning | Feb 2026 | `spawn_subagent` tool. Dynamic port allocation, cascade-kill, max 5 concurrent per parent. |
| 8 | File-Based Persona Configuration | Feb 2026 | `instructions.md` per agent. Editable, version-controllable, auto-copied defaults. |
| 9 | File-Based Skill Loading | Feb 2026 | Agent Skills standard. Coexists with DB playbooks. Progressive disclosure. |
| 10 | Lazy-Spawn / Idle-Kill | Feb 2026 | Agents spawn on first message, kill after configurable idle timeout. ~200 lines. |

### Remaining — Re-ranked

**Priority A: Code Execution Tool**
*Impact: High | Effort: Medium | ~150–250 lines*

Previously Priority 6, now the **single largest capability gap** with OpenClaw's runtime. With session persistence, user learning, vector memory, persona config, skills, subagent spawning, and lazy-spawn all implemented, the inability to improvise by writing and running code is the most visible remaining limitation.

New MCP or tool in Filer MCP. Guardian integration for code scanning. Docker sandbox optional but recommended. This is now even more impactful because subagents that can write and execute code are dramatically more useful than subagents limited to pre-built tools.

**Priority B: Shared HTTP Server**
*Impact: Low | Effort: Medium | ~200–300 lines*

Previously Priority 11. Architectural cleanup, only matters at 10+ agents. Defer indefinitely unless port management becomes a problem.

---

## 10. Competitive Position — Where Annabelle Stands Now

### Areas Where Annabelle Is Now Ahead

**User learning and memory.** With post-conversation extraction, history backfill, weekly synthesis, AND sqlite-vec hybrid search, Annabelle now has better data quality *and* comparable retrieval to OpenClaw. The complete memory pipeline — extraction, maintenance, and retrieval — is ahead. OpenClaw has no equivalent extraction/synthesis pipeline.

**Session cost efficiency.** Compaction using a dedicated cheap model (Llama 3.1 8B Instant) rather than the main agent model. OpenClaw uses the session model, which is more expensive per compaction call.

**Safety and governance.** Guardian MCP, anomaly-based cost controls, persistent kill switch, auto-restart with limits. These were ahead before and remain ahead. Battle-tested through real incidents.

**Task management.** Inngest-powered cron, one-shot scheduling, background tasks, multi-step workflows with retries, monitoring dashboard. OpenClaw has basic cron. This was ahead before and remains ahead.

**Skill architecture.** Dual system (file-based + database) with Agent Skills standard compliance and progressive disclosure. OpenClaw has file-only skills with a marketplace. For a solo user, the dual system is more capable.

**Subagent spawning.** Process-per-subagent model with true OS-level isolation. Dynamic port allocation, cascade-kill, max 5 concurrent per parent, single-level depth enforcement, tool policy inheritance. OpenClaw has subagent spawning but suffers from shared-process contention (write lock timeouts, model override bugs). Annabelle's architecture is structurally immune to these issues.

**Agent lifecycle management.** Lazy-spawn on first message, idle-kill after configurable timeout, per-agent state tracking (`stopped`/`starting`/`running`/`stopping`), deduplication of concurrent spawn requests. OpenClaw spawns all agents eagerly on startup with no idle management.

### Areas at Parity

**Session persistence.** Both use JSONL with compaction. Different implementation details (Annabelle: lazy-loading + cheap compaction model; OpenClaw: write locking + JSONL repair + tree structure). Functionally equivalent.

**Persona configuration.** Both use editable markdown files. Different granularity (Annabelle: single `instructions.md`; OpenClaw: 5–6 specialized files). Functionally equivalent for a worker assistant.

**Multi-agent support.** Both have multi-agent with per-agent LLM config and tool policies. Different isolation models (process vs shared-process), each with tradeoffs. On 128GB, process isolation is free and safer.

### Areas Where OpenClaw Is Still Ahead

**Agent runtime flexibility.** Arbitrary code execution via Pi's 4 core tools. Annabelle cannot improvise. This is the biggest remaining gap. *Closable with Priority A.*

**Channel breadth.** 17+ messaging channels vs 2 (Telegram + Claude Desktop). Not a priority for a solo-user system, but a factual gap.

**Voice, devices, browser.** Native apps, STT/TTS, camera, screen, location, CDP + Playwright. Entirely different product category. Not on the roadmap and not needed for the worker assistant use case.

**Ecosystem scale.** 176k stars, 7-person team, 52 ClawHub skills, 181 CLI commands. Scale advantages that a solo project cannot replicate and doesn't need to for personal use.

### The Strategic Picture

In v1, Annabelle had significant gaps in 5 of 9 comparison areas. After implementing 9 priorities, it now has gaps in **1 area that matters** (runtime flexibility / code execution) and multiple areas where it's **ahead** of OpenClaw (user learning, memory pipeline, cost efficiency, safety, task management, skill architecture, subagent spawning). The remaining gap is addressable with Priority A — roughly 150–250 lines of new code.

The core thesis from v1 holds but has strengthened: **Annabelle is a security-hardened, MCP-native orchestration layer** that now also has robust persistence, sophisticated user learning with vector-backed retrieval, and a standards-compliant skill system. The areas where OpenClaw dominates (channel breadth, voice/devices, browser automation, ecosystem scale) are product-category differences, not architectural deficiencies — they reflect a different product vision (platform vs personal assistant), not a worse one.
