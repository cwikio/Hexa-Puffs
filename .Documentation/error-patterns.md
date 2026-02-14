# Error Patterns & Troubleshooting

> Known failure modes, their symptoms, and how to diagnose and fix them. This is the primary self-diagnosis reference.

## How Errors Propagate

```
MCP tool error
  → StdioMCPClient catches, returns { success: false, error: "..." }
    → ToolRouter passes to caller
      → Thinker sees error in tool result, may retry or inform user
        → Orchestrator sends response via Telegram
```

Guardian errors follow a parallel path:
```
Guardian blocks input/output
  → GuardedMCPClient throws SecurityError
    → ToolRouter catches, returns blocked response
      → Thinker sees security error, informs user
```

## Error Pattern Reference

---

### Tool Not Found

**Symptoms:** Thinker tries to call a tool but gets "tool not found" or "no route for tool."

**Possible causes:**

1. **MCP is down** — The MCP that provides the tool crashed or failed to start.
   - Check: `/status` — look for MCPs marked "DOWN"
   - Fix: MCP should auto-restart within 60 seconds (health check interval). If stuck, check `~/.annabelle/logs/orchestrator.log` for spawn errors.

2. **Tool name prefix mismatch** — Tool names are prefixed with MCP name (e.g., `memory_store_fact`). LLM may hallucinate wrong prefix.
   - Check: `/info` — shows all available tools with correct names.
   - Fix: Usually self-correcting. If persistent, the tool selection embedding cache may be stale.

3. **Tool refresh stale** — Thinker caches available tools with a 10-minute TTL.
   - Check: If a tool was just added (new MCP, hot-reload), wait for cache to refresh.
   - Fix: Restart Thinker or wait for TTL expiry.

4. **Agent tool policy** — Agent's `allowedTools`/`deniedTools` in `agents.json` may filter the tool out.
   - Check: Look at agent definition in `agents.json`.

---

### Empty Memory Search Results

**Symptoms:** `retrieve_memories` returns no facts despite knowing they were stored.

**Possible causes:**

1. **Embedding provider down** — If Ollama/LM Studio is unreachable, vector search fails silently and falls back to FTS5.
   - Check: `curl http://localhost:11434/api/tags` (Ollama) or equivalent for LM Studio.
   - Fix: Restart embedding provider. Search will work in degraded mode (FTS5 only) until then.

2. **Fact not yet embedded** — New facts get embeddings asynchronously. If the provider was down when the fact was stored, it has no embedding.
   - Check: Run `backfill_embeddings` tool to generate missing embeddings.
   - Fix: The backfill tool is idempotent — run it until `remaining: 0`.

3. **FTS5 index stale** — The FTS5 index is rebuilt on every Memorizer startup. If Memorizer hasn't restarted since the fact was stored via direct DB manipulation, FTS5 may be out of sync.
   - Fix: Restart Memorizer (Orchestrator will auto-restart it, or restart the whole stack).

4. **Wrong query terms** — FTS5 uses Porter stemming. Very short or unusual words may not match.
   - Fix: Try different search terms. The LIKE fallback (tier 3) does substring matching.

5. **Wrong agent_id** — Facts are scoped per agent. If stored under a different agent, they won't appear.

---

### Agent Paused

**Symptoms:** Messages are dropped, Annabelle doesn't respond. `/status` shows agent as "paused."

**Possible causes:**

1. **Cost controls triggered** — Token consumption exceeded threshold.
   - Two trigger types:
     - **Hard cap exceeded:** Total tokens in sliding 60-minute window exceeded `hardCapTokensPerHour`.
     - **Spike detected:** Recent rate (last `shortWindowMinutes`) exceeded `baselineRate × spikeMultiplier`.
   - Check: `/status` — shows pause reason. Also check `~/.annabelle/logs/thinker.log` for cost monitor messages.
   - Fix: `/resume thinker` — resumes the agent. Optionally add `resetWindow` to clear history.

2. **Manual /kill** — Someone ran `/kill thinker` or `/kill all`.
   - Check: `/status` — shows "halted" state.
   - Fix: `/resume thinker` or `/resume all`.

