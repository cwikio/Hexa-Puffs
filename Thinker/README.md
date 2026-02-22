# Hexa Puffs Thinker

AI reasoning engine for the Hexa Puffs MCP ecosystem. Thinker is a passive HTTP agent that receives messages from the Orchestrator, reasons through problems using an LLM (Groq, LM Studio, or Ollama), and executes tools across the MCP ecosystem via the Orchestrator's tool API.

**Transport:** HTTP (receives dispatched messages from Orchestrator)
**Default Port:** 8006

## How It Works

1. Orchestrator dispatches a message to Thinker via `POST /process-message`
2. Thinker selects relevant tools using embedding-based cosine similarity (with regex fallback)
3. Thinker runs a ReAct loop via Vercel AI SDK (`generateText` with `maxSteps`)
4. Tool calls are executed via Orchestrator's `/tools/call` endpoint (policy-checked)
5. Final response is returned to Orchestrator, which delivers it to the user

Thinker does **not** poll Telegram directly — the Orchestrator handles all channel I/O and dispatches messages to the appropriate agent.

## Quick Start

```bash
npm install
cp .env.example .env   # Edit with your GROQ_API_KEY
npm run build
npm start
```

For development with hot reload:

```bash
npm run dev
```

## Configuration

All configuration via environment variables. See `.env.example` for all options.

### LLM Provider

```bash
THINKER_LLM_PROVIDER=groq          # groq | lmstudio | ollama

# Groq (cloud) — default
GROQ_API_KEY=gsk_xxx
GROQ_MODEL=llama-3.3-70b-versatile

# LM Studio (local)
LMSTUDIO_BASE_URL=http://localhost:1234/v1
LMSTUDIO_MODEL=local-model

# Ollama (local)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
```

### Connection

```bash
THINKER_PORT=8006                   # HTTP port (0 = OS-assigned, used by subagents)
ORCHESTRATOR_URL=http://localhost:8000
THINKER_AGENT_ID=thinker            # Agent identity for Memory MCP profiles
```

### Session Persistence

```bash
THINKER_SESSION_ENABLED=true
THINKER_SESSIONS_DIR=~/.hexa-puffs/sessions
THINKER_SESSION_COMPACTION_ENABLED=true    # LLM summarizes old turns to save context
THINKER_SESSION_MAX_AGE_DAYS=7
```

### Cost Controls

```bash
THINKER_COST_CONTROL_ENABLED=false
THINKER_COST_SHORT_WINDOW_MINUTES=2        # Spike detection window
THINKER_COST_SPIKE_MULTIPLIER=3.0          # Threshold: short-window rate > baseline x this
THINKER_COST_HARD_CAP_PER_HOUR=500000      # Absolute token cap per hour
THINKER_COST_MIN_BASELINE_TOKENS=1000      # Min baseline before spike detection activates
```

When triggered, the agent pauses and Orchestrator sends a Telegram notification. Resume via `POST /cost-resume` or Orchestrator's `POST /agents/:agentId/resume`.

## HTTP Endpoints

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/health` | GET | Health check with config, embedding selector status |
| `/process-message` | POST | Process a dispatched message (called by Orchestrator) |
| `/execute-skill` | POST | Execute a proactive skill/task |
| `/clear-session` | POST | Wipe conversation history for a chat |
| `/cost-status` | GET | Get cost monitor state (tokens, rates, pause status) |
| `/cost-resume` | POST | Resume a cost-paused agent (`{ resetWindow: true }` to clear history) |

## Key Features

### Embedding-Based Tool Selection

Thinker embeds all tool descriptions and ranks them by cosine similarity to the user's message. Only relevant tools are passed to the LLM, reducing noise and improving accuracy.

- Embeddings cached to `~/.hexa-puffs/data/embedding-cache.json` (persistent across restarts)
- Hot-reload: checks for tool set changes every 10 minutes, incrementally re-embeds new tools
- Falls back to regex-based keyword matching when embedding provider is unavailable

### Session Persistence & Compaction

Conversations are stored as JSONL files per chat. When a session exceeds ~20K characters, old turns are summarized by a cheap LLM model (compaction), preserving context while saving tokens.

### Playbook System

15 default playbooks are seeded on first startup. Each playbook declares required tools that are force-included in the tool set, ensuring playbook actions always have access to the tools they need.

### Conversation Loop Resilience

- **Tool Recovery:** Detects when the LLM emits tool calls as text instead of structured JSON and executes the recovered call
- **Hallucination Guard:** Detects action claims without tool calls, retries with `toolChoice: 'required'`
- **Sliding Tools:** Tools from the last 3 turns are auto-injected for follow-up messages ("what about the other one?")

### Post-Conversation Fact Extraction

After the user goes idle (default 5 min), Thinker reviews recent turns and extracts facts for long-term memory storage using a cheap compaction model.

## Architecture

```text
Orchestrator dispatches message
       |
       v
+------------------------------------------+
|              THINKER (:8006)              |
|                                          |
|  Message -> Tool Selection (embeddings)  |
|         -> Playbook Matching             |
|         -> Context Loading (Memory MCP)  |
|         -> ReAct Loop (Vercel AI SDK)    |
|         -> Tool Execution (Orchestrator) |
|         -> Response                      |
|                                          |
|  Session Store (JSONL, compaction)       |
|  Cost Monitor (sliding window)          |
|  Trace Logger (JSONL)                   |
+------------------------------------------+
       |
       v
Orchestrator (:8010) -> tools/call -> MCPs
```

## Development

```bash
npm run dev        # Watch mode (tsx)
npm run typecheck  # Type check (tsc --noEmit)
npm run build      # Compile to dist/
npm test           # Run tests (vitest)
npm run test:watch # Watch mode tests
```

### Tests

22 test files covering:

- Integration: server endpoints, proactive tasks, embedding cache, chat ID injection
- Unit: tool selection, playbook classification, fact extraction, history repair, cost monitoring

```bash
npm test                     # All tests
npm run test:proactive       # Proactive task tests only
```

## Startup Behavior

1. Load and validate config (Zod schema)
2. Exit if `THINKER_ENABLED=false`
3. Start HTTP server, register routes
4. Emit `LISTENING_PORT=<port>` to stdout (for Orchestrator's AgentManager)
5. Initialize agent (async): connect to Orchestrator, load tools, build embedding index
6. Begin periodic cleanup (every 5 min): old conversations, stale session files

Handles `SIGINT`/`SIGTERM` gracefully — flushes conversation states, force-exits after 5 seconds.

## License

Part of the Hexa Puffs AI Assistant project.
