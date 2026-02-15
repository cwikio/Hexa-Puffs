# Getting Started

This guide walks you through setting up Annabelle from a fresh clone.

## Prerequisites

- **Node.js 22+** (check with `node -v`)
- **npm** (comes with Node.js)
- **Git**

### External Accounts

Annabelle integrates with several external services. You don't need all of them to get started — see [Minimal Setup](#minimal-setup) below.

| Service | What it's for | Where to get credentials |
|---------|--------------|--------------------------|
| [Groq](https://console.groq.com) | LLM for Thinker agent + Guardian security scanning | Free API key from Groq Console |
| [Brave Search](https://brave.com/search/api/) | Web search via Searcher MCP | Free tier available |
| [Telegram](https://my.telegram.org) | Messaging via Telegram MCP | API ID + Hash from Telegram Developer Portal |
| [1Password](https://my.1password.com/developer-tools) | Secret retrieval via 1Password MCP | Service Account Token |
| [Google Cloud](https://console.cloud.google.com) | Email via Gmail MCP | OAuth2 credentials |

## Step 1: Clone and Install

```bash
git clone <repo-url>
cd MCPs
```

The Shared package must be built first (other packages depend on it):

```bash
cd Shared && npm install && npm run build && cd ..
```

Then install all other packages:

```bash
for dir in Orchestrator Thinker Guardian Memorizer-MCP Filer-MCP Telegram-MCP Searcher-MCP Gmail-MCP Onepassword-MCP Browser-MCP CodeExec-MCP; do
  (cd "$dir" && npm install) &
done
wait
```

Or use the rebuild script which handles build order automatically:

```bash
./rebuild.sh
```

## Step 2: Configure Environment

Copy `.env.example` files across all packages:

```bash
for dir in Orchestrator Thinker Guardian Memorizer-MCP Filer-MCP Telegram-MCP Searcher-MCP Gmail-MCP Onepassword-MCP CodeExec-MCP; do
  [ -f "$dir/.env.example" ] && cp "$dir/.env.example" "$dir/.env"
done
```

Copy the agent configuration:

```bash
cp agents.json.example agents.json
```

Now edit the `.env` files to add your API keys. At minimum:

- `Guardian/.env` — set `GROQ_API_KEY` (or install Ollama for local scanning)
- `Thinker/.env` — set `GROQ_API_KEY` and `THINKER_LLM_PROVIDER=groq`
- `Searcher-MCP/.env` — set `BRAVE_API_KEY`

Edit `agents.json` and set `notifyChatId` to your Telegram chat ID (for cost control alerts).

## Step 3: Set Up Telegram (Optional)

If you want Telegram messaging:

1. Go to https://my.telegram.org and create an app to get `api_id` and `api_hash`
2. Add them to `Telegram-MCP/.env`
3. Generate a session string:

```bash
cd Telegram-MCP
npm run setup
```

Follow the interactive prompts (phone number, verification code, optional 2FA).
Copy the output session string to `TELEGRAM_SESSION` in your `.env`.

## Step 4: Set Up Gmail (Optional)

If you want email access:

1. Create OAuth2 credentials in [Google Cloud Console](https://console.cloud.google.com)
2. On first launch, Gmail MCP will open a browser for OAuth authorization
3. The token is saved at `~/.annabelle/gmail/token.json`

## Step 5: Build

```bash
./rebuild.sh
```

This builds the Shared package first, then all others in parallel.

## Step 6: Launch

```bash
./start-all.sh
```

This starts (in order):
1. Inngest Dev Server (port 8288)
2. Ollama + Guardian model (if available)
3. Orchestrator (8010) — auto-discovers and spawns all MCPs via stdio (Guardian, 1Password, Memorizer, Filer, Telegram, Searcher, Gmail, Browser, CodeExec)
4. Thinker agent(s) (8006+) — spawned by Orchestrator from `agents.json`
5. Cron skill seeding + system snapshot (background)

Watch for health check output. All services should show green checkmarks.

Logs are written to `~/.annabelle/logs/`.

## Step 7: Verify

Check that services are healthy:

```bash
# Orchestrator health
curl http://localhost:8010/health

# Thinker health
curl http://localhost:8006/health
```

## Minimal Setup

You don't need every service to get started. Disable MCPs you don't have credentials for:

```bash
# In your shell or Orchestrator/.env:
export TELEGRAM_MCP_ENABLED=false
export ONEPASSWORD_MCP_ENABLED=false
export SEARCHER_MCP_ENABLED=false
export GMAIL_MCP_ENABLED=false
```

The minimum viable setup is:
- **Orchestrator** — always required
- **Guardian** — security scanning (needs Groq key OR local Ollama)
- **Thinker** — the AI agent (needs Groq key OR local LM Studio/Ollama)
- **Memorizer-MCP** — memory storage (no external deps, uses local SQLite)
- **Filer-MCP** — file operations (no external deps)

## Troubleshooting

### Port already in use

```bash
# Find what's using a port
lsof -i :8010

# Kill all Annabelle processes
pkill -f "node.*dist.*index.js"
```

### Missing environment variables

Services fail silently if API keys are missing. Check logs:

```bash
ls ~/.annabelle/logs/
cat ~/.annabelle/logs/orchestrator.log
```

### Node version mismatch

Some packages require Node 22+. Check with `node -v` and use `nvm use` if you have nvm installed (reads `.nvmrc` automatically).

### Build failures

Always build Shared first:

```bash
cd Shared && npm run build && cd ..
./rebuild.sh
```

## What's Next

- Read the [Architecture Overview](README.md) for how the system works
- See [How to Add a New MCP](HOW-TO-ADD-NEW-MPC.md) for creating or integrating new MCPs
- See [TESTING.md](TESTING.md) for running the test suite
- See [.documentation/](.documentation/) for detailed system documentation (15 files covering architecture, tools, commands, sessions, memory, startup, and more)
