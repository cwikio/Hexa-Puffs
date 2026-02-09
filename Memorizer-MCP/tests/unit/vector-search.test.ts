/**
 * Unit tests for FTS5 and sqlite-vec in an in-memory database.
 * Verifies that the database schema works correctly for full-text
 * and vector search operations.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

const DIMENSIONS = 4; // Small dimensions for testing

let db: Database.Database;

/**
 * Insert a fact with an explicit ID and return it.
 */
function insertFact(
  id: number,
  fact: string,
  agentId = 'main',
  category = 'general',
  confidence = 1.0,
): number {
  db.prepare(
    `INSERT INTO facts (id, agent_id, fact, category, confidence)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, agentId, fact, category, confidence);
  return id;
}

/**
 * Insert a vector embedding for a fact.
 */
function insertVector(factId: number, vec: number[]): void {
  // sqlite-vec requires BigInt for rowid on INSERT
  db.prepare('INSERT INTO vec_facts(rowid, embedding) VALUES (?, ?)').run(
    BigInt(factId),
    Buffer.from(new Float32Array(vec).buffer),
  );
}

// Create a fresh database before each test
beforeEach(() => {
  if (db) db.close();

  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');

  // Load sqlite-vec
  sqliteVec.load(db);

  // Create base schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY,
      agent_id TEXT NOT NULL DEFAULT 'main',
      fact TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      confidence REAL DEFAULT 1.0,
      source TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      last_accessed_at TEXT
    );
  `);

  // Create FTS5 virtual table with triggers
  db.exec(`
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
  `);

  // Create vec_facts virtual table
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS vec_facts USING vec0(embedding float[${DIMENSIONS}])`,
  );
});

afterAll(() => {
  if (db) db.close();
});

describe('sqlite-vec', () => {
  it('should load and report version', () => {
    const result = db.prepare('SELECT vec_version() as version').get() as {
      version: string;
    };
    expect(result.version).toBeTruthy();
    expect(typeof result.version).toBe('string');
  });

  it('should insert and retrieve vectors from vec0', () => {
    insertFact(1, 'fact one');
    insertFact(2, 'fact two');

    insertVector(1, [1, 0, 0, 0]);
    insertVector(2, [0, 1, 0, 0]);

    const count = db.prepare('SELECT COUNT(*) as c FROM vec_facts').get() as {
      c: number;
    };
    expect(count.c).toBe(2);
  });

  it('should rank by distance (closer = better match)', () => {
    insertFact(1, 'fact one');
    insertFact(2, 'fact two');
    insertFact(3, 'fact three');

    // Fact 1: [1,0,0,0]
    // Fact 2: [0.9,0.1,0,0] (close to fact 1)
    // Fact 3: [0,0,1,0] (far from fact 1)
    insertVector(1, [1, 0, 0, 0]);
    insertVector(2, [0.9, 0.1, 0, 0]);
    insertVector(3, [0, 0, 1, 0]);

    // Query with [1,0,0,0] — fact 1 should be exact match
    const queryVec = new Float32Array([1, 0, 0, 0]);
    const results = db
      .prepare(
        `SELECT rowid, distance FROM vec_facts
         WHERE embedding MATCH ? AND k = 3
         ORDER BY distance ASC`,
      )
      .all(Buffer.from(queryVec.buffer)) as Array<{
      rowid: number;
      distance: number;
    }>;

    expect(results).toHaveLength(3);
    expect(results[0].rowid).toBe(1); // Exact match
    expect(results[0].distance).toBeCloseTo(0, 4);
    expect(results[1].rowid).toBe(2); // Close match
    expect(results[2].rowid).toBe(3); // Far match
    expect(results[1].distance).toBeLessThan(results[2].distance);
  });

  it('should support deletion from vec_facts', () => {
    insertFact(1, 'fact one');
    insertFact(2, 'fact two');

    insertVector(1, [1, 0, 0, 0]);
    insertVector(2, [0, 1, 0, 0]);

    db.prepare('DELETE FROM vec_facts WHERE rowid = 1').run();

    const count = db.prepare('SELECT COUNT(*) as c FROM vec_facts').get() as {
      c: number;
    };
    expect(count.c).toBe(1);
  });

  it('should join vec_facts with facts for agent_id filtering', () => {
    insertFact(1, 'main fact', 'main');
    insertFact(2, 'other fact', 'other');

    insertVector(1, [1, 0, 0, 0]);
    insertVector(2, [0.9, 0.1, 0, 0]);

    const queryVec = new Float32Array([1, 0, 0, 0]);
    const results = db
      .prepare(
        `SELECT v.rowid, v.distance
         FROM vec_facts v
         JOIN facts f ON f.id = v.rowid
         WHERE v.embedding MATCH ?
           AND f.agent_id = ?
           AND k = 5
         ORDER BY v.distance ASC`,
      )
      .all(Buffer.from(queryVec.buffer), 'main') as Array<{
      rowid: number;
      distance: number;
    }>;

    // Only the 'main' fact should be returned
    expect(results).toHaveLength(1);
    expect(results[0].rowid).toBe(1);
  });
});

describe('FTS5', () => {
  it('should index facts on insert via trigger', () => {
    insertFact(1, 'Tomasz enjoys cycling on weekends');
    insertFact(2, 'Tomasz works as a software engineer');
    insertFact(3, 'Tomasz prefers TypeScript over JavaScript');

    const result = db
      .prepare(`SELECT COUNT(*) as c FROM facts_fts`)
      .get() as { c: number };

    expect(result.c).toBe(3);
  });

  it('should match simple keywords', () => {
    insertFact(1, 'Tomasz enjoys cycling on weekends');
    insertFact(2, 'Tomasz works as a software engineer');

    const results = db
      .prepare(
        `SELECT f.id, f.fact, -fts.rank AS score
         FROM facts_fts fts
         JOIN facts f ON f.id = fts.rowid
         WHERE facts_fts MATCH '"cycling"'
         ORDER BY fts.rank`,
      )
      .all() as Array<{ id: number; fact: string; score: number }>;

    expect(results).toHaveLength(1);
    expect(results[0].fact).toContain('cycling');
  });

  it('should support porter stemming (running → run)', () => {
    insertFact(1, 'She enjoys running in the park');

    const results = db
      .prepare(
        `SELECT f.id, f.fact
         FROM facts_fts fts
         JOIN facts f ON f.id = fts.rowid
         WHERE facts_fts MATCH '"run"'`,
      )
      .all() as Array<{ id: number; fact: string }>;

    // "run" should match "running" via porter stemming
    expect(results).toHaveLength(1);
    expect(results[0].fact).toContain('running');
  });

  it('should support OR queries', () => {
    insertFact(1, 'Tomasz enjoys cycling on weekends');
    insertFact(2, 'Tomasz prefers TypeScript over JavaScript');
    insertFact(3, 'Tomasz lives in Warsaw');

    const results = db
      .prepare(
        `SELECT f.id, f.fact
         FROM facts_fts fts
         JOIN facts f ON f.id = fts.rowid
         WHERE facts_fts MATCH '"cycling" OR "typescript"'`,
      )
      .all() as Array<{ id: number; fact: string }>;

    expect(results).toHaveLength(2);
  });

  it('should remove from FTS5 on delete via trigger', () => {
    insertFact(1, 'Tomasz enjoys cycling on weekends');
    insertFact(2, 'Tomasz works as a software engineer');

    // Delete fact 1
    db.prepare('DELETE FROM facts WHERE id = 1').run();

    // "cycling" should no longer match
    const results = db
      .prepare(
        `SELECT f.id FROM facts_fts fts
         JOIN facts f ON f.id = fts.rowid
         WHERE facts_fts MATCH '"cycling"'`,
      )
      .all();

    expect(results).toHaveLength(0);

    // "engineer" should still match
    const remaining = db
      .prepare(
        `SELECT f.id FROM facts_fts fts
         JOIN facts f ON f.id = fts.rowid
         WHERE facts_fts MATCH '"engineer"'`,
      )
      .all();

    expect(remaining).toHaveLength(1);
  });

  it('should update FTS5 on fact update via trigger', () => {
    insertFact(1, 'Tomasz enjoys cycling on weekends');

    // Update fact from cycling to swimming
    db.prepare(
      `UPDATE facts SET fact = 'Tomasz enjoys swimming on weekends' WHERE id = 1`,
    ).run();

    // Old term should not match
    const oldResults = db
      .prepare(
        `SELECT f.id FROM facts_fts fts
         JOIN facts f ON f.id = fts.rowid
         WHERE facts_fts MATCH '"cycling"'`,
      )
      .all();
    expect(oldResults).toHaveLength(0);

    // New term should match
    const newResults = db
      .prepare(
        `SELECT f.id FROM facts_fts fts
         JOIN facts f ON f.id = fts.rowid
         WHERE facts_fts MATCH '"swimming"'`,
      )
      .all();
    expect(newResults).toHaveLength(1);
  });

  it('should filter by agent_id with JOIN', () => {
    insertFact(1, 'She enjoys running in the park', 'other');
    insertFact(2, 'Tomasz works as an engineer', 'main');

    const results = db
      .prepare(
        `SELECT f.id, f.fact
         FROM facts_fts fts
         JOIN facts f ON f.id = fts.rowid
         WHERE facts_fts MATCH '"running"'
           AND f.agent_id = 'main'`,
      )
      .all() as Array<{ id: number; fact: string }>;

    // "running" fact belongs to 'other' agent
    expect(results).toHaveLength(0);
  });
});
