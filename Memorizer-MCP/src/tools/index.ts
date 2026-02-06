// Export all tool definitions and handlers
export {
  storeFactToolDefinition,
  listFactsToolDefinition,
  deleteFactToolDefinition,
  handleStoreFact,
  handleListFacts,
  handleDeleteFact,
} from './facts.js';

export {
  storeConversationToolDefinition,
  searchConversationsToolDefinition,
  handleStoreConversation,
  handleSearchConversations,
} from './conversations.js';

export {
  getProfileToolDefinition,
  updateProfileToolDefinition,
  handleGetProfile,
  handleUpdateProfile,
} from './profiles.js';

export {
  retrieveMemoriesToolDefinition,
  handleRetrieveMemories,
} from './memory.js';

export {
  getMemoryStatsToolDefinition,
  handleGetMemoryStats,
} from './stats.js';

export {
  exportMemoryToolDefinition,
  importMemoryToolDefinition,
  handleExportMemory,
  handleImportMemory,
} from './export.js';

export {
  storeSkillToolDefinition,
  listSkillsToolDefinition,
  getSkillToolDefinition,
  updateSkillToolDefinition,
  deleteSkillToolDefinition,
  handleStoreSkill,
  handleListSkills,
  handleGetSkill,
  handleUpdateSkill,
  handleDeleteSkill,
} from './skills.js';

// Import all definitions for convenience
import { storeFactToolDefinition, listFactsToolDefinition, deleteFactToolDefinition } from './facts.js';
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
