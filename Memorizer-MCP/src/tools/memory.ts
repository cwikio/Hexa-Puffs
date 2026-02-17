import { z } from 'zod';
import { getDatabase, type FactRow, type ConversationRow } from '../db/index.js';
import { getEmbeddingProvider, isVectorSearchEnabled } from '../embeddings/index.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import { getConfig } from '../config/index.js';
import {
  type StandardResponse,
  createSuccess,
  createError,
  createErrorFromException,
} from '@mcp/shared/Types/StandardResponse.js';
import { type RetrieveMemoriesData } from '../types/responses.js';

// Tool definitions
export const retrieveMemoriesToolDefinition = {
  name: 'retrieve_memories',
  description: 'Search across both facts and past conversations by keyword. This is the primary memory lookup tool — use it when the user asks "do you remember", "what do you know about", or when you need context before responding. For browsing all facts by category use list_facts. For searching only past chat transcripts with date filters use search_conversations.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'Agent ID to search within',
        default: 'main',
      },
      query: {
        type: 'string',
        description: 'Search keywords',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results per type',
        default: 5,
      },
      include_conversations: {
        type: 'boolean',
        description: 'Whether to include conversations in results',
        default: true,
      },
    },
    required: ['query'],
  },
};

// Input schema for validation
export const RetrieveMemoriesInputSchema = z.object({
  agent_id: z.string().default('main'),
  query: z.string().min(1),
  limit: z.number().positive().default(5),
  include_conversations: z.boolean().default(true),
});

// ============================================================================
// Hybrid Search — Pure Functions (exported for unit testing)
// ============================================================================

/** Scored result from a single search strategy */
export interface ScoredResult {
  id: number;
  score: number;
}

/**
 * Normalize scores to [0, 1] via min-max normalization.
 * If all scores are equal, returns 0.5 for each.
 * Empty map returns empty map.
 */
export function normalizeScores(results: Map<number, number>): Map<number, number> {
  if (results.size === 0) return new Map();

  const scores = Array.from(results.values());
  const min = Math.min(...scores);
  const max = Math.max(...scores);

  if (max === min) {
    const normalized = new Map<number, number>();
    for (const id of results.keys()) {
      normalized.set(id, 0.5);
    }
    return normalized;
  }

  const range = max - min;
  const normalized = new Map<number, number>();
  for (const [id, score] of results) {
    normalized.set(id, (score - min) / range);
  }
  return normalized;
}

/**
 * Combine vector and text search results using weighted scoring.
 * Union-based: facts appearing in either set get scored.
 * Missing side gets 0 for that component.
 * Returns sorted by finalScore descending.
 */
