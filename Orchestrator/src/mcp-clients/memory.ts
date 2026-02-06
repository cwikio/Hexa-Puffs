import { z } from 'zod';
import { BaseMCPClient } from './base.js';
import { type MCPServerConfig } from '../config/index.js';

// Fact categories matching Memorizer
export const FACT_CATEGORIES = [
  'preference',
  'background',
  'pattern',
  'project',
  'contact',
  'decision',
] as const;

export type FactCategory = (typeof FACT_CATEGORIES)[number];

// Response schemas
const StoreFactResponseSchema = z.object({
  success: z.boolean(),
  fact_id: z.number().optional(),
  message: z.string().optional(),
  stored_at: z.string().optional(),
  error: z.string().optional(),
});

const ListFactsResponseSchema = z.object({
  success: z.boolean(),
  facts: z.array(z.object({
    id: z.number(),
    fact: z.string(),
    category: z.string(),
    confidence: z.number().optional(),
    source: z.string().nullable().optional(),
    created_at: z.string(),
  })).optional(),
  total_count: z.number().optional(),
  error: z.string().optional(),
});

const DeleteFactResponseSchema = z.object({
  success: z.boolean(),
  deleted_fact: z.string().optional(),
  error: z.string().optional(),
});

const StoreConversationResponseSchema = z.object({
  success: z.boolean(),
  conversation_id: z.string().optional(),
  facts_extracted: z.number().optional(),
  stored_at: z.string().optional(),
  error: z.string().optional(),
});

const SearchConversationsResponseSchema = z.object({
  success: z.boolean(),
  conversations: z.array(z.object({
    id: z.string(),
    session_id: z.string().nullable().optional(),
    user_message: z.string(),
    agent_response: z.string(),
    tags: z.array(z.string()).nullable().optional(),
    created_at: z.string(),
  })).optional(),
  total_count: z.number().optional(),
  error: z.string().optional(),
});

const GetProfileResponseSchema = z.object({
  success: z.boolean(),
  profile: z.record(z.unknown()).optional(),
  last_updated: z.string().nullable().optional(),
  error: z.string().optional(),
});

const UpdateProfileResponseSchema = z.object({
  success: z.boolean(),
  updated_fields: z.array(z.string()).optional(),
  error: z.string().optional(),
});

const RetrieveMemoriesResponseSchema = z.object({
  success: z.boolean(),
  facts: z.array(z.object({
    id: z.number(),
    fact: z.string(),
    category: z.string(),
    confidence: z.number().optional(),
    created_at: z.string(),
  })).optional(),
  conversations: z.array(z.object({
    id: z.string(),
    user_message: z.string(),
    agent_response: z.string(),
    created_at: z.string(),
  })).optional(),
  error: z.string().optional(),
});

const GetMemoryStatsResponseSchema = z.object({
  success: z.boolean(),
  fact_count: z.number().optional(),
  conversation_count: z.number().optional(),
  oldest_conversation: z.string().nullable().optional(),
  newest_conversation: z.string().nullable().optional(),
  facts_by_category: z.record(z.number()).optional(),
  database_size_mb: z.number().optional(),
  error: z.string().optional(),
});

const ExportMemoryResponseSchema = z.object({
  success: z.boolean(),
  export_path: z.string().optional(),
  files_created: z.number().optional(),
  exported_at: z.string().optional(),
  error: z.string().optional(),
});

const ImportMemoryResponseSchema = z.object({
  success: z.boolean(),
  changes_applied: z.number().optional(),
  fields_updated: z.array(z.string()).optional(),
  error: z.string().optional(),
});

