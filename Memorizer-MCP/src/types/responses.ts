// ============================================================================
// Facts Tool Response Types
// ============================================================================

export interface StoreFactData {
  fact_id: number;
  stored_at: string;
  message?: string;
  similar_existing?: Array<{ id: number; fact: string }>;
}

export interface UpdateFactData {
  fact_id: number;
  old_fact: string;
  new_fact: string;
  category: string;
}

export interface ListFactsData {
  facts: Array<{
    id: number;
    fact: string;
    category: string;
    confidence: number;
    source: string | null;
    created_at: string;
  }>;
  total_count: number;
}

export interface DeleteFactData {
  deleted_fact: string;
}

// ============================================================================
// Conversations Tool Response Types
// ============================================================================

export interface StoreConversationData {
  conversation_id: string;
  facts_extracted: number;
  stored_at: string;
}

export interface SearchConversationsData {
  conversations: Array<{
    id: string;
    session_id: string | null;
    user_message: string;
    agent_response: string;
    tags: string[] | null;
    created_at: string;
  }>;
  total_count: number;
}

// ============================================================================
// Profiles Tool Response Types
// ============================================================================

export interface GetProfileData {
  profile: Record<string, unknown>;
  last_updated: string | null;
}

export interface UpdateProfileData {
  updated_fields: string[];
}

// ============================================================================
// Memory Tool Response Types
// ============================================================================

export interface RetrieveMemoriesData {
  facts: Array<{
    id: number;
    fact: string;
    category: string;
    confidence: number;
    created_at: string;
  }>;
  conversations: Array<{
    id: string;
    user_message: string;
    agent_response: string;
    created_at: string;
  }>;
}

// ============================================================================
// Stats Tool Response Types
// ============================================================================

export interface MemoryStatsData {
  fact_count: number;
  conversation_count: number;
  oldest_conversation: string | null;
  newest_conversation: string | null;
  facts_by_category: Record<string, number>;
  database_size_mb: number;
}

// ============================================================================
// Export/Import Tool Response Types
// ============================================================================

export interface ExportMemoryData {
  export_path: string;
  files_created: number;
  exported_at: string;
}

export interface ImportMemoryData {
  changes_applied: number;
  fields_updated: string[];
}

// ============================================================================
// Skills Tool Response Types
// ============================================================================

export interface StoreSkillData {
  skill_id: number;
  stored_at: string;
  message?: string;
}

export interface ListSkillsData {
  skills: Array<{
    id: number;
    name: string;
    description: string | null;
    enabled: boolean;
    trigger_type: string;
    trigger_config: unknown;
    instructions: string;
    required_tools: string[];
    max_steps: number;
    notify_on_completion: boolean;
    last_run_at: string | null;
    last_run_status: string | null;
    last_run_summary: string | null;
    created_at: string;
    updated_at: string;
  }>;
  total_count: number;
}

export interface GetSkillData {
  skill: {
    id: number;
    name: string;
    description: string | null;
    enabled: boolean;
    trigger_type: string;
    trigger_config: unknown;
    instructions: string;
    required_tools: string[];
    max_steps: number;
    notify_on_completion: boolean;
    last_run_at: string | null;
    last_run_status: string | null;
    last_run_summary: string | null;
    created_at: string;
    updated_at: string;
  };
}

export interface UpdateSkillData {
  updated_fields: string[];
}

export interface DeleteSkillData {
  deleted_skill: string;
}

