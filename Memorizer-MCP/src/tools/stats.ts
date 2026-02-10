import { z } from 'zod';
import { statSync } from 'fs';
import { getDatabase, isSqliteVecLoaded } from '../db/index.js';
import { isVectorSearchEnabled } from '../embeddings/index.js';
import { getConfig } from '../config/index.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import {
  type StandardResponse,
  createSuccess,
  createError,
  createErrorFromException,
} from '@mcp/shared/Types/StandardResponse.js';
import { type MemoryStatsData, type SearchCapabilities } from '../types/responses.js';

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
export const GetMemoryStatsInputSchema = z.object({
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

    // Check search capabilities
    const sqliteVecOk = isSqliteVecLoaded();
    const vectorOk = isVectorSearchEnabled();
    let fts5Available = false;
    try {
      db.prepare('SELECT COUNT(*) FROM facts_fts LIMIT 1').get();
      fts5Available = true;
    } catch {
      // FTS5 table not available
    }

    const embeddingProvider = config.embedding.provider === 'none' ? null : config.embedding.provider;

    let searchMode: SearchCapabilities['search_mode'];
    if (vectorOk && sqliteVecOk) {
      searchMode = 'hybrid';
    } else if (fts5Available) {
      searchMode = 'fts5_only';
    } else {
      searchMode = 'like_fallback';
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
      search_capabilities: {
        sqlite_vec_loaded: sqliteVecOk,
        embedding_provider: embeddingProvider,
        vector_search_enabled: vectorOk,
        fts5_available: fts5Available,
        search_mode: searchMode,
      },
    });
  } catch (error) {
    logger.error('Failed to get memory stats', { error });
    return createErrorFromException(error);
  }
}