// Result types
export type StoreFactResult = z.infer<typeof StoreFactResponseSchema>;
export type ListFactsResult = z.infer<typeof ListFactsResponseSchema>;
export type DeleteFactResult = z.infer<typeof DeleteFactResponseSchema>;
export type StoreConversationResult = z.infer<typeof StoreConversationResponseSchema>;
export type SearchConversationsResult = z.infer<typeof SearchConversationsResponseSchema>;
export type GetProfileResult = z.infer<typeof GetProfileResponseSchema>;
export type UpdateProfileResult = z.infer<typeof UpdateProfileResponseSchema>;
export type RetrieveMemoriesResult = z.infer<typeof RetrieveMemoriesResponseSchema>;
export type GetMemoryStatsResult = z.infer<typeof GetMemoryStatsResponseSchema>;
export type ExportMemoryResult = z.infer<typeof ExportMemoryResponseSchema>;
export type ImportMemoryResult = z.infer<typeof ImportMemoryResponseSchema>;

export class MemoryMCPClient extends BaseMCPClient {
  constructor(config: MCPServerConfig) {
    super('memory', config);
  }

  // Facts operations
  async storeFact(
    fact: string,
    category: FactCategory,
    agentId: string = 'main',
    source?: string
  ): Promise<StoreFactResult> {
    const args: Record<string, unknown> = {
      agent_id: agentId,
      fact,
      category,
    };
    if (source) {
      args.source = source;
    }

    const result = await this.callTool({
      name: 'store_fact',
      arguments: args,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const parsed = this.parseTextResponse(result);
    const validated = StoreFactResponseSchema.safeParse(parsed);
    if (!validated.success) {
      this.logger.warn('Failed to validate store_fact response', { errors: validated.error.flatten() });
      return { success: true };
    }

    return validated.data;
  }

  async listFacts(
    agentId: string = 'main',
    category?: FactCategory,
    limit: number = 50
  ): Promise<ListFactsResult> {
    const args: Record<string, unknown> = {
      agent_id: agentId,
      limit,
    };
    if (category) {
      args.category = category;
    }

    const result = await this.callTool({
      name: 'list_facts',
      arguments: args,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const parsed = this.parseTextResponse(result);
    const validated = ListFactsResponseSchema.safeParse(parsed);
    if (!validated.success) {
      this.logger.warn('Failed to validate list_facts response', { errors: validated.error.flatten() });
      return { success: false, error: 'Failed to parse response' };
    }

    return validated.data;
  }

  async deleteFact(factId: number): Promise<DeleteFactResult> {
    const result = await this.callTool({
      name: 'delete_fact',
      arguments: { fact_id: factId },
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const parsed = this.parseTextResponse(result);
    const validated = DeleteFactResponseSchema.safeParse(parsed);
    if (!validated.success) {
      this.logger.warn('Failed to validate delete_fact response', { errors: validated.error.flatten() });
      return { success: true };
    }

    return validated.data;
  }

  // Conversation operations
  async storeConversation(
    userMessage: string,
    agentResponse: string,
    agentId: string = 'main',
    sessionId?: string,
    tags?: string[]
  ): Promise<StoreConversationResult> {
    const args: Record<string, unknown> = {
      agent_id: agentId,
      user_message: userMessage,
      agent_response: agentResponse,
    };
    if (sessionId) {
      args.session_id = sessionId;
    }
    if (tags) {
      args.tags = tags;
    }

    const result = await this.callTool({
      name: 'store_conversation',
      arguments: args,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const parsed = this.parseTextResponse(result);
    const validated = StoreConversationResponseSchema.safeParse(parsed);
    if (!validated.success) {
      this.logger.warn('Failed to validate store_conversation response', { errors: validated.error.flatten() });
      return { success: true };
    }

    return validated.data;
  }

  async searchConversations(
    query: string,
    agentId: string = 'main',
    limit: number = 10,
    dateFrom?: string,
    dateTo?: string
  ): Promise<SearchConversationsResult> {
    const args: Record<string, unknown> = {
      agent_id: agentId,
      query,
      limit,
    };
    if (dateFrom) {
      args.date_from = dateFrom;
    }
    if (dateTo) {
      args.date_to = dateTo;
    }

    const result = await this.callTool({
      name: 'search_conversations',
      arguments: args,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const parsed = this.parseTextResponse(result);
    const validated = SearchConversationsResponseSchema.safeParse(parsed);
    if (!validated.success) {
      this.logger.warn('Failed to validate search_conversations response', { errors: validated.error.flatten() });
      return { success: false, error: 'Failed to parse response' };
    }

    return validated.data;
  }

  // Profile operations
  async getProfile(agentId: string = 'main'): Promise<GetProfileResult> {
    const result = await this.callTool({
      name: 'get_profile',
      arguments: { agent_id: agentId },
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const parsed = this.parseTextResponse(result);
    const validated = GetProfileResponseSchema.safeParse(parsed);
    if (!validated.success) {
      this.logger.warn('Failed to validate get_profile response', { errors: validated.error.flatten() });
      return { success: false, error: 'Failed to parse response' };
    }

    return validated.data;
  }

  async updateProfile(
    updates: Record<string, unknown>,
    agentId: string = 'main',
    reason?: string
  ): Promise<UpdateProfileResult> {
    const args: Record<string, unknown> = {
      agent_id: agentId,
      updates,
    };
    if (reason) {
      args.reason = reason;
    }

    const result = await this.callTool({
      name: 'update_profile',
      arguments: args,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const parsed = this.parseTextResponse(result);
    const validated = UpdateProfileResponseSchema.safeParse(parsed);
    if (!validated.success) {
      this.logger.warn('Failed to validate update_profile response', { errors: validated.error.flatten() });
      return { success: true };
    }

    return validated.data;
  }

  // Memory retrieval
  async retrieveMemories(
    query: string,
    agentId: string = 'main',
    limit: number = 5,
    includeConversations: boolean = true
  ): Promise<RetrieveMemoriesResult> {
    const result = await this.callTool({
      name: 'retrieve_memories',
      arguments: {
        agent_id: agentId,
        query,
        limit,
        include_conversations: includeConversations,
      },
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const parsed = this.parseTextResponse(result);
    const validated = RetrieveMemoriesResponseSchema.safeParse(parsed);
    if (!validated.success) {
      this.logger.warn('Failed to validate retrieve_memories response', { errors: validated.error.flatten() });
      return { success: false, error: 'Failed to parse response' };
    }

    return validated.data;
  }

  // Stats
  async getMemoryStats(agentId: string = 'main'): Promise<GetMemoryStatsResult> {
    const result = await this.callTool({
      name: 'get_memory_stats',
      arguments: { agent_id: agentId },
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const parsed = this.parseTextResponse(result);
    const validated = GetMemoryStatsResponseSchema.safeParse(parsed);
    if (!validated.success) {
      this.logger.warn('Failed to validate get_memory_stats response', { errors: validated.error.flatten() });
      return { success: false, error: 'Failed to parse response' };
    }

    return validated.data;
  }

  // Export/Import
  async exportMemory(
    agentId: string = 'main',
    format: 'markdown' | 'json' = 'markdown',
    includeConversations: boolean = true
  ): Promise<ExportMemoryResult> {
    const result = await this.callTool({
      name: 'export_memory',
      arguments: {
        agent_id: agentId,
        format,
        include_conversations: includeConversations,
      },
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const parsed = this.parseTextResponse(result);
    const validated = ExportMemoryResponseSchema.safeParse(parsed);
    if (!validated.success) {
      this.logger.warn('Failed to validate export_memory response', { errors: validated.error.flatten() });
      return { success: true };
    }

    return validated.data;
  }

  async importMemory(filePath: string, agentId: string = 'main'): Promise<ImportMemoryResult> {
    const result = await this.callTool({
      name: 'import_memory',
      arguments: {
        agent_id: agentId,
        file_path: filePath,
      },
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const parsed = this.parseTextResponse(result);
    const validated = ImportMemoryResponseSchema.safeParse(parsed);
    if (!validated.success) {
      this.logger.warn('Failed to validate import_memory response', { errors: validated.error.flatten() });
      return { success: true };
    }

    return validated.data;
  }
}
