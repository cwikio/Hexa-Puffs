import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../../Shared/Utils/logger.js';
import { getDatabase } from './db/index.js';
import { type StandardResponse } from './types/responses.js';
import {
  allToolDefinitions,
  // Facts
  handleStoreFact,
  handleListFacts,
  handleDeleteFact,
  // Conversations
  handleStoreConversation,
  handleSearchConversations,
  // Profiles
  handleGetProfile,
  handleUpdateProfile,
  // Memory
  handleRetrieveMemories,
  // Stats
  handleGetMemoryStats,
  // Export/Import
  handleExportMemory,
  handleImportMemory,
  // Skills
  handleStoreSkill,
  handleListSkills,
  handleGetSkill,
  handleUpdateSkill,
  handleDeleteSkill,
} from './tools/index.js';

export function createServer(): Server {
  const server = new Server(
    {
      name: 'annabelle-memory-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.debug('Listing tools');
    return {
      tools: allToolDefinitions,
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    logger.info('Tool called', { name });

    try {
      let result: StandardResponse<unknown>;

      switch (name) {
        // Facts
        case 'store_fact':
          result = await handleStoreFact(args);
          break;
        case 'list_facts':
          result = await handleListFacts(args);
          break;
        case 'delete_fact':
          result = await handleDeleteFact(args);
          break;

        // Conversations
        case 'store_conversation':
          result = await handleStoreConversation(args);
          break;
        case 'search_conversations':
          result = await handleSearchConversations(args);
          break;

        // Profiles
        case 'get_profile':
          result = await handleGetProfile(args);
          break;
        case 'update_profile':
          result = await handleUpdateProfile(args);
          break;

        // Memory
        case 'retrieve_memories':
          result = await handleRetrieveMemories(args);
          break;

        // Stats
        case 'get_memory_stats':
          result = await handleGetMemoryStats(args);
          break;

        // Export/Import
        case 'export_memory':
          result = await handleExportMemory(args);
          break;
        case 'import_memory':
          result = await handleImportMemory(args);
          break;

        // Skills
        case 'store_skill':
          result = await handleStoreSkill(args);
          break;
        case 'list_skills':
          result = await handleListSkills(args);
          break;
        case 'get_skill':
          result = await handleGetSkill(args);
          break;
        case 'update_skill':
          result = await handleUpdateSkill(args);
          break;
        case 'delete_skill':
          result = await handleDeleteSkill(args);
          break;

        default:
          logger.warn('Unknown tool called', { name });
          result = {
            success: false,
            error: `Unknown tool: ${name}`,
          };
      }

      // Response is already in StandardResponse format, just serialize
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      logger.error('Tool call failed', { name, error });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

export async function initializeServer(): Promise<Server> {
  // Initialize the database first
  getDatabase();

  // Create and return the server
  return createServer();
}
