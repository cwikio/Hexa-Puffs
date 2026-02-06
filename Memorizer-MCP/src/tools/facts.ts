import { z } from 'zod';
import { getDatabase, type FactRow, FACT_CATEGORIES } from '../db/index.js';
import { isFactSafe } from '../services/sanitizer.js';
import { logger } from '../../../Shared/Utils/logger.js';
import {
  type StandardResponse,
  type StoreFactData,
  type ListFactsData,
  type DeleteFactData,
  createSuccess,
  createError,
  createErrorFromException,
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

// Input schemas for validation
const StoreFactInputSchema = z.object({
  agent_id: z.string().default('main'),
  fact: z.string().min(1),
  category: z.enum(FACT_CATEGORIES),
  source: z.string().optional(),
});

const ListFactsInputSchema = z.object({
  agent_id: z.string().default('main'),
  category: z.enum(FACT_CATEGORIES).optional(),
  limit: z.number().positive().default(50),
});

const DeleteFactInputSchema = z.object({
  fact_id: z.number().positive(),
});

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

    // Check for duplicate facts
    const existing = db
      .prepare(
        `SELECT id FROM facts
         WHERE agent_id = ? AND fact = ? AND category = ?`
      )
      .get(agent_id, fact, category) as { id: number } | undefined;

    if (existing) {
      // Update the existing fact's timestamp
      db.prepare(
        `UPDATE facts SET updated_at = datetime('now') WHERE id = ?`
      ).run(existing.id);

      return createSuccess({
        fact_id: existing.id,
        message: 'Fact already exists, updated timestamp',
        stored_at: new Date().toISOString(),
      });
    }

    // Insert new fact
    const result = db
      .prepare(
        `INSERT INTO facts (agent_id, fact, category, source)
         VALUES (?, ?, ?, ?)`
      )
      .run(agent_id, fact, category, source ?? null);

    logger.info('Fact stored', { fact_id: result.lastInsertRowid, category });

    return createSuccess({
      fact_id: Number(result.lastInsertRowid),
      stored_at: new Date().toISOString(),
    });
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

    // Delete the fact
    db.prepare(`DELETE FROM facts WHERE id = ?`).run(fact_id);

    logger.info('Fact deleted', { fact_id });

    return createSuccess({
      deleted_fact: fact.fact,
    });
  } catch (error) {
    logger.error('Failed to delete fact', { error });
    return createErrorFromException(error);
  }
}
