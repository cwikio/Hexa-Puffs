#!/usr/bin/env node

import { initializeServer } from './server.js';
import { getConfig } from './config/index.js';
import { closeDatabase } from './db/index.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import { startTransport } from '@mcp/shared/Transport/dual-transport.js';
import { type StandardResponse } from './types/responses.js';
import {
  handleStoreFact,
  handleListFacts,
  handleDeleteFact,
  handleStoreConversation,
  handleSearchConversations,
  handleGetProfile,
  handleUpdateProfile,
  handleRetrieveMemories,
  handleGetMemoryStats,
  handleExportMemory,
  handleImportMemory,
  handleStoreSkill,
  handleListSkills,
  handleGetSkill,
  handleUpdateSkill,
  handleDeleteSkill,
} from './tools/index.js';

// Tool handlers map for /tools/call endpoint
const toolHandlers: Record<string, (input: unknown) => Promise<StandardResponse<unknown>>> = {
  store_fact: handleStoreFact,
  list_facts: handleListFacts,
  delete_fact: handleDeleteFact,
  store_conversation: handleStoreConversation,
  search_conversations: handleSearchConversations,
  get_profile: handleGetProfile,
  update_profile: handleUpdateProfile,
  retrieve_memories: handleRetrieveMemories,
  get_memory_stats: handleGetMemoryStats,
  export_memory: handleExportMemory,
  import_memory: handleImportMemory,
  store_skill: handleStoreSkill,
  list_skills: handleListSkills,
  get_skill: handleGetSkill,
  update_skill: handleUpdateSkill,
  delete_skill: handleDeleteSkill,
};

async function main(): Promise<void> {
  const config = getConfig();

  logger.info('Starting Annabelle Memory MCP', {
    transport: config.transport,
    port: config.port,
  });

  try {
    const server = await initializeServer();

    await startTransport(server, {
      transport: config.transport as 'stdio' | 'sse' | 'http',
      port: config.port,
      serverName: 'memory-mcp',
      onShutdown: () => {
        closeDatabase();
      },
      onToolCall: async (name: string, args: unknown) => {
        const handler = toolHandlers[name];
        if (!handler) {
          throw new Error(`Unknown tool: ${name}`);
        }
        return handler(args);
      },
      log: (message: string, data?: unknown) => {
        if (data) {
          logger.info(message, data);
        } else {
          logger.info(message);
        }
      },
    });
  } catch (error) {
    logger.error('Failed to start Memory MCP', { error });
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error('Unhandled error', { error });
  process.exit(1);
});
