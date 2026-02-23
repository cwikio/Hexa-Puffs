# ADR-004: SQLite (better-sqlite3 + sqlite-vec) for Memorizer

**Status:** Accepted
**Date:** 2026-02-15

## Context

The Memorizer MCP needs persistent storage for facts, conversations, profiles, skills, contacts, and projects. It also needs vector search for semantic memory retrieval. Options considered:

1. **PostgreSQL + pgvector** — powerful but requires external database server
2. **SQLite + sqlite-vec** — embedded, zero-config, single-file database with vector extension
3. **File-based JSON** — simplest, but no query capability or concurrent access safety

## Decision

**Use better-sqlite3 with the sqlite-vec extension.** The database lives at `~/.hexa-puffs/data/memory.db`. Vector search uses sqlite-vec for cosine similarity on embeddings, with FTS5 full-text search as a fallback tier.

## Consequences

**Benefits:**
- Zero external dependencies — no database server to install or manage
- Single-file database — easy to backup, move, or inspect
- Synchronous API (better-sqlite3) — simpler error handling than async drivers
- sqlite-vec provides real vector similarity search without a vector database
- 3-tier search: vector (sqlite-vec) → FTS5 (full-text) → LIKE (keyword)

**Trade-offs:**
- Single-writer: `SQLITE_BUSY` can occur if multiple Memorizer instances run
- No built-in replication or clustering
- sqlite-vec requires native compilation (platform-specific binary)
- Vector index must be rebuilt when embedding model changes

## Related

- `Memorizer-MCP/README.md` — Database section
- `docs/memory-system.md` — 3-tier search architecture
