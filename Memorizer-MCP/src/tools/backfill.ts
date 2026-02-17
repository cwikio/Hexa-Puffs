import { z } from 'zod';
import { getDatabase, type ConversationRow } from '../db/index.js';
import { getFactExtractor } from '../services/fact-extractor.js';
import { embedFact } from '../embeddings/fact-embeddings.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import {
  type StandardResponse,
  createSuccess,
  createError,
  createErrorFromException,
} from '@mcp/shared/Types/StandardResponse.js';

// Tool definition
export const backfillExtractFactsToolDefinition = {
  name: 'backfill_extract_facts',
  description:
    'Process a batch of historical conversations that have never been mined for facts. ' +
    'Finds conversations with no associated facts (via the source field), runs fact extraction on each, ' +
    'and stores the results. Call repeatedly until remaining is 0. Designed for Inngest batch processing.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'Agent ID to filter conversations by',
        default: 'main',
      },
      batch_size: {
        type: 'number',
        description: 'Number of conversations to process per call (default 10)',
        default: 10,
      },
    },
  },
};

// Zod input schema
export const BackfillExtractFactsInputSchema = z.object({
  agent_id: z.string().default('main'),
  batch_size: z.number().positive().max(50).default(10),
});

// Response type
export interface BackfillExtractFactsData {
  processed: number;
  facts_extracted: number;
  remaining: number;
}

// Handler
export async function handleBackfillExtractFacts(
  args: unknown,
): Promise<StandardResponse<BackfillExtractFactsData>> {
  const parseResult = BackfillExtractFactsInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { agent_id, batch_size } = parseResult.data;

  try {
    const db = getDatabase();

    // Find conversations that have never been processed for facts.
    // A conversation is "unprocessed" if its ID doesn't appear in any fact's source field.
    const unprocessed = db
      .prepare(
        `SELECT c.id, c.agent_id, c.user_message, c.agent_response
         FROM conversations c
         LEFT JOIN (
           SELECT DISTINCT source FROM facts WHERE source IS NOT NULL
         ) f ON c.id = f.source
         WHERE f.source IS NULL AND c.agent_id = ?
         ORDER BY c.created_at ASC
         LIMIT ?`,
      )
      .all(agent_id, batch_size) as ConversationRow[];

    // Count total remaining (including this batch)
    const countResult = db
      .prepare(
        `SELECT COUNT(*) as count
         FROM conversations c
         LEFT JOIN (
           SELECT DISTINCT source FROM facts WHERE source IS NOT NULL
         ) f ON c.id = f.source
         WHERE f.source IS NULL AND c.agent_id = ?`,
      )
      .get(agent_id) as { count: number };

    if (unprocessed.length === 0) {
      return createSuccess({
        processed: 0,
        facts_extracted: 0,
        remaining: 0,
      });
    }

    const extractor = getFactExtractor();
    const insertFact = db.prepare(
      `INSERT INTO facts (agent_id, fact, category, source, confidence)
       VALUES (?, ?, ?, ?, ?)`,
    );

    let totalFactsExtracted = 0;

    for (const conv of unprocessed) {
      try {
        const result = await extractor.extract(conv.user_message, conv.agent_response);

        if (!result.skipped && result.facts.length > 0) {
          for (const fact of result.facts) {
            const insertResult = insertFact.run(agent_id, fact.fact, fact.category, conv.id, fact.confidence);
            const factId = Number(insertResult.lastInsertRowid);
            await embedFact(factId, fact.fact);
            totalFactsExtracted++;
          }
        }
      } catch (error) {
        // Log but don't fail the entire batch for one conversation
        logger.warn('Backfill extraction failed for conversation', {
          conversation_id: conv.id,
          error,
        });
      }
    }

    const remaining = countResult.count - unprocessed.length;

    logger.info('Backfill batch completed', {
      processed: unprocessed.length,
      facts_extracted: totalFactsExtracted,
      remaining,
    });

    return createSuccess({
      processed: unprocessed.length,
      facts_extracted: totalFactsExtracted,
      remaining: Math.max(0, remaining),
    });
  } catch (error) {
    logger.error('Backfill extraction failed', { error });
    return createErrorFromException(error);
  }
}
