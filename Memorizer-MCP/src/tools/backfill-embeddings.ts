import { z } from 'zod';
import { getDatabase, type FactRow } from '../db/index.js';
import { getEmbeddingProvider, isVectorSearchEnabled } from '../embeddings/index.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import {
  type StandardResponse,
  createSuccess,
  createError,
  createErrorFromException,
} from '@mcp/shared/Types/StandardResponse.js';

// Tool definition
export const backfillEmbeddingsToolDefinition = {
  name: 'backfill_embeddings',
  description:
    'Generate embeddings for facts that do not yet have them. ' +
    'Finds facts without entries in vec_facts, embeds them in batches, and stores the vectors. ' +
    'Call repeatedly until remaining is 0. Requires an embedding provider to be configured.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'Agent ID to filter facts by',
        default: 'main',
      },
      batch_size: {
        type: 'number',
        description: 'Number of facts to process per call (default 50)',
        default: 50,
      },
    },
  },
};

// Zod input schema
export const BackfillEmbeddingsInputSchema = z.object({
  agent_id: z.string().default('main'),
  batch_size: z.number().positive().max(200).default(50),
});

// Response type
export interface BackfillEmbeddingsData {
  processed: number;
  embedded: number;
  failed: number;
  remaining: number;
}

// Handler
export async function handleBackfillEmbeddings(
  args: unknown,
): Promise<StandardResponse<BackfillEmbeddingsData>> {
  const parseResult = BackfillEmbeddingsInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  if (!isVectorSearchEnabled()) {
    return createError(
      'No embedding provider configured. Set EMBEDDING_PROVIDER to "ollama" or "lmstudio".',
    );
  }

  const provider = getEmbeddingProvider();
  if (!provider) {
    return createError('Embedding provider not available.');
  }

  const { agent_id, batch_size } = parseResult.data;

  try {
    const db = getDatabase();

    // Check if vec_facts table exists
    try {
      db.prepare('SELECT COUNT(*) FROM vec_facts LIMIT 1').get();
    } catch {
      return createError('vec_facts table not available — sqlite-vec may not be loaded.');
    }

    // Find facts without embeddings
    const unembedded = db
      .prepare(
        `SELECT f.id, f.fact
         FROM facts f
         LEFT JOIN vec_facts v ON v.rowid = f.id
         WHERE v.rowid IS NULL AND f.agent_id = ?
         ORDER BY f.created_at ASC
         LIMIT ?`,
      )
      .all(agent_id, batch_size) as Array<Pick<FactRow, 'id' | 'fact'>>;

    // Count total remaining (including this batch)
    const countResult = db
      .prepare(
        `SELECT COUNT(*) as count
         FROM facts f
         LEFT JOIN vec_facts v ON v.rowid = f.id
         WHERE v.rowid IS NULL AND f.agent_id = ?`,
      )
      .get(agent_id) as { count: number };

    if (unembedded.length === 0) {
      return createSuccess({
        processed: 0,
        embedded: 0,
        failed: 0,
        remaining: 0,
      });
    }

    // Batch embed all texts at once
    const texts = unembedded.map((f) => f.fact);
    let embeddings: Float32Array[];
    try {
      embeddings = await provider.embedBatch(texts);
    } catch (error) {
      logger.error('Batch embedding failed', { error });
      return createErrorFromException(error);
    }

    const insertStmt = db.prepare(
      'INSERT OR REPLACE INTO vec_facts(rowid, embedding) VALUES (?, ?)',
    );

    let embedded = 0;
    let failed = 0;

    for (let i = 0; i < unembedded.length; i++) {
      try {
        // sqlite-vec requires BigInt for rowid on INSERT
        insertStmt.run(BigInt(unembedded[i].id), Buffer.from(embeddings[i].buffer));
        embedded++;
      } catch (error) {
        failed++;
        logger.warn('Failed to store embedding', {
          factId: unembedded[i].id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const remaining = countResult.count - unembedded.length;

    logger.info('Embedding backfill batch completed', {
      processed: unembedded.length,
      embedded,
      failed,
      remaining,
    });

    return createSuccess({
      processed: unembedded.length,
      embedded,
      failed,
      remaining: Math.max(0, remaining),
    });
  } catch (error) {
    logger.error('Embedding backfill failed', { error });
    return createErrorFromException(error);
  }
}