3. **LLM provider rate limit** — Groq or other provider returned rate limit error.
   - Check: `~/.annabelle/logs/thinker.log` for rate limit errors.
   - Fix: Wait for rate limit to clear (usually 1-5 minutes). Agent has 1-second minimum interval between calls as built-in rate limiting.

---

### Slow Responses

**Symptoms:** Annabelle takes a long time to respond (>30 seconds for simple queries).

**Possible causes:**

1. **LLM provider latency** — Groq, LM Studio, or Ollama is slow.
   - Check: `~/.annabelle/logs/thinker.log` for LLM call durations.
   - Fix: Switch LLM provider or model in `agents.json`.

2. **Too many tools selected** — Embedding selector picked many tools, inflating the system prompt.
   - Check: Thinker trace logs show selected tool count per message.
   - Fix: Tune tool selection cap or adjust `deniedTools` to exclude irrelevant tools.

3. **Large context window** — Long conversation history + many facts + playbook instructions.
   - Check: Look at token counts in session JSONL.
   - Fix: Compaction should handle this automatically. If not triggering, check compaction thresholds.

4. **MCP tool latency** — A specific tool call is slow (e.g., web search, Gmail API).
   - Check: Thinker trace logs show per-tool-call duration.

---

### Scheduled Skill Didn't Run

**Symptoms:** A scheduled skill didn't execute at expected time.

**Possible causes:**

1. **Inngest halted** — Someone ran `/kill inngest`.
   - Check: `/cron` — shows Inngest state.
   - Fix: `/resume inngest`.

2. **Inngest server down** — The Inngest dev server crashed.
   - Check: `curl http://localhost:8288/health`.
   - Fix: Restart via `./start-all.sh` or manually start Inngest.

3. **Graduated backoff active** — After failures, the skill has increasing cooldown delays (1 → 5 → 15 → 60 minutes). After 5 consecutive failures, the skill is auto-disabled.
   - Check: `memory_get_skill` — look at `last_run_status` and `last_run_at`. If status is `error` and recent, backoff is active.
   - Fix: Fix the underlying issue, then `memory_update_skill` to re-enable if auto-disabled. Backoff counters reset on process restart.

4. **Skill disabled** — The skill's `enabled` flag is false.
   - Check: `memory_list_skills` tool — look for disabled skills.
   - Fix: `memory_update_skill` to re-enable. Note: skills auto-enable when their `required_tools` become available.

5. **Pre-flight check skipping** — Meeting skills skip silently when no calendar events exist in the next window. Email skills skip when no new emails.
   - Check: This is intentional (saves LLM cost). Look at `last_run_summary` — it will say "No upcoming events — skipped" or similar.
   - Not a bug — the skill ran but found nothing to do.

6. **Timezone mismatch** — Skill configured with wrong timezone. Timezone is auto-injected from the system at creation time.
   - Check: `/cron` — shows timezone per skill. Compare with system timezone.
   - Fix: `memory_update_skill` with correct `trigger_config.timezone`.

7. **Cron expression issue** — Cron expressions are validated at creation time via `croner`. If the skill was stored, the expression was valid. However, the expression may not match what you expect.
   - Check: `/cron` — shows cron expressions and next run times.
   - Fix: `memory_update_skill` with corrected `trigger_config.schedule`.

---

### Guardian Blocking Legitimate Input

**Symptoms:** Normal messages or tool calls are rejected by Guardian with security warnings.

**Possible causes:**

1. **False positive** — Input triggers a pattern match in Granite Guardian.
   - Check: `/security` — shows recent threat logs with scan details.
   - Fix: Review the threat entry. If false positive, consider adjusting Guardian sensitivity.

2. **Per-agent override** — Agent may have stricter Guardian settings.
   - Check: Agent definition in `agents.json` for Guardian overrides.

3. **Fail mode** — Guardian's fail mode determines behavior when Guardian itself errors.
   - `failMode: 'open'` — Allow through if Guardian errors (less secure, more available).
   - `failMode: 'closed'` — Block if Guardian errors (more secure, may cause false blocks).
   - Check: Guardian configuration / Orchestrator startup logs.

