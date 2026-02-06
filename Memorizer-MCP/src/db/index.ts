import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'node:crypto';
import { getConfig } from '../config/index.js';
import { DatabaseError } from '../utils/errors.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import { SCHEMA_SQL, MIGRATIONS_SQL, setupVectorSchema } from './schema.js';
import * as sqliteVec from 'sqlite-vec';

let db: Database.Database | null = null;
let vecLoaded = false;

/** Whether the sqlite-vec extension loaded successfully at startup. */
export function isSqliteVecLoaded(): boolean {
  return vecLoaded;
}

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
      db.pragma('busy_timeout = 5000');
      db.pragma('foreign_keys = ON');

      // Load sqlite-vec extension for vector search
      try {
        sqliteVec.load(db);
        vecLoaded = true;
        logger.info('sqlite-vec extension loaded');
      } catch (error) {
        logger.warn('Failed to load sqlite-vec extension — vector search disabled', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Initialize schema
      db.exec(SCHEMA_SQL);

      // Run migrations for existing databases (idempotent)
      // Strip SQL comment lines before splitting — comments may contain semicolons
      const migrationSql = MIGRATIONS_SQL.replace(/^--.*$/gm, '');
      for (const stmt of migrationSql.split(';').map(s => s.trim()).filter(Boolean)) {
        try {
          db.exec(stmt);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (msg.includes('duplicate column name') || msg.includes('already exists')) {
            // Expected — column/table already exists from a previous migration
            continue;
          }
          throw new DatabaseError(`Migration failed: ${msg}`, { statement: stmt, error });
        }
      }

      // Set up FTS5 + vector search schema (idempotent)
      setupVectorSchema(db, config.embedding.dimensions, vecLoaded);

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
  return `conv_${randomUUID()}`;
}

export {
  type FactRow,
  type ConversationRow,
  type ProfileRow,
  type ProfileHistoryRow,
  type SkillRow,
  type ContactRow,
  type ProjectRow,
  FACT_CATEGORIES,
  type FactCategory,
  TRIGGER_TYPES,
  type TriggerType,
  CONTACT_TYPES,
  type ContactType,
  PROJECT_STATUSES,
  type ProjectStatus,
  PROJECT_TYPES,
  type ProjectType,
  PROJECT_PRIORITIES,
  type ProjectPriority,
} from './schema.js';
