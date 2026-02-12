/**
 * Memorizer MCP Server
 * Provides memory storage and retrieval tools (facts, conversations, profiles, skills)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool } from '@mcp/shared/Utils/register-tool.js';
import { getDatabase } from './db/index.js';
import {
  // Tool definitions (for descriptions)
  storeFactToolDefinition,
  listFactsToolDefinition,
  deleteFactToolDefinition,
  updateFactToolDefinition,
  storeConversationToolDefinition,
  searchConversationsToolDefinition,
  getProfileToolDefinition,
  updateProfileToolDefinition,
  retrieveMemoriesToolDefinition,
  getMemoryStatsToolDefinition,
  exportMemoryToolDefinition,
  importMemoryToolDefinition,
  storeSkillToolDefinition,
  listSkillsToolDefinition,
  getSkillToolDefinition,
  updateSkillToolDefinition,
  deleteSkillToolDefinition,
  // Zod input schemas
  StoreFactInputSchema,
  ListFactsInputSchema,
  DeleteFactInputSchema,
  UpdateFactInputSchema,
  StoreConversationInputSchema,
  SearchConversationsInputSchema,
  GetProfileInputSchema,
  UpdateProfileInputSchema,
  RetrieveMemoriesInputSchema,
  GetMemoryStatsInputSchema,
  ExportMemoryInputSchema,
  ImportMemoryInputSchema,
  StoreSkillInputSchema,
  ListSkillsInputSchema,
  GetSkillInputSchema,
  UpdateSkillInputSchema,
  DeleteSkillInputSchema,
  // Handlers
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
  backfillExtractFactsToolDefinition,
  BackfillExtractFactsInputSchema,
  handleBackfillExtractFacts,
  synthesizeFactsToolDefinition,
  SynthesizeFactsInputSchema,
  handleSynthesizeFacts,
  backfillEmbeddingsToolDefinition,
  BackfillEmbeddingsInputSchema,
  handleBackfillEmbeddings,
  createContactToolDefinition,
  listContactsToolDefinition,
  updateContactToolDefinition,
  CreateContactInputSchema,
  ListContactsInputSchema,
  UpdateContactInputSchema,
  handleCreateContact,
  handleListContacts,
  handleUpdateContact,
  createProjectToolDefinition,
  listProjectsToolDefinition,
  updateProjectToolDefinition,
  CreateProjectInputSchema,
  ListProjectsInputSchema,
  UpdateProjectInputSchema,
  handleCreateProject,
  handleListProjects,
  handleUpdateProject,
  queryTimelineToolDefinition,
  QueryTimelineInputSchema,
  handleQueryTimeline,
} from './tools/index.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'annabelle-memory-mcp',
    version: '1.0.0',
  });

  // Facts
  registerTool(server, {
    name: 'store_fact',
    description: storeFactToolDefinition.description,
    inputSchema: StoreFactInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    handler: async (params) => handleStoreFact(params),
  });

  registerTool(server, {
    name: 'list_facts',
    description: listFactsToolDefinition.description,
    inputSchema: ListFactsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    handler: async (params) => handleListFacts(params),
  });

  registerTool(server, {
    name: 'delete_fact',
    description: deleteFactToolDefinition.description,
    inputSchema: DeleteFactInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    handler: async (params) => handleDeleteFact(params),
  });

  registerTool(server, {
    name: 'update_fact',
    description: updateFactToolDefinition.description,
    inputSchema: UpdateFactInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    handler: async (params) => handleUpdateFact(params),
  });

  // Conversations
  registerTool(server, {
    name: 'store_conversation',
    description: storeConversationToolDefinition.description,
    inputSchema: StoreConversationInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    handler: async (params) => handleStoreConversation(params),
  });

  registerTool(server, {
    name: 'search_conversations',
    description: searchConversationsToolDefinition.description,
    inputSchema: SearchConversationsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    handler: async (params) => handleSearchConversations(params),
  });

  // Profiles
  registerTool(server, {
    name: 'get_profile',
    description: getProfileToolDefinition.description,
    inputSchema: GetProfileInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    handler: async (params) => handleGetProfile(params),
  });

  registerTool(server, {
    name: 'update_profile',
    description: updateProfileToolDefinition.description,
    inputSchema: UpdateProfileInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    handler: async (params) => handleUpdateProfile(params),
  });

  // Memory
  registerTool(server, {
    name: 'retrieve_memories',
    description: retrieveMemoriesToolDefinition.description,
    inputSchema: RetrieveMemoriesInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    handler: async (params) => handleRetrieveMemories(params),
  });

  // Stats
  registerTool(server, {
    name: 'get_memory_stats',
    description: getMemoryStatsToolDefinition.description,
    inputSchema: GetMemoryStatsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    handler: async (params) => handleGetMemoryStats(params),
  });

  // Export/Import
  registerTool(server, {
    name: 'export_memory',
    description: exportMemoryToolDefinition.description,
    inputSchema: ExportMemoryInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    handler: async (params) => handleExportMemory(params),
  });

  registerTool(server, {
    name: 'import_memory',
    description: importMemoryToolDefinition.description,
    inputSchema: ImportMemoryInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    handler: async (params) => handleImportMemory(params),
  });

  // Skills
  registerTool(server, {
    name: 'store_skill',
    description: storeSkillToolDefinition.description,
    inputSchema: StoreSkillInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    handler: async (params) => handleStoreSkill(params),
  });

  registerTool(server, {
    name: 'list_skills',
    description: listSkillsToolDefinition.description,
    inputSchema: ListSkillsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    handler: async (params) => handleListSkills(params),
  });

  registerTool(server, {
    name: 'get_skill',
    description: getSkillToolDefinition.description,
    inputSchema: GetSkillInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    handler: async (params) => handleGetSkill(params),
  });

  registerTool(server, {
    name: 'update_skill',
    description: updateSkillToolDefinition.description,
    inputSchema: UpdateSkillInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    handler: async (params) => handleUpdateSkill(params),
  });

  registerTool(server, {
    name: 'delete_skill',
    description: deleteSkillToolDefinition.description,
    inputSchema: DeleteSkillInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    handler: async (params) => handleDeleteSkill(params),
  });

  // Backfill & Synthesis
  registerTool(server, {
    name: 'backfill_extract_facts',
    description: backfillExtractFactsToolDefinition.description,
    inputSchema: BackfillExtractFactsInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    handler: async (params) => handleBackfillExtractFacts(params),
  });

  registerTool(server, {
    name: 'synthesize_facts',
    description: synthesizeFactsToolDefinition.description,
    inputSchema: SynthesizeFactsInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    handler: async (params) => handleSynthesizeFacts(params),
  });

  // Embeddings
  registerTool(server, {
    name: 'backfill_embeddings',
    description: backfillEmbeddingsToolDefinition.description,
    inputSchema: BackfillEmbeddingsInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    handler: async (params) => handleBackfillEmbeddings(params),
  });

  // Contacts
  registerTool(server, {
    name: 'create_contact',
    description: createContactToolDefinition.description,
    inputSchema: CreateContactInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    handler: async (params) => handleCreateContact(params),
  });

  registerTool(server, {
    name: 'list_contacts',
    description: listContactsToolDefinition.description,
    inputSchema: ListContactsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    handler: async (params) => handleListContacts(params),
  });

  registerTool(server, {
    name: 'update_contact',
    description: updateContactToolDefinition.description,
    inputSchema: UpdateContactInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    handler: async (params) => handleUpdateContact(params),
  });

  // Projects
  registerTool(server, {
    name: 'create_project',
    description: createProjectToolDefinition.description,
    inputSchema: CreateProjectInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    handler: async (params) => handleCreateProject(params),
  });

  registerTool(server, {
    name: 'list_projects',
    description: listProjectsToolDefinition.description,
    inputSchema: ListProjectsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    handler: async (params) => handleListProjects(params),
  });

  registerTool(server, {
    name: 'update_project',
    description: updateProjectToolDefinition.description,
    inputSchema: UpdateProjectInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    handler: async (params) => handleUpdateProject(params),
  });

  // Timeline
  registerTool(server, {
    name: 'query_timeline',
    description: queryTimelineToolDefinition.description,
    inputSchema: QueryTimelineInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    handler: async (params) => handleQueryTimeline(params),
  });

  return server;
}

export async function initializeServer(): Promise<McpServer> {
  // Initialize the database first
  getDatabase();

  // Create and return the server
  return createServer();
}
