import { z } from 'zod';
import { getOrchestrator } from '../core/orchestrator.js';
import type { StandardResponse } from '../../../Shared/Types/StandardResponse.js';

// Fact categories
const FACT_CATEGORIES = [
  'preference',
  'background',
  'pattern',
  'project',
  'contact',
  'decision',
] as const;

// Tool definitions - matching Memorizer's interface exactly
export const storeFactToolDefinition = {
  name: 'store_fact',
  description: 'Store a discrete fact or learning about the user. Facts are saved to ~/.annabelle/data/memory.db and can be viewed using list_facts or export_memory tools.',
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
        description: 'The fact to store',
      },
      category: {
        type: 'string',
        description: 'Category of the fact',
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
  description: 'List all facts with optional filtering by category',
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
  description: 'Delete a specific fact by ID',
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

export const storeConversationToolDefinition = {
  name: 'store_conversation',
  description: 'Log a conversation turn. Automatically triggers fact extraction. Input is security-scanned.',
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
  description: 'Search conversation history by keyword with optional date filters',
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

export const getProfileToolDefinition = {
  name: 'get_profile',
  description: "Get agent's user profile",
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'The agent ID',
        default: 'main',
      },
    },
  },
};

export const updateProfileToolDefinition = {
  name: 'update_profile',
  description: 'Update user profile fields. Supports dot notation for nested fields. Input is security-scanned.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'The agent ID',
        default: 'main',
      },
      updates: {
        type: 'object',
        description: 'Fields to update (dot notation supported)',
      },
      reason: {
        type: 'string',
        description: 'Reason for the update (for history)',
      },
    },
    required: ['updates'],
  },
};

export const retrieveMemoriesToolDefinition = {
  name: 'retrieve_memories',
  description: 'Search for relevant facts and conversations based on a query',
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

export const exportMemoryToolDefinition = {
  name: 'export_memory',
  description: 'Export memory to human-readable files',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'Agent ID to export',
        default: 'main',
      },
      format: {
        type: 'string',
        enum: ['markdown', 'json'],
        description: 'Export format',
        default: 'markdown',
      },
      include_conversations: {
        type: 'boolean',
        description: 'Whether to include conversation history',
        default: true,
      },
    },
  },
};

export const importMemoryToolDefinition = {
  name: 'import_memory',
  description: 'Import user-edited memory files (profile or facts)',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'Agent ID to import into',
        default: 'main',
      },
      file_path: {
        type: 'string',
        description: 'Path to the file to import',
      },
    },
    required: ['file_path'],
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

const StoreConversationInputSchema = z.object({
  agent_id: z.string().default('main'),
  session_id: z.string().optional(),
  user_message: z.string().min(1),
  agent_response: z.string().min(1),
  tags: z.array(z.string()).optional(),
});

const SearchConversationsInputSchema = z.object({
  agent_id: z.string().default('main'),
  query: z.string().min(1),
  limit: z.number().positive().default(10),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
});

const GetProfileInputSchema = z.object({
  agent_id: z.string().default('main'),
});

const UpdateProfileInputSchema = z.object({
  agent_id: z.string().default('main'),
  updates: z.record(z.unknown()),
  reason: z.string().optional(),
});

const RetrieveMemoriesInputSchema = z.object({
  agent_id: z.string().default('main'),
  query: z.string().min(1),
  limit: z.number().positive().default(5),
  include_conversations: z.boolean().default(true),
});

const GetMemoryStatsInputSchema = z.object({
  agent_id: z.string().default('main'),
});

const ExportMemoryInputSchema = z.object({
  agent_id: z.string().default('main'),
  format: z.enum(['markdown', 'json']).default('markdown'),
  include_conversations: z.boolean().default(true),
});

const ImportMemoryInputSchema = z.object({
  agent_id: z.string().default('main'),
  file_path: z.string().min(1),
});

// Handler functions
export async function handleStoreFact(args: unknown): Promise<StandardResponse> {
  const parseResult = StoreFactInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { agent_id, fact, category, source } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.storeFact(fact, category, agent_id, source);

    // Enhance the response with visibility information
    return {
      success: result.success,
      error: result.error,
      data: {
        fact_id: result.fact_id,
        message: result.message,
        stored_at: result.stored_at,
        // Add helpful guidance for users
        storage_info: {
          database_path: '~/.annabelle/data/memory.db',
          view_instructions: `Use 'list_facts' tool with category='${category}' to view this fact, or 'export_memory' to export all facts to a readable file.`
        }
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleListFacts(args: unknown): Promise<StandardResponse> {
  const parseResult = ListFactsInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { agent_id, category, limit } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.listFacts(agent_id, category, limit);
    // Result is already in StandardResponse format from MCP client
    return result as StandardResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleDeleteFact(args: unknown): Promise<StandardResponse> {
  const parseResult = DeleteFactInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { fact_id } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.deleteFact(fact_id);
    // Result is already in StandardResponse format from MCP client
    return result as StandardResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleStoreConversation(args: unknown): Promise<StandardResponse> {
  const parseResult = StoreConversationInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { agent_id, session_id, user_message, agent_response, tags } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.storeConversation(
      user_message,
      agent_response,
      agent_id,
      session_id,
      tags
    );
    // Result is already in StandardResponse format from MCP client
    return result as StandardResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleSearchConversations(args: unknown): Promise<StandardResponse> {
  const parseResult = SearchConversationsInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { agent_id, query, limit, date_from, date_to } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.searchConversations(query, agent_id, limit, date_from, date_to);
    // Result is already in StandardResponse format from MCP client
    return result as StandardResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleGetProfile(args: unknown): Promise<StandardResponse> {
  const parseResult = GetProfileInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { agent_id } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.getProfile(agent_id);
    // Result is already in StandardResponse format from MCP client
    return result as StandardResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleUpdateProfile(args: unknown): Promise<StandardResponse> {
  const parseResult = UpdateProfileInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { agent_id, updates, reason } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.updateProfile(updates, agent_id, reason);
    // Result is already in StandardResponse format from MCP client
    return result as StandardResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleRetrieveMemories(args: unknown): Promise<StandardResponse> {
  const parseResult = RetrieveMemoriesInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { agent_id, query, limit, include_conversations } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.retrieveMemories(query, agent_id, limit, include_conversations);
    // Result is already in StandardResponse format from MCP client
    return result as StandardResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleGetMemoryStats(args: unknown): Promise<StandardResponse> {
  const parseResult = GetMemoryStatsInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { agent_id } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.getMemoryStats(agent_id);
    // Result is already in StandardResponse format from MCP client
    return result as StandardResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleExportMemory(args: unknown): Promise<StandardResponse> {
  const parseResult = ExportMemoryInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { agent_id, format, include_conversations } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.exportMemory(agent_id, format, include_conversations);
    // Result is already in StandardResponse format from MCP client
    return result as StandardResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleImportMemory(args: unknown): Promise<StandardResponse> {
  const parseResult = ImportMemoryInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { agent_id, file_path } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.importMemory(file_path, agent_id);
    // Result is already in StandardResponse format from MCP client
    return result as StandardResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Export all definitions
export const memoryToolDefinitions = [
  storeFactToolDefinition,
  listFactsToolDefinition,
  deleteFactToolDefinition,
  storeConversationToolDefinition,
  searchConversationsToolDefinition,
  getProfileToolDefinition,
  updateProfileToolDefinition,
  retrieveMemoriesToolDefinition,
  getMemoryStatsToolDefinition,
  exportMemoryToolDefinition,
  importMemoryToolDefinition,
];
