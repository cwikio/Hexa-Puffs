import { z } from 'zod';
import { getDatabase, type FactRow, FACT_CATEGORIES } from '../db/index.js';
import { isFactSafe } from '../services/sanitizer.js';
import { embedFact, reembedFact, deleteFactEmbedding } from '../embeddings/fact-embeddings.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import {
  type StandardResponse,
  createSuccess,
  createError,
  createErrorFromException,
} from '@mcp/shared/Types/StandardResponse.js';
import {
  type StoreFactData,
  type ListFactsData,
  type DeleteFactData,
  type UpdateFactData,
} from '../types/responses.js';

// Tool definitions
export const storeFactToolDefinition = {
  name: 'store_fact',
  description: 'Store a single fact about the user. Use category: "preference" for likes/dislikes/settings, "background" for personal details (location, job, age), "contact" for people they mention, "project" for things they\'re working on, "decision" for choices made, "pattern" for recurring behaviors. Before storing, consider if an existing fact should be deleted first to avoid duplicates.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'Which agent is storing this fact',
        default: 'main',
      },
      fact: {
        type: 'string',
        description: 'A concise, self-contained statement (e.g., "Prefers dark mode", "Lives in Krakow", "Manager is Anna")',
      },
      category: {
        type: 'string',
        description: 'Fact category: preference, background, contact, project, decision, or pattern',
        enum: FACT_CATEGORIES,
      },
      source: {
        type: 'string',
        description: 'Optional conversation ID that created this fact',
      },
    },
    required: ['fact', 'category'],
  },
};

export const listFactsToolDefinition = {
  name: 'list_facts',
  description: 'List all stored facts, optionally filtered by category. Use this to review what is known about the user or to find a specific fact ID for deletion. For searching by keyword, use retrieve_memories instead.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'Agent ID to filter by',
        default: 'main',
      },
      category: {
        type: 'string',
        description: 'Optional category to filter by',
        enum: FACT_CATEGORIES,
      },
      limit: {
        type: 'number',
        description: 'Maximum number of facts to return',
        default: 50,
      },
    },
  },
};

export const deleteFactToolDefinition = {
  name: 'delete_fact',
  description: 'Delete a fact by its ID. Use list_facts first to find the ID. Use this to remove outdated or incorrect facts before storing a corrected version.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      fact_id: {
        type: 'number',
        description: 'The ID of the fact to delete',
      },
    },
    required: ['fact_id'],
  },
};

export const updateFactToolDefinition = {
  name: 'update_fact',
  description: 'Update an existing fact with new information. Use this to supersede outdated facts instead of delete + store. For example, if the user moved from Krakow to Warsaw, update the existing "Lives in Krakow" fact rather than creating a duplicate.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      fact_id: {
        type: 'number',
        description: 'The ID of the fact to update (use list_facts to find it)',
      },
      fact: {
        type: 'string',
        description: 'The new fact text to replace the old one',
      },
      category: {
        type: 'string',
        description: 'Optionally change the category',
        enum: FACT_CATEGORIES,
      },
    },
    required: ['fact_id', 'fact'],
  },
};

// Input schemas for validation
export const StoreFactInputSchema = z.object({
  agent_id: z.string().default('main'),
  fact: z.string().min(1),
  category: z.enum(FACT_CATEGORIES),
  source: z.string().optional(),
});

export const ListFactsInputSchema = z.object({
  agent_id: z.string().default('main'),
  category: z.enum(FACT_CATEGORIES).optional(),
  limit: z.number().positive().default(50),
});

export const DeleteFactInputSchema = z.object({
  fact_id: z.number().positive(),
});

export const UpdateFactInputSchema = z.object({
  fact_id: z.number().positive(),
  fact: z.string().min(1),
  category: z.enum(FACT_CATEGORIES).optional(),
});

/**
 * Extract meaningful keywords from a fact string for fuzzy matching.
 * Filters out common stop words and short words.
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'is', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to',
    'for', 'of', 'with', 'by', 'from', 'as', 'into', 'that', 'this',
    'has', 'have', 'had', 'was', 'were', 'are', 'been', 'being',
    'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
    'can', 'not', 'no', 'so', 'up', 'out', 'if', 'about', 'who',
    'which', 'their', 'them', 'then', 'than', 'its', 'his', 'her',
    'likes', 'prefers', 'uses', 'wants', 'needs',
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
}

/**
 * Calculate keyword overlap ratio between two sets of keywords.
 * Returns 0-1 where 1 means perfect overlap.
 */
function keywordOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const matches = a.filter(w => setB.has(w)).length;
  return matches / Math.min(a.length, b.length);
}

