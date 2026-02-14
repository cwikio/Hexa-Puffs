import { logger } from '@mcp/shared/Utils/logger.js';

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
    updated_at TEXT DEFAULT (datetime('now')),
    last_accessed_at TEXT DEFAULT (datetime('now'))
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

-- Contacts table: people the user works with
CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL DEFAULT 'main',
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    company TEXT,
    role TEXT,
    type TEXT NOT NULL DEFAULT 'work',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contacts_agent ON contacts(agent_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(agent_id, email);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(agent_id, company);

-- Projects table: things the user works on
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL DEFAULT 'main',
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    type TEXT NOT NULL DEFAULT 'work',
    description TEXT,
    primary_contact_id INTEGER,
    participants TEXT,
    company TEXT,
    priority TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (primary_contact_id) REFERENCES contacts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_agent ON projects(agent_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_contact ON projects(primary_contact_id);
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
  last_accessed_at: string;
}

/**
 * Migrations for existing databases that may not have newer columns.
 * Each migration is idempotent (checks before altering).
 */
export const MIGRATIONS_SQL = `
-- Add last_accessed_at column if missing (added in memory consolidation update)
-- Note: ALTER TABLE ADD COLUMN requires a constant default in SQLite, so use NULL here.
-- The CREATE TABLE schema uses datetime('now') for new databases. Existing rows get NULL.
ALTER TABLE facts ADD COLUMN last_accessed_at TEXT DEFAULT NULL;

-- Add execution_plan column for direct-tier skill execution (v3 tiered architecture)
ALTER TABLE skills ADD COLUMN execution_plan TEXT DEFAULT NULL;

-- Notification throttling: 0 = use global default, >0 = per-skill override in minutes
ALTER TABLE skills ADD COLUMN notify_interval_minutes INTEGER DEFAULT 0;

-- Tracks when the last Telegram notification was sent for this skill
ALTER TABLE skills ADD COLUMN last_notified_at TEXT DEFAULT NULL;
`;

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
  execution_plan: string | null;
  max_steps: number;
  notify_on_completion: number;
  notify_interval_minutes: number;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_summary: string | null;
  last_notified_at: string | null;
  created_at: string;
  updated_at: string;
}

// Contact types
export const CONTACT_TYPES = ['work', 'personal', 'ignored'] as const;
export type ContactType = typeof CONTACT_TYPES[number];

export interface ContactRow {
  id: number;
  agent_id: string;
  name: string;
  email: string;
  company: string | null;
  role: string | null;
  type: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Project types
export const PROJECT_STATUSES = ['active', 'paused', 'completed'] as const;
export type ProjectStatus = typeof PROJECT_STATUSES[number];

export const PROJECT_TYPES = ['work', 'personal'] as const;
export type ProjectType = typeof PROJECT_TYPES[number];

export const PROJECT_PRIORITIES = ['high', 'medium', 'low'] as const;
export type ProjectPriority = typeof PROJECT_PRIORITIES[number];

export interface ProjectRow {
  id: number;
  agent_id: string;
  name: string;
  status: string;
  type: string;
  description: string | null;
  primary_contact_id: number | null;
  participants: string | null;
  company: string | null;
  priority: string | null;
  created_at: string;
  updated_at: string;
}

// --- FTS5 + Vector Search Schema ---

/**
 * FTS5 full-text index on fact text.
 * Uses external content table (references facts, no data duplication).
 * Porter stemming for matching word variants ("running" → "run").
 */
export const FTS5_SCHEMA_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
    fact,
    content=facts,
    content_rowid=id,
    tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS facts_fts_ai AFTER INSERT ON facts BEGIN
    INSERT INTO facts_fts(rowid, fact) VALUES (new.id, new.fact);
END;

CREATE TRIGGER IF NOT EXISTS facts_fts_ad AFTER DELETE ON facts BEGIN
    INSERT INTO facts_fts(facts_fts, rowid, fact) VALUES('delete', old.id, old.fact);
END;

CREATE TRIGGER IF NOT EXISTS facts_fts_au AFTER UPDATE ON facts BEGIN
    INSERT INTO facts_fts(facts_fts, rowid, fact) VALUES('delete', old.id, old.fact);
    INSERT INTO facts_fts(rowid, fact) VALUES (new.id, new.fact);
END;
`;

/**
 * Set up FTS5 and vector search schemas.
 * Called during database initialization, after the base schema and migrations.
 * Idempotent — safe to call on every startup.
 */
export function setupVectorSchema(db: import('better-sqlite3').Database, dimensions: number, sqliteVecLoaded: boolean): void {

  // 1. Create FTS5 virtual table and triggers
  try {
    db.exec(FTS5_SCHEMA_SQL);
    logger.info('FTS5 schema initialized');
  } catch (error) {
    logger.warn('Failed to create FTS5 tables', { error });
  }

  // 2. Create vec0 virtual table for vector search (only if sqlite-vec is loaded)
  if (sqliteVecLoaded) {
    try {
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_facts USING vec0(embedding float[${dimensions}])`);
      logger.info('vec_facts table initialized', { dimensions });
    } catch (error) {
      logger.warn('Failed to create vec_facts table', { error });
    }
  }

  // 3. Rebuild FTS5 index from content table on every startup.
  //    This is more reliable than incremental backfill and fixes
  //    SQLITE_CORRUPT_VTAB when the external content table is out of sync.
  try {
    db.exec("INSERT INTO facts_fts(facts_fts) VALUES('rebuild')");
    logger.info('FTS5 index rebuilt');
  } catch (error) {
    logger.warn('FTS5 rebuild failed', { error });
  }
}
