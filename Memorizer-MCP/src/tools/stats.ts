import { z } from 'zod';
import { statSync } from 'fs';
import { getDatabase } from '../db/index.js';
import { getConfig } from '../config/index.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import {
  type StandardResponse,
  type MemoryStatsData,
  createSuccess,
  createError,
  createErrorFromException,
} from '../types/responses.js';

// Tool definition
export const getMemoryStatsToolDefinition = {
  name: 'get_memory_stats',
  description: 'Get memory usage statistics',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'Agent ID to get stats for',
        default: 'main',
      },
    },
  },
};

// Input schema for validation
const GetMemoryStatsInputSchema = z.object({
  agent_id: z.string().default('main'),
});

// Handler function
export async function handleGetMemoryStats(args: unknown): Promise<StandardResponse<MemoryStatsData>> {
  const parseResult = GetMemoryStatsInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { agent_id } = parseResult.data;

  try {
    const db = getDatabase();
    const config = getConfig();

    // Get fact count
    const factCount = db
      .prepare(`SELECT COUNT(*) as count FROM facts WHERE agent_id = ?`)
      .get(agent_id) as { count: number };

    // Get conversation count
    const conversationCount = db
      .prepare(`SELECT COUNT(*) as count FROM conversations WHERE agent_id = ?`)
      .get(agent_id) as { count: number };

    // Get oldest conversation
    const oldestConversation = db
      .prepare(
        `SELECT created_at FROM conversations
         WHERE agent_id = ?
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get(agent_id) as { created_at: string } | undefined;

    // Get newest conversation
    const newestConversation = db
      .prepare(
        `SELECT created_at FROM conversations
         WHERE agent_id = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(agent_id) as { created_at: string } | undefined;

    // Get fact category breakdown
    const categoryBreakdown = db
      .prepare(
        `SELECT category, COUNT(*) as count
         FROM facts
         WHERE agent_id = ?
         GROUP BY category`
      )
      .all(agent_id) as { category: string; count: number }[];

    // Get database size
    let databaseSizeMb = 0;
    try {
      const stats = statSync(config.database.path);
      databaseSizeMb = Math.round((stats.size / 1024 / 1024) * 100) / 100;
    } catch {
      // File might not exist yet
    }

    return createSuccess({
      fact_count: factCount.count,
      conversation_count: conversationCount.count,
      oldest_conversation: oldestConversation?.created_at ?? null,
      newest_conversation: newestConversation?.created_at ?? null,
      facts_by_category: Object.fromEntries(
        categoryBreakdown.map(c => [c.category, c.count])
      ),
      database_size_mb: databaseSizeMb,
    });
  } catch (error) {
    logger.error('Failed to get memory stats', { error });
    return createErrorFromException(error);
  }
}