---

### MCP Keeps Restarting (Crash Loop)

**Symptoms:** MCP alternates between "up" and "DOWN" in `/status`. Orchestrator logs show repeated restart attempts.

**Possible causes:**

1. **Missing dependency** — MCP needs an external service that isn't available (e.g., Ollama for Memorizer embeddings, `op` CLI for 1Password).
   - Check: `~/.annabelle/logs/orchestrator.log` for MCP stderr output.
   - Fix: Install/start the missing dependency, or disable the MCP via env var.

2. **Port conflict** — HTTP MCP port already in use.
   - Check: `lsof -i :<port>`.
   - Fix: Kill conflicting process or change port config.

3. **Build not up to date** — TypeScript not compiled after code changes.
   - Fix: Run `./rebuild.sh` then `./restart.sh`.

4. **ESM violation** — Using `require()` instead of `import`. All packages are ESM.
   - Check: Error message contains `require is not defined`.
   - Fix: Change `require()` to `import`.

5. **Max restarts exceeded** — AgentManager stops restarting after 5 consecutive failures (10s cooldown between attempts).
   - Fix: Fix underlying issue, then restart the whole stack.

---

### Gmail/Calendar Not Working

**Symptoms:** Email or calendar tools return errors.

**Possible causes:**

1. **OAuth token expired** — Google OAuth tokens expire and need refresh.
   - Check: Gmail MCP health endpoint returns "degraded."
   - Fix: Run `npm run setup-oauth` in Gmail-MCP directory to re-authenticate.

2. **Gmail MCP down** — MCP failed to start or crashed.
   - Check: `/status` for Gmail MCP availability.
   - Fix: Check `~/.annabelle/logs/orchestrator.log` for Gmail spawn errors.

3. **Scopes insufficient** — OAuth token doesn't have required API scopes.
   - Fix: Re-run OAuth setup with correct scopes.

---

### Wrong Tool Selected / Embedding Issues

**Symptoms:** Annabelle calls the wrong tool for a request, or can't find a tool that should be relevant.

**Possible causes:**

1. **Ollama down** — When embedding provider is unreachable, tool selection falls back to regex matching only.
   - Check: `curl http://localhost:11434/api/tags` (Ollama health).
   - Fix: Restart Ollama. Embedding-based selection will resume automatically.

2. **Embedding cache stale** — Tool list changed but embedding cache hasn't been regenerated.
   - Check: Embedding cache at `~/.annabelle/data/embedding-cache.json` — check `metadata.toolCount`.
   - Fix: Delete the cache file. Thinker regenerates it on next message.

3. **Regex fallback inadequate** — Regex matching uses keyword patterns. Unusual queries may not match.
   - This is expected degraded behavior when embeddings are unavailable.

## General Diagnostic Steps

1. **Check system status:** `/status` — are all services up?
2. **Check recent errors:** `/logs 20` — last 20 warnings/errors across all services.
3. **Check security:** `/security 10` — last 10 security events.
4. **Check cron jobs:** `/cron` — job schedules and last run times.
5. **Read specific logs:** Use `filer_read_file` with path `~/.annabelle/logs/<service>.log` for deeper inspection.
6. **Read documentation:** Use `filer_read_file` with path `~/.annabelle/documentation/<topic>.md` for architecture understanding.

## Key Files

| File | Purpose |
|------|---------|
| `Orchestrator/src/mcp-clients/stdio-client.ts` | MCP error handling, crash detection |
| `Orchestrator/src/mcp-clients/guarded-client.ts` | Guardian integration, SecurityError |
| `Orchestrator/src/routing/tool-router.ts` | Tool routing, error propagation |
| `Thinker/src/agent/loop.ts` | Agent error handling, circuit breaker |
| `Thinker/src/cost/monitor.ts` | Cost control pause/resume |
| `Orchestrator/src/commands/slash-commands.ts` | Diagnostic slash commands |
