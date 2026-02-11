/**
 * Database Helpers for Direct DB Access in Tests
 * Used for verification and cleanup that can't be done through MCP tools
 */

import Database from 'better-sqlite3';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { homedir } from 'os';

// Expand ~ to home directory
function expandPath(p: string): string {
  if (p.startsWith('~/')) {
    return p.replace('~', homedir());
  }
  return p;
}

// Default to the same path the server uses
const TEST_DB_PATH = process.env.DATABASE_PATH ?? expandPath('~/.annabelle/data/memory.db');

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
  tags: string;
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

export class DbHelper {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? TEST_DB_PATH;
  }

  private getDb(): Database.Database {
    if (!this.db) {
      // Ensure directory exists
      const dir = dirname(this.dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      this.db = new Database(this.dbPath);
    }
    return this.db;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // Facts operations
  getFactById(id: number): FactRow | undefined {
    return this.getDb().prepare('SELECT * FROM facts WHERE id = ?').get(id) as FactRow | undefined;
  }

  getFactsByAgent(agentId: string): FactRow[] {
    return this.getDb().prepare('SELECT * FROM facts WHERE agent_id = ?').all(agentId) as FactRow[];
  }

  countFacts(agentId?: string): number {
    if (agentId) {
      const result = this.getDb().prepare('SELECT COUNT(*) as count FROM facts WHERE agent_id = ?').get(agentId) as {
        count: number;
      };
      return result.count;
    }
    const result = this.getDb().prepare('SELECT COUNT(*) as count FROM facts').get() as { count: number };
    return result.count;
  }

  deleteFactsByAgent(agentId: string): number {
    const result = this.getDb().prepare('DELETE FROM facts WHERE agent_id = ?').run(agentId);
    return result.changes;
  }

  // Conversations operations
  getConversationById(id: string): ConversationRow | undefined {
    return this.getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined;
  }

  getConversationsByAgent(agentId: string): ConversationRow[] {
    return this.getDb().prepare('SELECT * FROM conversations WHERE agent_id = ?').all(agentId) as ConversationRow[];
  }

  countConversations(agentId?: string): number {
    if (agentId) {
      const result = this.getDb()
        .prepare('SELECT COUNT(*) as count FROM conversations WHERE agent_id = ?')
        .get(agentId) as { count: number };
      return result.count;
    }
    const result = this.getDb().prepare('SELECT COUNT(*) as count FROM conversations').get() as { count: number };
    return result.count;
  }

  deleteConversationsByAgent(agentId: string): number {
    const result = this.getDb().prepare('DELETE FROM conversations WHERE agent_id = ?').run(agentId);
    return result.changes;
  }

  // Profile operations
  getProfile(agentId: string): ProfileRow | undefined {
    return this.getDb().prepare('SELECT * FROM profiles WHERE agent_id = ?').get(agentId) as ProfileRow | undefined;
  }

  deleteProfile(agentId: string): boolean {
    const result = this.getDb().prepare('DELETE FROM profiles WHERE agent_id = ?').run(agentId);
    return result.changes > 0;
  }

  // Profile history operations
  getProfileHistory(agentId: string): ProfileHistoryRow[] {
    return this.getDb()
      .prepare('SELECT * FROM profile_history WHERE agent_id = ? ORDER BY changed_at DESC')
      .all(agentId) as ProfileHistoryRow[];
  }

  countProfileHistory(agentId: string): number {
    const result = this.getDb()
      .prepare('SELECT COUNT(*) as count FROM profile_history WHERE agent_id = ?')
      .get(agentId) as { count: number };
    return result.count;
  }

  deleteProfileHistory(agentId: string): number {
    const result = this.getDb().prepare('DELETE FROM profile_history WHERE agent_id = ?').run(agentId);
    return result.changes;
  }

  // Skills operations
  getSkillsByAgent(agentId: string): unknown[] {
    return this.getDb().prepare('SELECT * FROM skills WHERE agent_id = ?').all(agentId);
  }

  deleteSkillsByAgent(agentId: string): number {
    const result = this.getDb().prepare('DELETE FROM skills WHERE agent_id = ?').run(agentId);
    return result.changes;
  }

  // Contacts operations
  getContactsByAgent(agentId: string): unknown[] {
    return this.getDb().prepare('SELECT * FROM contacts WHERE agent_id = ?').all(agentId);
  }

  deleteContactsByAgent(agentId: string): number {
    const result = this.getDb().prepare('DELETE FROM contacts WHERE agent_id = ?').run(agentId);
    return result.changes;
  }

  // Projects operations
  getProjectsByAgent(agentId: string): unknown[] {
    return this.getDb().prepare('SELECT * FROM projects WHERE agent_id = ?').all(agentId);
  }

  deleteProjectsByAgent(agentId: string): number {
    const result = this.getDb().prepare('DELETE FROM projects WHERE agent_id = ?').run(agentId);
    return result.changes;
  }

  // Cleanup operations
  cleanupAgent(agentId: string): void {
    this.deleteProjectsByAgent(agentId);
    this.deleteContactsByAgent(agentId);
    this.deleteFactsByAgent(agentId);
    this.deleteConversationsByAgent(agentId);
    this.deleteProfileHistory(agentId);
    this.deleteProfile(agentId);
    this.deleteSkillsByAgent(agentId);
  }

  cleanupAllTestAgents(): void {
    // Delete all agents starting with 'test-'
    this.getDb().prepare("DELETE FROM facts WHERE agent_id LIKE 'test-%'").run();
    this.getDb().prepare("DELETE FROM conversations WHERE agent_id LIKE 'test-%'").run();
    this.getDb().prepare("DELETE FROM profile_history WHERE agent_id LIKE 'test-%'").run();
    this.getDb().prepare("DELETE FROM profiles WHERE agent_id LIKE 'test-%'").run();
    this.getDb().prepare("DELETE FROM projects WHERE agent_id LIKE 'test-%'").run();
    this.getDb().prepare("DELETE FROM contacts WHERE agent_id LIKE 'test-%'").run();
    this.getDb().prepare("DELETE FROM skills WHERE agent_id LIKE 'test-%'").run();
  }

  resetDatabase(): void {
    this.close();
    if (existsSync(this.dbPath)) {
      unlinkSync(this.dbPath);
    }
  }

  // Verification helpers
  verifyFactExists(id: string): boolean {
    return this.getFactById(id) !== undefined;
  }

  verifyConversationExists(id: string): boolean {
    return this.getConversationById(id) !== undefined;
  }

  verifyProfileExists(agentId: string): boolean {
    return this.getProfile(agentId) !== undefined;
  }

  // Get all table counts for debugging
  getTableCounts(): { facts: number; conversations: number; profiles: number; profile_history: number } {
    return {
      facts: this.countFacts(),
      conversations: this.countConversations(),
      profiles: (this.getDb().prepare('SELECT COUNT(*) as count FROM profiles').get() as { count: number }).count,
      profile_history: (
        this.getDb().prepare('SELECT COUNT(*) as count FROM profile_history').get() as { count: number }
      ).count,
    };
  }
}

// Shared instance for tests
export const dbHelper = new DbHelper();
