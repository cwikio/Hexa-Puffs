# Multi-Agent Architecture: Priorities 7, 10, 11

*Analysis of remaining agent lifecycle priorities from the Annabelle vs OpenClaw deep dive.*

---

## Priority 7: Subagent Spawning

**What it is:** The main Annabelle agent (or any agent) gets a new tool called `spawn_subagent`. When it receives a complex task, it can spin up temporary child Thinker processes to do work in parallel.

**How agents would actually be spawned:**

1. You message Annabelle: "Research competitor pricing for X, Y, and Z"
2. Annabelle's LLM decides this is parallelizable. It calls `spawn_subagent` three times — one per competitor
3. Each `spawn_subagent` call hits an Orchestrator endpoint. Orchestrator's AgentManager does what it already does today in `spawnAgent()`: picks a port (dynamically now, not from agents.json), spawns `node Thinker/dist/index.js` as a child process with env vars, waits for `/health`, marks it available
4. Each subagent gets: the parent's LLM provider/model, a narrower tool policy (inherited from parent, optionally further restricted), a `parentAgentId` field, a task instruction, and an auto-kill timeout
5. Orchestrator sends each subagent its task via `POST /process-message`
6. The subagents work independently and in parallel — each is a separate OS process with its own cost monitor
7. When a subagent finishes, its response is routed back to the parent agent's context (or sent to Telegram if the parent has already responded)
8. After completion (or timeout), the subagent process is killed and cleaned up

**Under what conditions the LLM would spawn them:**
- The system prompt would include instructions like "When a task can be broken into independent subtasks, use `spawn_subagent` to parallelize." The LLM decides — same as how it decides to call any other tool
- Typical cases: parallel research, processing multiple items, running a long task in the background while staying responsive
- Single-level only: subagents cannot spawn their own subagents (Orchestrator rejects it if `parentAgentId` is set)
- Max 3-5 concurrent per parent

**What changes:** New `spawn_subagent` tool in Orchestrator, `AgentManager` gets dynamic spawn/track/cleanup logic, halt manager gets cascade-kill (killing parent kills children), result callback routing. ~300-400 lines. No Thinker changes — subagents are just Thinker instances with extra metadata.

---

## Priority 10: Lazy-Spawn / Idle-Kill

**What it is:** Today, when Orchestrator starts, it spawns **all** agents defined in `agents.json` immediately — even if only one (annabelle) ever gets messages. Lazy-spawn means: don't spawn an agent until its first message arrives. Idle-kill means: if an agent hasn't received a message in N minutes, kill its process to free resources.

**How it works:**

1. Orchestrator starts. Instead of calling `spawnAgent()` for every agent in `agents.json`, it just loads the configs into memory and marks them as `state: "stopped"`
2. A Telegram message arrives. MessageRouter resolves it to `agentId: "annabelle"`. AgentManager checks: annabelle is stopped. It calls `spawnAgent("annabelle")`, waits for health (~2 seconds), then dispatches the message
3. Every message updates `lastActivityAt` on that agent
4. A periodic check (every 5 minutes) scans all running agents. If `lastActivityAt` was more than 30 minutes ago (configurable), it kills the process and marks the agent as `state: "stopped"`
5. Next message to that agent triggers re-spawn

**Under what conditions:**
- Right now you only have 1 agent (annabelle), so this is purely operational cleanliness
- It matters more if you define 5-10 agents in agents.json — only the ones receiving messages stay alive
- Also matters for subagent spawning (Priority 7) — subagents should auto-kill after idle timeout rather than hanging around forever

**What changes:** Add `lastActivityAt` and `state` to `ManagedAgent`, modify `initializeAll()` to skip spawning, add lazy-spawn check before dispatch in orchestrator, add periodic idle scanner. ~50-80 lines in `agent-manager.ts`. No Thinker changes.

---

## Priority 11: Shared HTTP Server with Path Routing

