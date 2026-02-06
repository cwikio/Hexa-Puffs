<p align="center">
  <img src="images/team-with-logo.jpg" alt="Hexa Puffs Team" width="600" />
</p>

# Hexa Puffs — A Modular AI Assistant That Grows With You

Hexa Puffs is a team of individual modules (MCP servers) that can be assembled in any way you want to act as your personal AI assistant system that scales with your needs. The **Orchestrator** directs traffic, the **Thinker** reasons through problems and can spin into life more Puffs (independent sub-agent MCP servers), and 10+ MCP servers each handle their own gig — Gmail, code execution, browsing, you name it. They all talk over the open Model Context Protocol standard, but any one of them can be swapped out, upgraded, or extended without the others even noticing (hot reload enabled).

Because every member of the crew runs as its own process with its own memory, you get true plug-and-play modularity. Want to add a new capability? Drop in a new MCP, build it, and the Orchestrator picks it up on the next restart. Need to upgrade one? Pull it out, tinker with it, put it back — the rest of the system keeps humming. This process-level independence also means real parallelism: multiple agents can each rally their own set of tools at the same time, no stepping on each other's toes.

And watching over all of them is **Guardian** — the security layer that pre-scans every tool input and post-scans every output for prompt injection, wrapping the whole crew in a protective envelope.

All puffs are still babies (plenty of bugs to fix), but they are looking for the way to grow up and become a full-fledged assistant system - reach out if you can help out!

## Quick Start

### 1. Clone & Build

```bash
# Clone the repository
git clone https://github.com/cwikio/Hexa-Puffs.git
cd Hexa-Puffs

# Build all packages (Shared first, then parallel build)
./rebuild.sh
```

### 2. Configure Environment

Hexa Puffs is a system of independent servers. **You must configure each component individually.**

Run this command to copy all example configs:

```bash
# Copy .env.example -> .env for all services
for dir in Orchestrator Thinker Guardian Memorizer-MCP Filer-MCP Telegram-MCP Searcher-MCP Gmail-MCP Onepassword-MCP CodeExec-MCP Browser-MCP; do
  [ -f "$dir/.env.example" ] && cp "$dir/.env.example" "$dir/.env"
done
cp agents.json.example agents.json
```

Now **edit each `.env` file** with your keys:

| Component                                                                  | Path                   | Required Keys                 | Purpose                         |
| -------------------------------------------------------------------------- | ---------------------- | ----------------------------- | ------------------------------- |
| **Orchestrator** <br><br> <img src="images/orchestrator.jpg" width="60" /> | `Orchestrator/.env`    | `PORT` (8010)                 | Central hub config              |
| **Thinker** <br><br> <img src="images/thinker.jpg" width="60" />           | `Thinker/.env`         | `GROQ_API_KEY`                | Agent LLM (or Ollama/LM Studio) |
| **Guardian** <br><br> <img src="images/protector.jpg" width="60" />        | `Guardian/.env`        | `GROQ_API_KEY or local model` | Security scanning provider      |
| **Searcher** <br><br> <img src="images/searcher.jpg" width="60" />         | `Searcher-MCP/.env`    | `BRAVE_API_KEY`               | Brave Search API                |
| **Telegram** <br><br> <img src="images/telegram.jpg" width="60" />         | `Telegram-MCP/.env`    | `TELEGRAM_API_ID`, `HASH`     | Telegram Client API             |
| **Gmail** <br><br> <img src="images/google.jpg" width="60" />              | `Gmail-MCP/.env`       | `GMAIL_CREDENTIALS`           | OAuth2 Credentials              |
| **Memorizer** <br><br> <img src="images/memorizer.jpg" width="60" />       | `Memorizer-MCP/.env`   | `EMBEDDING_PROVIDER`          | Vector search config            |
| **Filer** <br><br> <img src="images/filer.jpg" width="60" />               | `Filer-MCP/.env`       | `WORKSPACE_DIR`               | Allowed file operations path    |
| **CodeExec** <br><br> <img src="images/codexer.jpg" width="60" />          | `CodeExec-MCP/.env`    | `SANDBOX_DIR`                 | Execution sandbox path          |
| **1Password** <br><br> <img src="images/onepassowrd.jpg" width="60" />     | `OnePassword-MCP/.env` | (Connects to local CLI)       | Vault access                    |

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

## Adding MCPs

### Internal MCPs (Auto-Discovery)

Drop a new directory as a sibling folder, add a `hexa-puffs` manifest to its `package.json`, build, and restart the Orchestrator:

```json
{
  "name": "my-new-mcp",
  "main": "dist/index.js",
  "hexa-puffs": {
    "mcpName": "mynewmcp"
  }
}
```

The Orchestrator scans sibling directories at startup and picks up any package with a `hexa-puffs.mcpName` field. No other config needed.

Optional manifest fields: `transport` (`"stdio"` or `"http"`), `sensitive`, `timeout`, `httpPort`, `keywords`, and more — see [Orchestrator README](Orchestrator/README.md) for the full schema.

You can disable or override any discovered MCP with environment variables:

| Variable              | Example                      | Description              |
| --------------------- | ---------------------------- | ------------------------ |
| `${NAME}_MCP_ENABLED` | `SEARCHER_MCP_ENABLED=false` | Disable a discovered MCP |
| `${NAME}_MCP_TIMEOUT` | `FILER_MCP_TIMEOUT=60000`    | Override timeout (ms)    |

### External MCPs (Third-Party)

For MCPs you don't build yourself (PostHog, Vercel, GitHub, etc.), declare them in **`external-mcps.json`** in the project root:

```json
{
  "posthog": {
    "command": "npx",
    "args": ["-y", "@anthropic/posthog-mcp"],
    "env": {
      "POSTHOG_HOST": "https://us.posthog.com",
      "POSTHOG_API_KEY": "${POSTHOG_API_KEY}"
    },
    "timeout": 15000,
    "description": "Product analytics and feature flags"
  }
}
```

| Field         | Required | Default | Description                                                |
| ------------- | -------- | ------- | ---------------------------------------------------------- |
| `command`     | Yes      | —       | Executable to spawn (`"npx"`, `"node"`, etc.)              |
| `args`        | No       | —       | Arguments passed to the command                            |
| `env`         | No       | —       | Environment variables — supports `${ENV_VAR}` placeholders |
| `timeout`     | No       | `30000` | Connection timeout (ms)                                    |
| `sensitive`   | No       | `false` | If `true`, Guardian scans tool inputs                      |
| `description` | No       | —       | Human-readable label shown at startup                      |

Tokens live in your shell environment, not in the config file — `${POSTHOG_API_KEY}` resolves to `process.env.POSTHOG_API_KEY` at load time. The config file only contains placeholders, so it's safe to commit.

External MCPs are **hot-reloadable** — edit `external-mcps.json` and changes apply without a restart. See [External MCP docs](.documentation/external-mcp.md) for the full guide.

## Documentation Reference

- **[Architecture](.documentation/architecture.md)**: Deep dive into the hub-and-spoke design.
- **[Commands](.documentation/commands.md)**: Slash commands (`/status`, `/diagnose`, `/help`).
- **[Tools](.documentation/tools.md)**: Full catalog of 148+ available tools.
- **[Skills](.documentation/tooling-and-skills-architecture.md)**: Creating scheduled and proactive capabilities.
- **[Troubleshooting](.documentation/startup.md)**: What to do if something doesn't start.

---

_Hexa Puffs — Private, Parallel, and Secure._
