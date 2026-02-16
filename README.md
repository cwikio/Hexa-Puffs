# Annabelle

Annabelle is an MCP-based AI assistant platform designed to **parallelise any workflow at scale**. The system runs as a constellation of independent processes — an Orchestrator hub, an agent runtime, and 10+ MCP servers as isolated child processes — communicating over the open Model Context Protocol standard.

Unlike monolithic assistants, Annabelle's multi-process architecture means every capability—from Gmail to Code Execution—runs in its own process with its own memory space. This plug-and-play extensibility, combined with true process-level parallelism, enables concurrent multi-agent workflows where each agent orchestrates its own set of tools independently.

Crucially, Annabelle features **Guardian**, a dedicated security layer that pre-scans every tool input and post-scans every tool output for prompt injection, creating a security envelope around the entire system.

## Quick Start
### 1. Clone & Build
```bash
# Clone the repository
git clone <repo-url>
cd Annabelle-Code

# Build all packages (Shared first, then parallel build)
./rebuild.sh
```

### 2. Configure Environment
Annabelle is a system of independent servers. **You must configure each component individually.**

Run this command to copy all example configs:
```bash
# Copy .env.example -> .env for all services
for dir in Orchestrator Thinker Guardian Memorizer-MCP Filer-MCP Telegram-MCP Searcher-MCP Gmail-MCP Onepassword-MCP CodeExec-MCP Browser-MCP; do
  [ -f "$dir/.env.example" ] && cp "$dir/.env.example" "$dir/.env"
done
cp agents.json.example agents.json
```

Now **edit each `.env` file** with your keys:

| Component | Path | Required Keys | Purpose |
|---|---|---|---|
| **Orchestrator** | `Orchestrator/.env` | `PORT` (8010) | Central hub config |
| **Thinker** | `Thinker/.env` | `GROQ_API_KEY` | Agent LLM (or Ollama/LM Studio) |
| **Guardian** | `Guardian/.env` | `GROQ_API_KEY` | Security scanning provider |
| **Searcher** | `Searcher-MCP/.env` | `BRAVE_API_KEY` | Brave Search API |
| **Telegram** | `Telegram-MCP/.env` | `TELEGRAM_API_ID`, `HASH` | Telegram Client API |
| **Gmail** | `Gmail-MCP/.env` | `GMAIL_CREDENTIALS` | OAuth2 Credentials |
| **Memorizer** | `Memorizer-MCP/.env` | `EMBEDDING_PROVIDER` | Vector search config |
| **Filer** | `Filer-MCP/.env` | `WORKSPACE_DIR` | Allowed file operations path |
| **CodeExec** | `CodeExec-MCP/.env` | `SANDBOX_DIR` | Execution sandbox path |
| **1Password** | `OnePassword-MCP/.env`| (Connects to local CLI) | Vault access |

### 3. Configure Agents
Edit `agents.json` to define your agents and set your Telegram ID for notifications:
```json
"notifyChatId": "<YOUR_TELEGRAM_ID>"
```

### 4. Launch
Start the entire constellation:
```bash
./start-all.sh
```
This script launches Inngest, the Orchestrator, and all configured MCPs. The Thinker agent will lazy-spawn when you send your first message.

## Key Capabilities

- **🛡️ Defense-in-Depth**: Every tool call is scanned by Guardian (IBM Granite) for prompt injection.
- **🧠 Hybrid Memory**: SQLite-based memory with vector + keyword search fallback.
- **🔌 Plug-and-Play MCPs**: Add any MCP server as a sibling directory or external config — zero code required.
- **⚡ Process Parallelism**: Agents and tools run on separate cores; a heavy task doesn't block the chat.

## Documentation Reference

- **[Architecture](.documentation/architecture.md)**: Deep dive into the hub-and-spoke design.
- **[Commands](.documentation/commands.md)**: Slash commands (`/status`, `/diagnose`, `/help`).
- **[Tools](.documentation/tools.md)**: Full catalog of 148+ available tools.
- **[Skills](.documentation/tooling-and-skills-architecture.md)**: Creating scheduled and proactive capabilities.
- **[Troubleshooting](.documentation/startup.md)**: What to do if something doesn't start.

---
*Annabelle — Private, Parallel, and Secure.*
