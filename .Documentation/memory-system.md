# Memory System

> How Memorizer-MCP stores, searches, and retrieves knowledge. Covers the database schema, hybrid search algorithm, embedding pipeline, and common issues.

## Database Schema

**Database:** SQLite via better-sqlite3 at `~/.annabelle/data/memory.db`

### Core Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `facts` | Discrete learnings about users | `id`, `agent_id`, `fact`, `category`, `source`, `confidence`, `created_at`, `updated_at`, `last_accessed_at` |
| `conversations` | Full interaction history | `id`, `agent_id`, `session_id`, `user_message`, `agent_response`, `tags`, `created_at` |
| `profiles` | Structured user knowledge per agent | `agent_id` (PK), `profile_data` (JSON), `created_at`, `updated_at` |
| `profile_history` | Rollback capability for profiles | `id`, `agent_id`, `profile_data`, `changed_at`, `change_reason` |
| `skills` | Autonomous behavior definitions | `id`, `agent_id`, `name`, `description`, `enabled`, `trigger_type`, `trigger_config`, `instructions`, `required_tools`, `execution_plan`, `max_steps` |
| `contacts` | People the user works with | `id`, `agent_id`, `name`, `email`, `company`, `role`, `type` (work/personal/ignored) |
| `projects` | Things user works on | `id`, `agent_id`, `name`, `status`, `type`, `description`, `primary_contact_id`, `participants`, `company`, `priority` |

### Fact Categories

`preference` | `background` | `pattern` | `project` | `contact` | `decision`

### Search Infrastructure

**FTS5 virtual table** (`facts_fts`):
- External content table pointing to `facts`
- Tokenizer: `porter unicode61` (Porter stemming — "running" matches "run")
- Auto-maintained via triggers on INSERT, DELETE, UPDATE
- Rebuilt on every Memorizer startup: `INSERT INTO facts_fts(facts_fts) VALUES('rebuild')`

**sqlite-vec virtual table** (`vec_facts`):
- Stores vector embeddings as `float[N]` where N = configured dimensions
- Uses `vec0` extension for approximate nearest neighbor search
- Requires `BigInt(rowid)` on INSERT (better-sqlite3 quirk)

## Hybrid Search Algorithm

**File:** `Memorizer-MCP/src/tools/memory.ts`

When `retrieve_memories` is called, it uses a 3-tier fallback:

### Tier 1: Hybrid (Vector + FTS5)

Used when an embedding provider is configured and available.

1. **Vector search** — Embed the query, then find nearest neighbors in `vec_facts`:
   ```sql
   SELECT v.rowid, v.distance
   FROM vec_facts v JOIN facts f ON v.rowid = f.id
   WHERE v.embedding MATCH ? AND f.agent_id = ? AND k = ?
   ```
   Distance converted to similarity: `1 / (1 + distance)`

2. **FTS5 search** — Full-text search with BM25 ranking:
   ```sql
   SELECT f.id, -fts.rank AS score
   FROM facts_fts fts JOIN facts f ON fts.rowid = f.id
   WHERE facts_fts MATCH ? AND f.agent_id = ?
   ORDER BY fts.rank LIMIT ?
   ```
   Query terms are split on whitespace, quoted, joined with OR.

3. **Combine** — Both run in parallel. Results are merged via `hybridRank()`:
   - Min-max normalize each set of scores to [0, 1]
   - Weighted combination: `vectorWeight × vScore + textWeight × tScore`
   - Sort by final score descending
   - Weights are configurable via `config.embedding.vectorWeight` / `textWeight`

### Tier 2: FTS5 Only

Used when embedding provider is not configured or unreachable.

- Same FTS5 query as Tier 1, but results are used directly without vector component.
- Activates automatically when `getEmbeddingProvider()` returns null.

### Tier 3: LIKE Fallback

Used when both vector and FTS5 return zero results (e.g., FTS5 index corruption or very unusual query terms).

