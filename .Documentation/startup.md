# Startup Sequence

> What happens when Hexa Puffs boots, in what order, and how long each step takes.

## Overview

Boot is driven by `start-all.sh`, which launches services in a specific order. The full startup takes approximately 15-30 seconds depending on MCP count and network speed.

## Boot Sequence

### Phase 1: Pre-flight (instant)

1. **MCP auto-discovery** — `Shared/Discovery/cli.js` scans sibling directories for `package.json` manifests with `"hexa-puffs"` field. Outputs discovered MCPs to stdout.
2. **Process cleanup** — Kills any leftover processes from previous runs (reads PIDs from `~/.hexa-puffs/pids`).
3. **Token generation** — Generates a random `HEXA_PUFFS_TOKEN` for HTTP API auth. Saved to `~/.hexa-puffs/hexa-puffs.token`.

### Phase 2: Persona & Skills (instant)

4. **Agents directory** — Creates `~/.hexa-puffs/agents/` with git tracking for persona edits.
5. **Default persona** — Copies `Thinker/defaults/personas/hexa-puffs/instructions.md` → `~/.hexa-puffs/agents/hexa-puffs/instructions.md`. Only on first run — never overwrites user edits.
6. **Skills directory** — Ensures `~/.hexa-puffs/skills/` exists.

### Phase 3: Documentation Sync (instant)

7. **Documentation** — Copies `.documentation/*.md` → `~/.hexa-puffs/documentation/`. Always overwrites (repo is source of truth).

### Phase 4: Inngest (3-5 seconds)

8. **Inngest dev server** — Starts on port 8288. Waits 3 seconds for it to be ready before proceeding.

### Phase 5: Orchestrator (5-15 seconds)

9. **Orchestrator launch** — Starts as a Node.js process on port 8010 with `MCP_CONNECTION_MODE=stdio`.

Inside `Orchestrator.initialize()`:

   a. **Guardian first** — The MCP with `role: "guardian"` is always initialized before all others. Guardian wraps all other MCP clients for security scanning.

   b. **Stdio MCPs** — All remaining stdio MCPs are spawned as child processes. Each connects via stdin/stdout MCP protocol.

   c. **Tool discovery** — `toolRouter.discoverTools()` calls `listTools()` on every connected MCP, builds the prefixed routing table.

   d. **Health monitoring** — Starts 60-second health check interval. Tests each MCP by calling `listTools()`.

   e. **Startup diff** — Compares current MCPs against `~/.hexa-puffs/last-known-mcps.json`. Detects added/removed MCPs since last boot.

   f. **External MCP watcher** — Starts `fs.watch` on `external-mcps.json` for hot-reload (500ms debounce).

   g. **Agent registration** — `AgentManager.initializeAll()` registers agents from `agents.json` but does NOT spawn them (lazy-spawn).

   h. **Startup notification** — Sends a Telegram message summarizing: MCP count, external MCPs, changes since last boot, any failures.

10. **Health check** — Script polls `localhost:8010/health` to verify Orchestrator is responsive.

### Phase 6: Post-startup (background)

11. **Cron skills seeding** — `_scripts/seed-cron-skills.ts` runs in background, populating Memorizer with scheduled skills (idempotent).
12. **Inngest registration** — Registers Orchestrator functions with Inngest dev server.
13. **Thinker** — NOT started yet. Will lazy-spawn on first message via AgentManager.

## When Things Become Available

| Capability | Available After |
|-----------|----------------|
| MCP tools | Phase 5c (tool discovery) |
| Slash commands (/status, /logs) | Phase 5 (Orchestrator up) |
| Telegram polling | Phase 5g (channel manager started) |
| Thinker agent | First message received (lazy spawn) |
| Scheduled skills | Phase 6 (Inngest + skill seeding complete) |
| Tool embeddings | First Thinker message (cache loaded on demand) |

## Startup vs Restart

**Fresh start** (`./start-all.sh`):
- Kills all previous processes
- Generates new auth token
- Full initialization sequence

**Restart** (`./restart.sh`):
- Runs `./rebuild.sh` first (rebuilds Shared, then all packages in parallel)
- Then runs `./start-all.sh`

## Diagnosing Startup Issues

### "Still starting" vs "stuck"

- **Normal:** Orchestrator takes 5-15 seconds to initialize all MCPs. Thinker is not running until first message.
- **Stuck indicators:** Orchestrator health check fails after 30 seconds, specific MCP marked as unavailable in `/status`.

### Common startup failures

| Symptom | Likely Cause | Check |
|---------|-------------|-------|
| Orchestrator won't start | Port 8010 in use | `lsof -i :8010` |
| MCP marked "DOWN" in /status | MCP failed to spawn | `tail ~/.hexa-puffs/logs/orchestrator.log` |
| Guardian unavailable | Provider connection failed | Check Guardian provider env vars |
| No tools discovered | All MCPs failed | `curl localhost:8010/tools/list` |
| Inngest not registering | Port 8288 in use | `lsof -i :8288` |
| Thinker not responding | Not yet spawned (normal) | Send a message to trigger spawn |

### Log files to check

| Log | Location | Contains |
|-----|----------|----------|
| Orchestrator | `~/.hexa-puffs/logs/orchestrator.log` | MCP spawn, health checks, startup diff |
| Thinker | `~/.hexa-puffs/logs/thinker.log` | Agent init, LLM calls, tool selection |
| Inngest | `~/.hexa-puffs/logs/inngest.log` | Job scheduler startup |
| Seed skills | `~/.hexa-puffs/logs/seed-skills.log` | Cron skill population |

## Key Files

| File | Purpose |
|------|---------|
| `start-all.sh` | Main boot script |
| `rebuild.sh` | Build all packages (Shared first, rest in parallel) |
| `restart.sh` | Kill + rebuild + start |
| `Orchestrator/src/index.ts` | HTTP server setup, main() |
| `Orchestrator/src/core/orchestrator.ts` | `initialize()` — MCP lifecycle |
| `Orchestrator/src/core/agent-manager.ts` | `initializeAll()` — agent registration |
| `Orchestrator/src/jobs/skill-scheduler.ts` | Inngest skill scheduler, tier routing |
| `_scripts/seed-cron-skills.ts` | Cron skill seeding |