// Handler functions
export async function handleStoreFact(args: unknown): Promise<StandardResponse<StoreFactData>> {
  const parseResult = StoreFactInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { agent_id, fact, category, source } = parseResult.data;

  // Check for sensitive data
  if (!isFactSafe(fact)) {
    return createError('Fact contains sensitive data and cannot be stored');
  }

  try {
    const db = getDatabase();

    // Check for exact duplicate facts
    const existing = db
      .prepare(
        `SELECT id FROM facts
         WHERE agent_id = ? AND fact = ? AND category = ?`
      )
      .get(agent_id, fact, category) as { id: number } | undefined;

    if (existing) {
      // Update the existing fact's timestamp
      db.prepare(
        `UPDATE facts SET updated_at = datetime('now'), last_accessed_at = datetime('now') WHERE id = ?`
      ).run(existing.id);

      return createSuccess({
        fact_id: existing.id,
        message: 'Fact already exists, updated timestamp',
        stored_at: new Date().toISOString(),
      });
    }

    // Fuzzy deduplication: check for similar facts in the same category
    const sameCategoryFacts = db
      .prepare(
        `SELECT id, fact FROM facts WHERE agent_id = ? AND category = ?`
      )
      .all(agent_id, category) as Array<{ id: number; fact: string }>;

    const newKeywords = extractKeywords(fact);
    const similarFacts: Array<{ id: number; fact: string; overlap: number }> = [];

    for (const existing of sameCategoryFacts) {
      const existingKeywords = extractKeywords(existing.fact);
      const overlap = keywordOverlap(newKeywords, existingKeywords);
      if (overlap >= 0.6) {
        similarFacts.push({ id: existing.id, fact: existing.fact, overlap });
      }
    }

    // Insert new fact
    const result = db
      .prepare(
        `INSERT INTO facts (agent_id, fact, category, source)
         VALUES (?, ?, ?, ?)`
      )
      .run(agent_id, fact, category, source ?? null);

    const factId = Number(result.lastInsertRowid);
    logger.info('Fact stored', { fact_id: factId, category });

    // Generate and store embedding (best-effort, never blocks fact storage)
    await embedFact(factId, fact);

    const response: StoreFactData = {
      fact_id: factId,
      stored_at: new Date().toISOString(),
    };

    if (similarFacts.length > 0) {
      response.similar_existing = similarFacts.map(f => ({ id: f.id, fact: f.fact }));
      response.message = `Stored, but ${similarFacts.length} similar fact(s) found in "${category}". Consider using update_fact to supersede the old one, or delete_fact to remove duplicates.`;
    }

    return createSuccess(response);
  } catch (error) {
    logger.error('Failed to store fact', { error });
    return createErrorFromException(error);
  }
}

export async function handleListFacts(args: unknown): Promise<StandardResponse<ListFactsData>> {
  const parseResult = ListFactsInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { agent_id, category, limit } = parseResult.data;

  try {
    const db = getDatabase();

    let query = `SELECT * FROM facts WHERE agent_id = ?`;
    const params: (string | number)[] = [agent_id];

    if (category) {
      query += ` AND category = ?`;
      params.push(category);
    }

    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const facts = db.prepare(query).all(...params) as FactRow[];

    // Get total count
    let countQuery = `SELECT COUNT(*) as count FROM facts WHERE agent_id = ?`;
    const countParams: string[] = [agent_id];
    if (category) {
      countQuery += ` AND category = ?`;
      countParams.push(category);
    }
    const countResult = db.prepare(countQuery).get(...countParams) as { count: number };

    return createSuccess({
      facts: facts.map(f => ({
        id: f.id,
        fact: f.fact,
        category: f.category,
        confidence: f.confidence,
        source: f.source,
        created_at: f.created_at,
      })),
      total_count: countResult.count,
    });
  } catch (error) {
    logger.error('Failed to list facts', { error });
    return createErrorFromException(error);
  }
}

export async function handleDeleteFact(args: unknown): Promise<StandardResponse<DeleteFactData>> {
  const parseResult = DeleteFactInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { fact_id } = parseResult.data;

  try {
    const db = getDatabase();

    // Get the fact first
    const fact = db
      .prepare(`SELECT * FROM facts WHERE id = ?`)
      .get(fact_id) as FactRow | undefined;

    if (!fact) {
      return createError(`Fact with ID ${fact_id} not found`);
    }

    // Delete the fact (FTS5 trigger handles facts_fts cleanup)
    db.prepare(`DELETE FROM facts WHERE id = ?`).run(fact_id);

    // Clean up vector embedding
    deleteFactEmbedding(fact_id);

    logger.info('Fact deleted', { fact_id });

    return createSuccess({
      deleted_fact: fact.fact,
    });
  } catch (error) {
    logger.error('Failed to delete fact', { error });
    return createErrorFromException(error);
  }
}

export async function handleUpdateFact(args: unknown): Promise<StandardResponse<UpdateFactData>> {
  const parseResult = UpdateFactInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { fact_id, fact, category } = parseResult.data;

  if (!isFactSafe(fact)) {
    return createError('Fact contains sensitive data and cannot be stored');
  }

  try {
    const db = getDatabase();

    const existing = db
      .prepare(`SELECT * FROM facts WHERE id = ?`)
      .get(fact_id) as FactRow | undefined;

    if (!existing) {
      return createError(`Fact with ID ${fact_id} not found`);
    }

    const newCategory = category ?? existing.category;

    db.prepare(
      `UPDATE facts SET fact = ?, category = ?, updated_at = datetime('now'), last_accessed_at = datetime('now') WHERE id = ?`
    ).run(fact, newCategory, fact_id);

    // Re-embed the updated fact text
    await reembedFact(fact_id, fact);

    logger.info('Fact updated', { fact_id, old_fact: existing.fact, new_fact: fact });

    return createSuccess({
      fact_id,
      old_fact: existing.fact,
      new_fact: fact,
      category: newCategory,
    });
  } catch (error) {
    logger.error('Failed to update fact', { error });
    return createErrorFromException(error);
  }
}
