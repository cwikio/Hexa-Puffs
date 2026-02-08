# Annabelle Telegram Commands

Slash commands are intercepted by the Orchestrator before reaching the LLM. They execute instantly with zero token cost.

## System

| Command | Description |
| --- | --- |
| `/status` | System status — MCPs, agents, uptime, Telegram polling, Inngest state |
| `/status summary` | AI-powered health audit — logs, security, memory, cron jobs, skills |
| `/info` | Full info page — all commands, tools by MCP, active skills |
| `/help` | Same as `/info` |

## Kill Switch

| Command | Description |
| --- | --- |
| `/kill all` | Emergency stop — pauses all agents, stops Telegram polling, halts Inngest jobs |
| `/kill thinker` | Pauses all Thinker agents (they reject new messages) |
| `/kill telegram` | Stops Telegram message polling |
| `/kill inngest` | Halts all Inngest functions (cron jobs, background tasks, skill scheduler) |
| `/resume all` | Resumes everything — agents, polling, Inngest |
| `/resume thinker` | Resumes all paused Thinker agents |
| `/resume telegram` | Restarts Telegram message polling |
| `/resume inngest` | Resumes Inngest function execution |

Every `/kill` and `/resume` command automatically shows the full `/status` output in its response.

Halt state persists to disk (`~/.annabelle/data/halt.json`) — if the Orchestrator restarts, halted services stay halted until explicitly resumed.

## Cron & Jobs

| Command | Description |
| --- | --- |
| `/cron` | Inngest job/task status — next run times, recent failures, skill cooldowns |

## Security

| Command | Description |
| --- | --- |
| `/security` | Guardian status — enabled/disabled, fail mode, input/output scanning flags, 24h threat stats |
| `/security [N]` | Last N security threats (default: 10) |

## Logs

| Command | Description |
| --- | --- |
| `/logs` | Log file sizes and freshness for all services |
| `/logs [N]` | Last N warnings/errors across all service logs (default: 15) |

## Messages

| Command | Description |
| --- | --- |
| `/delete today` | Delete all bot messages from today |
| `/delete yesterday` | Delete all bot messages from yesterday |
| `/delete week` | Delete all bot messages from this week |
| `/delete <N>h` | Delete bot messages from the last N hours (max 168) |
| `/delete <N>` | Delete the last N bot messages (max 500) |

## HTTP API Equivalents

The kill switch is also available via HTTP (for programmatic access):

```
POST /kill    { "target": "all" | "thinker" | "telegram" | "inngest" }
POST /resume  { "target": "all" | "thinker" | "telegram" | "inngest" }
```
