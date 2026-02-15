# Slash Commands & Diagnostics

> Zero-token operational commands handled by the Orchestrator before reaching the LLM. All commands are intercepted from Telegram messages and return instant text responses.

---

## Table of Contents

1. [Overview](#overview)
2. [Command Reference](#command-reference)
3. [Diagnostics (`/diagnose`)](#diagnostics-diagnose)
4. [Key Files](#key-files)

---

## Overview

Slash commands are handled by `SlashCommandHandler` in the Orchestrator. When a Telegram message starts with `/`, the handler checks it against registered commands before any Guardian scanning or LLM processing. Commands return deterministic text responses at zero token cost.

```
Orchestrator/src/commands/slash-commands.ts
```

**Dispatch:** Exact match on the command word (case-insensitive). Everything after the first space is the argument string.

**Limits:**
- `/security N` and `/logs N`: capped at 50 entries
- `/delete`: max 500 messages, max 1 week lookback
- `/status summary`: gathers data in parallel, then calls Thinker with `noTools: true` for AI analysis

---

## Command Reference

### `/status`

System overview: MCP states, agent states, uptime, tool count, session count, browser tabs.

Browser tab count is best-effort (3s timeout on `web_browser_tabs` call).

### `/status summary`

AI-generated health audit. Gathers data from 10 sources **in parallel**:

| Source | What |
|--------|------|
| Orchestrator status | MCPs, agents, uptime |
| Log files | Last 200 lines per service, WARN/ERROR only |
| Guardian scan log | Recent threats (limit 20) |
| Memory stats | Memorizer status |
| Filer audit log | Recent file operations (limit 20) |
| Cron jobs | Job list with schedules |
| Cron skills | Skill list with statuses |
| Background tasks | Task list with statuses |
| Inngest server health | HTTP health check |
| Inngest endpoint health | HTTP health check |

After gathering, the full data bundle is sent to the Thinker as task instructions with `maxSteps: 1` and `noTools: true`. The Thinker returns a plain-text analysis highlighting anomalies with timestamps.

### `/help`

Command list with usage examples, plus dynamic MCP/tool counts and active skills.

### `/cron`

Inngest status, jobs, skills, and recent background tasks. Data gathered in parallel:
- Inngest server + endpoint health
- Jobs list (with next run times computed via `Croner`)
- Skills list (enabled/disabled counts)
- Background tasks (last 10, with status counts)

### `/security [N]`

- **No args:** Guardian config summary + 24-hour scan statistics (from last 1000 scans)
- **With N:** Last N threat entries from Guardian scan log (1-50)

### `/logs [N]`

- **No args:** Log file listing from `~/.annabelle/logs/` with sizes and last-modified times
- **With N:** Last N WARN/ERROR entries aggregated from all service logs (1-50, default 15)

Log line parsing: `[timestamp] [LEVEL] [context] message`

### `/kill <target>`

Halts services. Targets: `all`, `thinker`, `telegram`, `inngest`.

| Target | Effect |
|--------|--------|
| `thinker` | Pauses all agents via AgentManager, adds to HaltManager |
| `telegram` | Stops channel polling, adds to HaltManager |
| `inngest` | Adds to HaltManager (functions bail at entry check) |
| `all` | All three |

Returns confirmation + full `/status` output.

### `/resume <target>`

Resumes halted services. Targets: `all`, `thinker`, `telegram`, `inngest`.

| Target | Effect |
|--------|--------|
| `thinker` | Resumes agents via AgentManager, removes from HaltManager |
| `telegram` | Restarts channel polling, removes from HaltManager |
| `inngest` | Removes from HaltManager (functions execute normally) |
| `all` | All three |

Returns confirmation + full `/status` output.

### `/delete <range>`

Deletes Telegram messages in a time range or by count.

| Argument | Meaning |
|----------|---------|
| `today` | Messages from start of today |
| `yesterday` | Messages from start of yesterday to start of today |
| `week` | Messages from start of this week (Monday) |
| `Nh` | Messages from last N hours (1-168) |
| `N` | Last N messages (1-500) |

Messages are fetched in batches of 100 (up to 500 total), then deleted in batches of 100.

### `/browser`

Browser MCP status: proxy configuration, open tab count, and tab listing.

### `/diagnose`

Deep system diagnosis — runs 22 automated health checks. See [Diagnostics](#diagnostics-diagnose) below.

---

## Diagnostics (`/diagnose`)

```
Orchestrator/src/commands/diagnostic-checks.ts
```

Runs 22 health checks **in parallel** and returns findings sorted by severity: critical first, then warning, then info. Individual check failures are non-fatal (return null, don't break the whole diagnosis).

### Severity Levels

| Icon | Level | Meaning |
|------|-------|---------|
| `[!!]` | `critical` | Requires immediate attention |
| `[!]` | `warning` | Should be investigated |
| `[i]` | `info` | Informational, may need cleanup |

### Output Format

```
System Diagnosis (22 checks, N findings, XXXms)

[!!] Services: Gmail MCP is DOWN
    → Check logs with /logs, restart with ./restart.sh

[!] Logs: Error rate 5x baseline (12 errors in last hour)
    → Check /logs for details

[i] Data: Data directory 120 MB
    → Clean up old data or run memory synthesis

18 other checks passed.
```

### All 22 Checks

#### Services (5 checks)

| # | Check | What | Severity | Threshold |
|---|-------|------|----------|-----------|
| 1 | MCP Health | Any MCP server marked unavailable | critical | Any DOWN |
| 2 | Agent Health | Agent paused, down, or restart-flapping | critical/warning | DOWN/PAUSED = critical, restarts > 3 = warning |
| 3 | Inngest Health | Server + endpoint HTTP health (3s timeout) | critical | Either unreachable |
| 4 | Cost Status | Any agent paused with "token" in reason | critical | Any token-paused |
| 5 | Halt Manager | Any target (thinker/telegram/inngest) halted | warning | Any halted |

#### Embedding & Search (3 checks)

| # | Check | What | Severity | Threshold |
|---|-------|------|----------|-----------|
| 6 | Ollama Connectivity | `${OLLAMA_URL}/api/tags` reachable | warning | Unreachable |
| 7 | Embedding Cache Size | `~/.annabelle/data/embedding-cache.json` | info | > 10 MB |
| 8 | Memory DB Size | `~/.annabelle/data/memory.db` | info | > 50 MB |

#### Logs (3 checks)

| # | Check | What | Severity | Threshold |
|---|-------|------|----------|-----------|
| 9 | Log File Sizes | Any log in `~/.annabelle/logs/` too large | warning | > 50 MB per file |
| 10 | Error Rate Baseline | Current hour errors/warnings vs historical baseline | warning | 3x baseline AND >= 3 errors or >= 5 warnings |
| 11 | Trace Log Freshness | `traces.jsonl` last modified time | warning | > 1 hour stale |

#### Cron & Jobs (4 checks)

| # | Check | What | Severity | Threshold |
|---|-------|------|----------|-----------|
| 12 | Stale Cron Jobs | Enabled jobs that haven't run for 2x expected interval | warning | Last run > 2x interval |
| 13 | Failed Cron Skills | Skills with `last_run_status === 'error'` | warning | Any failed |
| 14 | Failed Tasks | Background tasks failed in last 6 hours | warning | Any failed |
| 15 | Job Queue Depth | Job queue directory entry count | info | > 1000 entries |

#### Tools (2 checks)

| # | Check | What | Severity | Threshold |
|---|-------|------|----------|-----------|
| 16 | Tool Count Drift | Current tool count vs system-snapshot.md | warning | +/- 3 tools |
| 17 | Guardian Availability | Guardian enabled but MCP unavailable | critical/warning | critical if failMode=closed, warning if open |

#### Data (3 checks)

| # | Check | What | Severity | Threshold |
|---|-------|------|----------|-----------|
| 18 | Data Directory Size | Total size of `~/.annabelle/data/` | info | > 100 MB |
| 19 | Session Count | Active sessions from status | warning | >= 20 sessions |
| 20 | Documentation Freshness | `system-snapshot.md` last modified | info | > 24 hours or missing |

#### Security (2 checks)

| # | Check | What | Severity | Threshold |
|---|-------|------|----------|-----------|
| 21 | Recent Threat Rate | Threats in last hour from Guardian scan log | warning | >= 3 threats |
| 22 | Guardian Scan Quality | Low-confidence scans (< 0.5) in recent history | info | >= 5 low-confidence |

### Proactive Health Reports

The `healthReportFunction` (Inngest, every 6 hours) runs the same 22 checks, compares findings with the last report, and sends a Telegram alert only when findings **change** (new findings appear or existing ones resolve).

---

## Key Files

| File | Purpose |
|------|---------|
| `Orchestrator/src/commands/slash-commands.ts` | Command parsing, dispatch, all handler implementations |
| `Orchestrator/src/commands/diagnostic-checks.ts` | 22 health checks, severity logic, output formatting |
| `Orchestrator/src/commands/error-baseline.ts` | Historical error rate tracking for check #10 |
| `Orchestrator/src/core/halt-manager.ts` | `/kill` and `/resume` state tracking |
| `Orchestrator/src/jobs/health-report.ts` | Proactive 6-hour health report via Inngest |
