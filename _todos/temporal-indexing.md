# Temporal Indexing

Index every interaction, tool result, and memory by time. Expose natural-language time queries: "What was I working on last Tuesday?" or "Show me everything that changed since January."

## Status

**Phase 1: IMPLEMENTED** — `query_timeline` tool in Memorizer-MCP. Queries across 6 existing tables (facts, conversations, profile_history, skills, contacts, projects) by date range. No new tables or infrastructure.

**Phase 2: NOT STARTED** — `timeline_events` table + Inngest ingestion for external sources (traces.jsonl, fileops-audit.log, session files, job storage).

## What Phase 1 Does

Single `query_timeline` tool with params:
- `date_from` (required), `date_to` (optional, defaults to now)
- `categories` filter: facts, conversations, profile_changes, skills, contacts, projects
- `query` keyword filter
- `limit` (default 50)

Returns unified `TimelineEvent[]` sorted by timestamp DESC with human-readable summaries.

The calling LLM resolves natural-language dates ("last Tuesday" → 2026-02-10) before calling the tool — no date parsing library needed.

## Pros & Cons

### Pros
- **Low cost**: One tool file, no new tables/migrations/background jobs
- **Flips access axis**: From *what* (keyword) to *when* (time range)
- **Cross-entity correlation**: See that on Feb 3rd you had a conversation about auth, created a project, stored 3 facts, and added a contact — all in one response
- **LLM does NLP for free**: Date resolution handled by the calling model

### Cons
- **Phase 1 covers the least interesting data**: Memorizer tables are low-volume/slow-changing. The interesting temporal data (tool calls, errors, file changes) is in JSONL logs that Phase 1 doesn't touch
- **`search_conversations` already covers the main use case**: Has date_from/date_to + keyword search
- **Phase 1 doesn't help with debugging**: Tool calls, errors, file changes are all Phase 2 sources
- **Phase 1 is a convenience layer, not a new capability**: Saves 2-3 tool calls but doesn't unlock previously unanswerable questions

### Bottom Line
Phase 1 is cheap enough to justify. The transformative version (replaying trajectory across tool calls, file changes, conversations) requires Phase 2 — a week of work with ongoing maintenance.

## Phase 2 Design (Future)

### New tables in Memorizer SQLite
- `timeline_events`: source, event_type, timestamp, summary, source_id, metadata
- `timeline_fts`: FTS5 on summaries
- `timeline_checkpoints`: byte-offset watermarks per source for incremental ingestion

### Inngest function
`timelineIngestionFunction` — cron every 5 minutes:
1. Read checkpoint per source
2. Stream new JSONL lines since last offset
3. Filter to high-signal events (message_received, tool_call_complete, error, complete)
4. Batch INSERT into timeline_events
5. Update checkpoint

### Sources to ingest
- `~/.annabelle/logs/traces.jsonl` (29MB, ~144K lines → ~68K high-signal events)
- `~/.annabelle/logs/fileops-audit.log` (1.5MB, ~6K entries)
- `~/.annabelle/sessions/<agentId>/<chatId>.jsonl` (~53 files)
- `~/.annabelle/data/jobs/*.json` and `tasks/*.json`

### Extended query_timeline categories
tool_calls, file_operations, errors, interactions, jobs

### Challenges
- Streaming 29MB JSONL (use createReadStream + readline, not readFileSync)
- Log rotation invalidates byte offsets (fall back to timestamp dedup)
- Timeline bloat (needs TTL/cleanup like synthesize_facts)
- Date format normalization (SQLite datetime vs ISO 8601)

## Files Modified (Phase 1)

- `Memorizer-MCP/src/tools/timeline.ts` — NEW: tool definition + handler
- `Memorizer-MCP/src/types/responses.ts` — TimelineEvent, QueryTimelineData types
- `Memorizer-MCP/src/tools/index.ts` — exports + allToolDefinitions
- `Memorizer-MCP/src/server.ts` — registerTool() call
- `Memorizer-MCP/tests/unit/server.test.ts` — updated tool count (26 → 27)
- `Memorizer-MCP/tests/integration/timeline.test.ts` — NEW: integration tests
- `Memorizer-MCP/tests/helpers/mcp-client.ts` — queryTimeline() convenience method
