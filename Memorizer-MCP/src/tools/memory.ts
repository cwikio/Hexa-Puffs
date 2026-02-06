import { z } from 'zod';
import { getDatabase, type FactRow, type ConversationRow } from '../db/index.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import {
  type StandardResponse,
  type RetrieveMemoriesData,
  createSuccess,
  createError,
  createErrorFromException,
} from '../types/responses.js';

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

// Handler function
export async function handleRetrieveMemories(args: unknown): Promise<StandardResponse<RetrieveMemoriesData>> {
  const parseResult = RetrieveMemoriesInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { agent_id, query, limit, include_conversations } = parseResult.data;

  try {
    const db = getDatabase();

    // Split query into keywords for better matching
    const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2);
    if (keywords.length === 0) {
      keywords.push(query.toLowerCase());
    }

    // Search facts
    // Build a query that matches any of the keywords
    // Rank by: confidence, then recency (last accessed or created), then creation date
    const factConditions = keywords.map(() => `fact LIKE ?`).join(' OR ');
    const factParams = keywords.map(k => `%${k}%`);

    const facts = db
      .prepare(
        `SELECT * FROM facts
         WHERE agent_id = ? AND (${factConditions})
         ORDER BY confidence DESC,
                  COALESCE(last_accessed_at, created_at) DESC,
                  created_at DESC
         LIMIT ?`
      )
      .all(agent_id, ...factParams, limit) as FactRow[];

    // Update last_accessed_at for retrieved facts so recency stays current
    if (facts.length > 0) {
      const placeholders = facts.map(() => '?').join(',');
      const ids = facts.map(f => f.id);
      db.prepare(
        `UPDATE facts SET last_accessed_at = datetime('now') WHERE id IN (${placeholders})`
      ).run(...ids);
    }

    // Search conversations if requested
    let conversations: ConversationRow[] = [];
    if (include_conversations) {
      const convConditions = keywords
        .map(() => `(user_message LIKE ? OR agent_response LIKE ?)`)
        .join(' OR ');
      const convParams = keywords.flatMap(k => [`%${k}%`, `%${k}%`]);

      conversations = db
        .prepare(
          `SELECT * FROM conversations
           WHERE agent_id = ? AND (${convConditions})
           ORDER BY created_at DESC
           LIMIT ?`
        )
        .all(agent_id, ...convParams, limit) as ConversationRow[];
    }

    logger.debug('Memories retrieved', {
      query,
      facts_count: facts.length,
      conversations_count: conversations.length,
    });

    return createSuccess({
      facts: facts.map(f => ({
        id: f.id,
        fact: f.fact,
        category: f.category,
        confidence: f.confidence,
        created_at: f.created_at,
      })),
      conversations: conversations.map(c => ({
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
