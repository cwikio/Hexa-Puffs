#!/usr/bin/env node

import { initializeServer } from './server.js';
import { getConfig } from './config/index.js';
import { closeDatabase, getDatabase, isSqliteVecLoaded } from './db/index.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import { startTransport } from '@mcp/shared/Transport/dual-transport.js';
import { type StandardResponse } from '@mcp/shared/Types/StandardResponse.js';
import {
  handleStoreFact,
  handleListFacts,
  handleDeleteFact,
  handleUpdateFact,
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
  handleCreateContact,
  handleListContacts,
  handleUpdateContact,
  handleCreateProject,
  handleListProjects,
  handleUpdateProject,
} from './tools/index.js';

// Tool handlers map for /tools/call endpoint
const toolHandlers: Record<string, (input: unknown) => Promise<StandardResponse<unknown>>> = {
  store_fact: handleStoreFact,
  list_facts: handleListFacts,
  delete_fact: handleDeleteFact,
  update_fact: handleUpdateFact,
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
  create_contact: handleCreateContact,
  list_contacts: handleListContacts,
  update_contact: handleUpdateContact,
  create_project: handleCreateProject,
  list_projects: handleListProjects,
  update_project: handleUpdateProject,
};

async function main(): Promise<void> {
  // Identify this service in logs so its output is distinguishable
  // when spawned as a stdio child of the Orchestrator
  logger.setContext('memorizer');

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
      onHealth: () => {
        try {
          const db = getDatabase();
          const row = db.prepare('SELECT COUNT(*) as count FROM facts').get() as { count: number };
          return {
            database: 'connected',
            factCount: row.count,
            sqliteVec: isSqliteVecLoaded() ? 'loaded' : 'unavailable',
          };
        } catch {
          return {
            status: 'degraded',
            database: 'error',
            sqliteVec: isSqliteVecLoaded() ? 'loaded' : 'unavailable',
          };
        }
      },
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
