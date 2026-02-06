import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { getConfig } from '../config/index.js';
import { DatabaseError } from '../utils/errors.js';
import { logger } from '../../../Shared/Utils/logger.js';
import { SCHEMA_SQL, MIGRATIONS_SQL } from './schema.js';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    const config = getConfig();
    const dbPath = config.database.path;

    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      logger.info('Created database directory', { path: dir });
    }

    try {
      db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');

      // Initialize schema
      db.exec(SCHEMA_SQL);

      // Run migrations for existing databases (idempotent)
      for (const stmt of MIGRATIONS_SQL.split(';').map(s => s.trim()).filter(Boolean)) {
        try {
          db.exec(stmt);
        } catch {
          // Column likely already exists — safe to ignore
        }
      }

      logger.info('Database initialized', { path: dbPath });
    } catch (error) {
      throw new DatabaseError(
        `Failed to initialize database: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { path: dbPath, error }
      );
    }
  }

  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('Database closed');
  }
}

// Utility function to generate UUIDs for conversation IDs
export function generateId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export {
  type FactRow,
  type ConversationRow,
  type ProfileRow,
  type ProfileHistoryRow,
  type SkillRow,
  FACT_CATEGORIES,
  type FactCategory,
  TRIGGER_TYPES,
  type TriggerType,
} from './schema.js';