export function hybridRank(
  vectorResults: Map<number, number>,
  textResults: Map<number, number>,
  vectorWeight: number,
  textWeight: number,
): ScoredResult[] {
  const normVector = normalizeScores(vectorResults);
  const normText = normalizeScores(textResults);

  // Union of all IDs
  const allIds = new Set([...normVector.keys(), ...normText.keys()]);

  const scored: ScoredResult[] = [];
  for (const id of allIds) {
    const vScore = normVector.get(id) ?? 0;
    const tScore = normText.get(id) ?? 0;
    scored.push({ id, score: vectorWeight * vScore + textWeight * tScore });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ============================================================================
// Search Strategies
// ============================================================================

/**
 * Vector similarity search via sqlite-vec.
 * Returns Map<factId, similarity> where similarity = 1 / (1 + distance).
 */
async function vectorSearch(
  query: string,
  agentId: string,
  limit: number,
): Promise<Map<number, number>> {
  const results = new Map<number, number>();
  const provider = getEmbeddingProvider();
  if (!provider) return results;

  try {
    const db = getDatabase();

    // Check if vec_facts exists
    try {
      db.prepare('SELECT COUNT(*) FROM vec_facts LIMIT 1').get();
    } catch {
      return results;
    }

    const queryEmbedding = await provider.embed(query);
    const rows = db
      .prepare(
        `SELECT v.rowid, v.distance
         FROM vec_facts v
         JOIN facts f ON f.id = v.rowid
         WHERE v.embedding MATCH ?
           AND f.agent_id = ?
           AND k = ?
         ORDER BY v.distance ASC`,
      )
      .all(Buffer.from(queryEmbedding.buffer), agentId, limit) as Array<{
      rowid: number;
      distance: number;
    }>;

    for (const row of rows) {
      // Convert distance to similarity: smaller distance = higher similarity
      results.set(row.rowid, 1 / (1 + row.distance));
    }
  } catch (error) {
    logger.warn('Vector search failed, falling back to text-only', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return results;
}

/**
 * FTS5 full-text search with porter stemming.
 * Returns Map<factId, bm25Score> where higher = better match.
 */
function fts5Search(
  query: string,
  agentId: string,
  limit: number,
): Map<number, number> {
  const results = new Map<number, number>();

  try {
    const db = getDatabase();

    // Check if facts_fts exists
    try {
      db.prepare('SELECT COUNT(*) FROM facts_fts LIMIT 1').get();
    } catch {
      return results;
    }

    // Build FTS5 query: quote each term and join with OR
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .map((t) => `"${t.replace(/"/g, '')}"`)
      .join(' OR ');

    if (!terms) return results;

    const rows = db
      .prepare(
        `SELECT f.id, -fts.rank AS score
         FROM facts_fts fts
         JOIN facts f ON f.id = fts.rowid
         WHERE facts_fts MATCH ?
           AND f.agent_id = ?
         ORDER BY fts.rank
         LIMIT ?`,
      )
      .all(terms, agentId, limit) as Array<{ id: number; score: number }>;

    for (const row of rows) {
      results.set(row.id, row.score);
    }
  } catch (error) {
    logger.warn('FTS5 search failed, falling back to LIKE', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return results;
}

/**
 * Original LIKE %keyword% search as final fallback.
 * Returns Map<factId, confidence> (uses confidence as score proxy).
 */
function likeFallbackSearch(
  query: string,
  agentId: string,
  limit: number,
): Map<number, number> {
  const results = new Map<number, number>();

  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((k) => k.length > 2);
  if (keywords.length === 0) {
    keywords.push(query.toLowerCase());
  }

  const db = getDatabase();
  const conditions = keywords.map(() => `fact LIKE ?`).join(' OR ');
  const params = keywords.map((k) => `%${k}%`);

  const rows = db
    .prepare(
      `SELECT id, confidence FROM facts
       WHERE agent_id = ? AND (${conditions})
       ORDER BY confidence DESC,
                COALESCE(last_accessed_at, created_at) DESC,
                created_at DESC
       LIMIT ?`,
    )
    .all(agentId, ...params, limit) as Array<{ id: number; confidence: number }>;

  for (const row of rows) {
    results.set(row.id, row.confidence);
  }

  return results;
}

// Handler function
export async function handleRetrieveMemories(args: unknown): Promise<StandardResponse<RetrieveMemoriesData>> {
  const parseResult = RetrieveMemoriesInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { agent_id, query, limit, include_conversations } = parseResult.data;

  try {
    const db = getDatabase();
    const config = getConfig();
    const { vectorWeight, textWeight } = config.embedding;

    // --- Fact search with hybrid ranking ---
    let rankedFactIds: number[];

    if (isVectorSearchEnabled()) {
      // Full hybrid: vector + FTS5
      const [vectorResults, textResults] = await Promise.all([
        vectorSearch(query, agent_id, limit * 3),
        Promise.resolve(fts5Search(query, agent_id, limit * 3)),
      ]);

      if (vectorResults.size > 0 || textResults.size > 0) {
        const ranked = hybridRank(vectorResults, textResults, vectorWeight, textWeight);
        rankedFactIds = ranked.slice(0, limit).map((r) => r.id);
      } else {
        // Both empty — fall back to LIKE
        const fallback = likeFallbackSearch(query, agent_id, limit);
        rankedFactIds = Array.from(fallback.keys());
      }
    } else {
      // No vector provider — try FTS5 first, then LIKE fallback
      const textResults = fts5Search(query, agent_id, limit);
      if (textResults.size > 0) {
        // Normalize and sort
        const normalized = normalizeScores(textResults);
        rankedFactIds = Array.from(normalized.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([id]) => id);
      } else {
        const fallback = likeFallbackSearch(query, agent_id, limit);
        rankedFactIds = Array.from(fallback.keys());
      }
    }

    // Fetch full fact rows in ranked order
    let facts: FactRow[] = [];
    if (rankedFactIds.length > 0) {
      const placeholders = rankedFactIds.map(() => '?').join(',');
      const allFacts = db
        .prepare(
          `SELECT * FROM facts WHERE id IN (${placeholders})`,
        )
        .all(...rankedFactIds) as FactRow[];

      // Preserve ranked order
      const factMap = new Map(allFacts.map((f) => [f.id, f]));
      facts = rankedFactIds.map((id) => factMap.get(id)).filter((f): f is FactRow => f !== undefined);

      // Update last_accessed_at for retrieved facts
      db.prepare(
        `UPDATE facts SET last_accessed_at = datetime('now') WHERE id IN (${placeholders})`,
      ).run(...rankedFactIds);
    }

    // --- Conversation search (unchanged — LIKE is fine for long text) ---
    let conversations: ConversationRow[] = [];
    if (include_conversations) {
      const keywords = query
        .toLowerCase()
        .split(/\s+/)
        .filter((k) => k.length > 2);
      if (keywords.length === 0) {
        keywords.push(query.toLowerCase());
      }

      const convConditions = keywords
        .map(() => `(user_message LIKE ? OR agent_response LIKE ?)`)
        .join(' OR ');
      const convParams = keywords.flatMap((k) => [`%${k}%`, `%${k}%`]);

      conversations = db
        .prepare(
          `SELECT * FROM conversations
           WHERE agent_id = ? AND (${convConditions})
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(agent_id, ...convParams, limit) as ConversationRow[];
    }

    logger.debug('Memories retrieved', {
      query,
      facts_count: facts.length,
      conversations_count: conversations.length,
      search_mode: isVectorSearchEnabled() ? 'hybrid' : 'text-only',
    });

    return createSuccess({
      facts: facts.map((f) => ({
        id: f.id,
        fact: f.fact,
        category: f.category,
        confidence: f.confidence,
        created_at: f.created_at,
      })),
      conversations: conversations.map((c) => ({
        id: c.id,
        user_message: c.user_message,
        agent_response: c.agent_response,
        created_at: c.created_at,
      })),
    });
  } catch (error) {
    logger.error('Failed to retrieve memories', { error });
    return createErrorFromException(error);
  }
}
