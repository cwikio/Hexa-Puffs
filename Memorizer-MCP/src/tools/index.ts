// Export all tool definitions, handlers, and Zod input schemas
export {
  storeFactToolDefinition,
  listFactsToolDefinition,
  deleteFactToolDefinition,
  updateFactToolDefinition,
  StoreFactInputSchema,
  ListFactsInputSchema,
  DeleteFactInputSchema,
  UpdateFactInputSchema,
  handleStoreFact,
  handleListFacts,
  handleDeleteFact,
  handleUpdateFact,
} from './facts.js';

export {
  storeConversationToolDefinition,
  searchConversationsToolDefinition,
  StoreConversationInputSchema,
  SearchConversationsInputSchema,
  handleStoreConversation,
  handleSearchConversations,
} from './conversations.js';

export {
  getProfileToolDefinition,
  updateProfileToolDefinition,
  GetProfileInputSchema,
  UpdateProfileInputSchema,
  handleGetProfile,
  handleUpdateProfile,
} from './profiles.js';

export {
  retrieveMemoriesToolDefinition,
  RetrieveMemoriesInputSchema,
  handleRetrieveMemories,
} from './memory.js';

export {
  getMemoryStatsToolDefinition,
  GetMemoryStatsInputSchema,
  handleGetMemoryStats,
} from './stats.js';

export {
  exportMemoryToolDefinition,
  importMemoryToolDefinition,
  ExportMemoryInputSchema,
  ImportMemoryInputSchema,
  handleExportMemory,
  handleImportMemory,
} from './export.js';

export {
  storeSkillToolDefinition,
  listSkillsToolDefinition,
  getSkillToolDefinition,
  updateSkillToolDefinition,
  deleteSkillToolDefinition,
  StoreSkillInputSchema,
  ListSkillsInputSchema,
  GetSkillInputSchema,
  UpdateSkillInputSchema,
  DeleteSkillInputSchema,
  handleStoreSkill,
  handleListSkills,
  handleGetSkill,
  handleUpdateSkill,
  handleDeleteSkill,
} from './skills.js';

// Import all definitions for convenience
import { storeFactToolDefinition, listFactsToolDefinition, deleteFactToolDefinition, updateFactToolDefinition } from './facts.js';
import { storeConversationToolDefinition, searchConversationsToolDefinition } from './conversations.js';
import { getProfileToolDefinition, updateProfileToolDefinition } from './profiles.js';
import { retrieveMemoriesToolDefinition } from './memory.js';
import { getMemoryStatsToolDefinition } from './stats.js';
import { exportMemoryToolDefinition, importMemoryToolDefinition } from './export.js';
import {
  storeSkillToolDefinition,
  listSkillsToolDefinition,
  getSkillToolDefinition,
  updateSkillToolDefinition,
  deleteSkillToolDefinition,
} from './skills.js';

export const allToolDefinitions = [
  // Facts
  storeFactToolDefinition,
  listFactsToolDefinition,
  deleteFactToolDefinition,
  updateFactToolDefinition,
  // Conversations
  storeConversationToolDefinition,
  searchConversationsToolDefinition,
  // Profiles
  getProfileToolDefinition,
  updateProfileToolDefinition,
  // Memory
  retrieveMemoriesToolDefinition,
  // Stats
  getMemoryStatsToolDefinition,
  // Export/Import
  exportMemoryToolDefinition,
  importMemoryToolDefinition,
  // Skills
  storeSkillToolDefinition,
  listSkillsToolDefinition,
  getSkillToolDefinition,
  updateSkillToolDefinition,
  deleteSkillToolDefinition,
];