**What it is:** Today, every Thinker process runs its own Express HTTP server on its own port (annabelle on 8006, a second agent would be on 8016, etc.). Orchestrator makes HTTP calls to each port. This priority would replace that with a single HTTP server in Orchestrator that routes to agents via path: `POST /agents/annabelle/process-message`. Thinker would switch from running its own HTTP server to receiving messages via stdin/stdout (like the stdio MCPs already do).

**How it works:**

1. Orchestrator runs one HTTP server on port 8010 (already does this)
2. Add routes: `POST /agents/:agentId/process-message`, `GET /agents/:agentId/health`, etc.
3. Thinker drops its Express server entirely. Instead, it reads JSON messages from stdin and writes responses to stdout — the same pattern used by Guardian, 1Password, Filer, Memorizer MCPs
4. AgentManager spawns Thinker with `stdio: 'pipe'` (already does this for stdout/stderr logging) and communicates via stdin/stdout instead of HTTP

**Under what conditions:**
- Only matters if you have 10+ agents and port allocation becomes annoying
- With 1 agent, the current approach is perfectly fine
- Would also simplify subagent spawning (Priority 7) — no need to allocate ports for temporary subagents, they'd just use stdio

**What changes:** Refactor of `Thinker/src/index.ts` (remove Express, add stdin/stdout protocol), new routes in Orchestrator, `ThinkerClient` refactored from HTTP to stdio. ~200-300 lines but it's a refactor of existing code — moderate risk of breaking things.

---

## Recommendation: Implementation Order

**10 and 7 should be done together (or 10 first, then 7 immediately after).** Here's why:

- Lazy-spawn/idle-kill (10) adds exactly the infrastructure that subagent spawning (7) needs. Subagents are temporary agents that need to be spawned on demand and killed when idle — that's literally lazy-spawn + idle-kill. If you build 7 without 10, you'd need to write cleanup/lifecycle logic for subagents separately, then later refactor it when adding 10. Building 10 first gives you `state` tracking, `lastActivityAt`, idle-kill scanning, and on-demand spawning — all of which subagent spawning reuses directly.

- 10 is tiny (~50-80 lines) and low-risk. It's a natural warm-up for the more complex 7.

**11 should be done separately, and probably deferred.** Here's why:

- It's a refactor of working code with moderate breakage risk (Thinker's entire communication model changes from HTTP to stdio)
- It doesn't unlock new capabilities — it's architectural cleanup
- With 1 agent, port management is not a problem
- However, if you do 7 (subagent spawning) first, it slightly increases the motivation for 11: spawning temporary subagents would be simpler without needing dynamic port allocation. But you can solve that with port 0 (OS-assigned) without the full refactor

**Final recommendation:** Do 10 + 7 together as one project. Defer 11 until you actually have enough agents that ports are annoying (which may be never for a personal assistant). If subagent spawning makes port management painful, revisit 11 then.

---

## Current Architecture Reference

| Component | Current Design |
|-----------|---|
| **Agent Spawning** | AgentManager spawns per-process per agent; ports pre-assigned in agents.json |
| **Communication** | HTTP POST `/process-message` for each incoming message |
| **Health** | 30-second polling, auto-restart with cooldown (10s, max 5 attempts) |
| **Tool Filtering** | Glob patterns per agent (allowedTools/deniedTools) |
| **Cost Controls** | Anomaly detection at Thinker, pause/resume orchestrated by Orchestrator |
| **Routing** | MessageRouter resolves (channel, chatId) -> agentId via exact/wildcard match |
| **Halt Manager** | Global kill switch, persists to `~/.annabelle/data/halt.json` |

### Key Files

- `Orchestrator/src/core/agent-manager.ts` — spawn, health check, restart, pause/resume
- `Orchestrator/src/core/orchestrator.ts` — `dispatchMessage()` flow
- `Orchestrator/src/core/message-router.ts` — (channel, chatId) -> agentId resolution
- `Orchestrator/src/core/halt-manager.ts` — global kill switch
- `Orchestrator/src/core/tool-router.ts` — tool discovery and routing to MCPs
- `Thinker/src/index.ts` — Express HTTP server, endpoints
- `agents.json` — agent definitions and channel bindings
