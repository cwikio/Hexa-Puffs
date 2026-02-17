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

export {
  backfillExtractFactsToolDefinition,
  BackfillExtractFactsInputSchema,
  handleBackfillExtractFacts,
} from './backfill.js';

export {
  synthesizeFactsToolDefinition,
  SynthesizeFactsInputSchema,
  handleSynthesizeFacts,
} from './synthesis.js';

export {
  backfillEmbeddingsToolDefinition,
  BackfillEmbeddingsInputSchema,
  handleBackfillEmbeddings,
} from './backfill-embeddings.js';

export {
  createContactToolDefinition,
  listContactsToolDefinition,
  updateContactToolDefinition,
  CreateContactInputSchema,
  ListContactsInputSchema,
  UpdateContactInputSchema,
  handleCreateContact,
  handleListContacts,
  handleUpdateContact,
} from './contacts.js';

export {
  createProjectToolDefinition,
  listProjectsToolDefinition,
  updateProjectToolDefinition,
  CreateProjectInputSchema,
  ListProjectsInputSchema,
  UpdateProjectInputSchema,
  handleCreateProject,
  handleListProjects,
  handleUpdateProject,
} from './projects.js';

export {
  queryTimelineToolDefinition,
  QueryTimelineInputSchema,
  handleQueryTimeline,
} from './timeline.js';

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
import { backfillExtractFactsToolDefinition } from './backfill.js';
import { synthesizeFactsToolDefinition } from './synthesis.js';
import { backfillEmbeddingsToolDefinition } from './backfill-embeddings.js';
import { createContactToolDefinition, listContactsToolDefinition, updateContactToolDefinition } from './contacts.js';
import { createProjectToolDefinition, listProjectsToolDefinition, updateProjectToolDefinition } from './projects.js';
import { queryTimelineToolDefinition } from './timeline.js';

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
  // Backfill & Synthesis
  backfillExtractFactsToolDefinition,
  synthesizeFactsToolDefinition,
  // Embeddings
  backfillEmbeddingsToolDefinition,
  // Contacts
  createContactToolDefinition,
  listContactsToolDefinition,
  updateContactToolDefinition,
  // Projects
  createProjectToolDefinition,
  listProjectsToolDefinition,
  updateProjectToolDefinition,
  // Timeline
  queryTimelineToolDefinition,
];
