// SQL schema definitions for the Memory MCP database

export const SCHEMA_SQL = `
-- Facts table: discrete learnings about the user
CREATE TABLE IF NOT EXISTS facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL DEFAULT 'main',
    fact TEXT NOT NULL,
    category TEXT NOT NULL,
    source TEXT,
    confidence REAL DEFAULT 1.0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_facts_agent ON facts(agent_id);
CREATE INDEX IF NOT EXISTS idx_facts_category ON facts(agent_id, category);

-- Conversations table: full interaction history
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL DEFAULT 'main',
    session_id TEXT,
    user_message TEXT NOT NULL,
    agent_response TEXT NOT NULL,
    tags TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_agent ON conversations(agent_id);
CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_conversations_date ON conversations(created_at);

-- Profiles table: structured user knowledge per agent
CREATE TABLE IF NOT EXISTS profiles (
    agent_id TEXT PRIMARY KEY,
    profile_data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Profile history table: for rollback capability
CREATE TABLE IF NOT EXISTS profile_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    profile_data TEXT NOT NULL,
    changed_at TEXT DEFAULT (datetime('now')),
    change_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_profile_history_agent ON profile_history(agent_id);

-- Skills table: autonomous behavior definitions
CREATE TABLE IF NOT EXISTS skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL DEFAULT 'main',
    name TEXT NOT NULL,
    description TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    trigger_type TEXT NOT NULL,
    trigger_config TEXT,
    instructions TEXT NOT NULL,
    required_tools TEXT,
    max_steps INTEGER DEFAULT 10,
    notify_on_completion INTEGER DEFAULT 1,
    last_run_at TEXT,
    last_run_status TEXT,
    last_run_summary TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_skills_agent ON skills(agent_id);
CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills(agent_id, enabled);
`;

// Fact categories as defined in the spec
export const FACT_CATEGORIES = [
  'preference',
  'background',
  'pattern',
  'project',
  'contact',
  'decision',
] as const;

export type FactCategory = typeof FACT_CATEGORIES[number];

// TypeScript interfaces for database rows
export interface FactRow {
  id: number;
  agent_id: string;
  fact: string;
  category: string;
  source: string | null;
  confidence: number;
  created_at: string;
  updated_at: string;
}

export interface ConversationRow {
  id: string;
  agent_id: string;
  session_id: string | null;
  user_message: string;
  agent_response: string;
  tags: string | null;
  created_at: string;
}

export interface ProfileRow {
  agent_id: string;
  profile_data: string;
  created_at: string;
  updated_at: string;
}

export interface ProfileHistoryRow {
  id: number;
  agent_id: string;
  profile_data: string;
  changed_at: string;
  change_reason: string | null;
}

export const TRIGGER_TYPES = ['cron', 'manual', 'event'] as const;
export type TriggerType = typeof TRIGGER_TYPES[number];

export interface SkillRow {
  id: number;
  agent_id: string;
  name: string;
  description: string | null;
  enabled: number;
  trigger_type: string;
  trigger_config: string | null;
  instructions: string;
  required_tools: string | null;
  max_steps: number;
  notify_on_completion: number;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_summary: string | null;
  created_at: string;
  updated_at: string;
}