```sql
SELECT id, confidence FROM facts
WHERE agent_id = ? AND (fact LIKE ? OR ...)
ORDER BY confidence DESC, COALESCE(last_accessed_at, created_at) DESC, created_at DESC
LIMIT ?
```

Performs substring matching — slowest but most forgiving.

## Embedding Pipeline

### Providers

| Provider | Config | Model |
|----------|--------|-------|
| Ollama | `EMBEDDING_PROVIDER=ollama` | `nomic-embed-text` (default) |
| LM Studio | `EMBEDDING_PROVIDER=lmstudio` | Configured via `LMSTUDIO_HOST` |
| Groq | `EMBEDDING_PROVIDER=groq` | Via `@mcp/shared/Embeddings` |
| None | `EMBEDDING_PROVIDER=none` (default) | No embeddings — FTS5 only |

### When Embeddings Are Generated

- **On fact store:** `embedFact()` called asynchronously (non-blocking). If provider unavailable, fact is stored without embedding.
- **On fact update:** Old embedding deleted, new one generated via `reembedFact()`.
- **Backfill:** `backfill_embeddings` tool processes facts missing embeddings in batches.

### Backfill Process

**Tool:** `backfill_embeddings`

1. Finds facts without embeddings: `LEFT JOIN vec_facts v ON f.id = v.rowid WHERE v.rowid IS NULL`
2. Processes in configurable batch size (default 50, max 200)
3. Uses `provider.embedBatch(texts)` for efficiency
4. Inserts with `BigInt(id)` for rowid
5. **Idempotent** — call repeatedly until `remaining: 0`

## Fact Storage Details

### Deduplication

When storing a new fact:

1. **Exact match check** — Looks for identical fact text in same agent. If found, updates timestamp and returns existing ID.
2. **Fuzzy dedup** — Extracts keywords from new fact (removes stop words, short words). Compares keyword overlap with existing facts in same category. If overlap >= 0.6, flags similar facts as warnings (but still stores the new fact).

### Sensitive Data Protection

`isFactSafe()` checks for patterns that look like passwords, tokens, or keys before storing. Rejects unsafe facts.

## Common Issues

### Fact stored but not found in search

- **Embedding missing:** Check if embedding provider was down when fact was stored. Run `backfill_embeddings`.
- **Query mismatch:** Try different search terms. FTS5 uses Porter stemming — some word forms may not match.
- **Wrong agent scope:** Facts are filtered by `agent_id`. Ensure searching with correct agent.
- **LIKE fallback too narrow:** Tier 3 requires substring match. Very short query terms work better.

### Embedding provider errors

- **Ollama unreachable:** `curl http://localhost:11434/api/tags` — if down, search falls back to FTS5 only.
- **LM Studio unreachable:** Similar fallback behavior.
- **Provider returns wrong dimensions:** Embedding dimensions must match `vec_facts` table definition. Mismatch causes insert errors.

### Database locked

- **Symptom:** `SQLITE_BUSY` errors in logs.
- **Cause:** WAL mode should prevent most locking, but heavy concurrent writes can still conflict.
- **Fix:** Usually transient. If persistent, check for multiple Memorizer processes.

## Key Files

| File | Purpose |
|------|---------|
| `Memorizer-MCP/src/db/schema.ts` | Table definitions, FTS5, sqlite-vec setup |
| `Memorizer-MCP/src/tools/memory.ts` | `retrieve_memories` — hybrid search |
| `Memorizer-MCP/src/tools/facts.ts` | `store_fact`, `list_facts`, `update_fact`, `delete_fact` |
| `Memorizer-MCP/src/tools/conversations.ts` | `store_conversation`, `search_conversations` |
| `Memorizer-MCP/src/tools/backfill-embeddings.ts` | `backfill_embeddings` |
| `Memorizer-MCP/src/tools/export.ts` | `export_memory`, `import_memory` |
| `Memorizer-MCP/src/embeddings/index.ts` | Provider singleton, `isVectorSearchEnabled()` |
| `Memorizer-MCP/src/config/index.ts` | Embedding config, DB path, export path |
