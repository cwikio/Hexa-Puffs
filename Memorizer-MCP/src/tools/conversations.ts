import { z } from 'zod';
import { getDatabase, generateId, type ConversationRow } from '../db/index.js';
import { getFactExtractor } from '../services/fact-extractor.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import {
  type StandardResponse,
  createSuccess,
  createError,
  createErrorFromException,
} from '@mcp/shared/Types/StandardResponse.js';
import {
  type StoreConversationData,
  type SearchConversationsData,
} from '../types/responses.js';

// Tool definitions
export const storeConversationToolDefinition = {
  name: 'store_conversation',
  description: 'Log a conversation exchange (user message + agent response). Automatically extracts and stores facts from the conversation. Called internally after each chat interaction — rarely needs to be called manually.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'Which agent had this conversation',
        default: 'main',
      },
      session_id: {
        type: 'string',
        description: 'Optional session ID to group conversations',
      },
      user_message: {
        type: 'string',
        description: 'The user message',
      },
      agent_response: {
        type: 'string',
        description: 'The agent response',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional tags for the conversation',
      },
    },
    required: ['user_message', 'agent_response'],
  },
};

export const searchConversationsToolDefinition = {
  name: 'search_conversations',
  description: 'Search past chat transcripts by keyword with optional date range. Searches both user messages and agent responses. Use this when the user asks "what did we talk about last week" or to find a specific past discussion. For searching stored facts instead, use list_facts or retrieve_memories.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'Agent ID to filter by',
        default: 'main',
      },
      query: {
        type: 'string',
        description: 'Search keywords',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of conversations to return',
        default: 10,
      },
      date_from: {
        type: 'string',
        description: 'Start date filter (YYYY-MM-DD)',
      },
      date_to: {
        type: 'string',
        description: 'End date filter (YYYY-MM-DD)',
      },
    },
    required: ['query'],
  },
};

// Input schemas for validation
export const StoreConversationInputSchema = z.object({
  agent_id: z.string().default('main'),
  session_id: z.string().optional(),
  user_message: z.string().min(1),
  agent_response: z.string().min(1),
  tags: z.array(z.string()).optional(),
});

export const SearchConversationsInputSchema = z.object({
  agent_id: z.string().default('main'),
  query: z.string().min(1),
  limit: z.number().positive().default(10),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
});

// Handler functions
export async function handleStoreConversation(args: unknown): Promise<StandardResponse<StoreConversationData>> {
  const parseResult = StoreConversationInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { agent_id, session_id, user_message, agent_response, tags } = parseResult.data;

  try {
    const db = getDatabase();
    const conversationId = generateId();

    // Store the conversation
    db.prepare(
      `INSERT INTO conversations (id, agent_id, session_id, user_message, agent_response, tags)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      conversationId,
      agent_id,
      session_id ?? null,
      user_message,
      agent_response,
      tags ? JSON.stringify(tags) : null
    );

    logger.info('Conversation stored', { conversation_id: conversationId });

    // Trigger fact extraction asynchronously
    let factsExtracted = 0;
    try {
      const extractor = getFactExtractor();
      const result = await extractor.extract(user_message, agent_response);

      if (!result.skipped && result.facts.length > 0) {
        // Store extracted facts
        const insertFact = db.prepare(
          `INSERT INTO facts (agent_id, fact, category, source, confidence)
           VALUES (?, ?, ?, ?, ?)`
        );

        for (const fact of result.facts) {
          insertFact.run(agent_id, fact.fact, fact.category, conversationId, fact.confidence);
          factsExtracted++;
        }

        logger.info('Facts extracted from conversation', {
          conversation_id: conversationId,
          facts_count: factsExtracted,
        });
      }
    } catch (extractError) {
      // Don't fail the whole operation if extraction fails
      logger.warn('Fact extraction failed', { error: extractError });
    }

    return createSuccess({
      conversation_id: conversationId,
      facts_extracted: factsExtracted,
      stored_at: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to store conversation', { error });
    return createErrorFromException(error);
  }
}

export async function handleSearchConversations(args: unknown): Promise<StandardResponse<SearchConversationsData>> {
  const parseResult = SearchConversationsInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { agent_id, query, limit, date_from, date_to } = parseResult.data;

  try {
    const db = getDatabase();

    let sql = `
      SELECT * FROM conversations
      WHERE agent_id = ?
        AND (user_message LIKE ? OR agent_response LIKE ?)
    `;
    const params: (string | number)[] = [agent_id, `%${query}%`, `%${query}%`];

    if (date_from) {
      sql += ` AND created_at >= ?`;
      params.push(date_from);
    }

    if (date_to) {
      sql += ` AND created_at <= ?`;
      params.push(date_to + ' 23:59:59');
    }

    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const conversations = db.prepare(sql).all(...params) as ConversationRow[];

    // Get total count
    let countSql = `
      SELECT COUNT(*) as count FROM conversations
      WHERE agent_id = ?
        AND (user_message LIKE ? OR agent_response LIKE ?)
    `;
    const countParams: string[] = [agent_id, `%${query}%`, `%${query}%`];
    if (date_from) {
      countSql += ` AND created_at >= ?`;
      countParams.push(date_from);
    }
    if (date_to) {
      countSql += ` AND created_at <= ?`;
      countParams.push(date_to + ' 23:59:59');
    }
    const countResult = db.prepare(countSql).get(...countParams) as { count: number };

    return createSuccess({
      conversations: conversations.map(c => ({
        id: c.id,
        session_id: c.session_id,
        user_message: c.user_message,
        agent_response: c.agent_response,
        tags: c.tags ? JSON.parse(c.tags) : null,
        created_at: c.created_at,
      })),
      total_count: countResult.count,
    });
  } catch (error) {
    logger.error('Failed to search conversations', { error });
    return createErrorFromException(error);
  }
}
