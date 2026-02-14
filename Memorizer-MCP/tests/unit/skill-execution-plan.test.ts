/**
 * Unit tests for execution_plan support in skills (store, update, retrieve).
 * Uses a real in-memory SQLite database to test the full round-trip.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

// We need to mock getDatabase to return our in-memory DB
let testDb: Database.Database;

vi.mock('../../src/db/index.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getDatabase: () => testDb,
    generateId: vi.fn(() => 'test-id'),
  };
});

vi.mock('../../src/services/fact-extractor.js', () => ({
  getFactExtractor: vi.fn(),
}));

vi.mock('../../src/services/sanitizer.js', () => ({
  isFactSafe: vi.fn(() => true),
}));

vi.mock('../../src/config/index.js', () => ({
  getConfig: vi.fn(() => ({
    database: { path: ':memory:' },
    export: { path: '/tmp/export' },
    embedding: {
      provider: 'none',
      vectorWeight: 0.6,
      textWeight: 0.4,
    },
  })),
}));

vi.mock('../../src/embeddings/index.js', () => ({
  getEmbeddingProvider: vi.fn(() => null),
  isVectorSearchEnabled: vi.fn(() => false),
}));

vi.mock('../../src/embeddings/fact-embeddings.js', () => ({
  embedFact: vi.fn(),
  reembedFact: vi.fn(),
  deleteFactEmbedding: vi.fn(),
}));

vi.mock('@mcp/shared/Utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  handleStoreSkill,
  handleGetSkill,
  handleUpdateSkill,
  handleListSkills,
} from '../../src/tools/skills.js';

describe('Skill execution_plan support', () => {
  beforeAll(() => {
    testDb = new Database(':memory:');

    // Create the skills table with execution_plan column
    testDb.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL DEFAULT 'main',
        name TEXT NOT NULL,
        description TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        trigger_type TEXT NOT NULL DEFAULT 'manual',
        trigger_config TEXT,
        instructions TEXT NOT NULL,
        required_tools TEXT,
        execution_plan TEXT DEFAULT NULL,
        max_steps INTEGER NOT NULL DEFAULT 10,
        notify_on_completion INTEGER NOT NULL DEFAULT 1,
        notify_interval_minutes INTEGER DEFAULT 0,
        last_run_at TEXT,
        last_run_status TEXT,
        last_run_summary TEXT,
        last_notified_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  });

  afterAll(() => {
    testDb.close();
  });

  beforeEach(() => {
    testDb.exec('DELETE FROM skills');
  });

  it('should store a skill with execution_plan and retrieve it', async () => {
    const plan = [
      { id: 'step1', toolName: 'telegram_send_message', parameters: { chat_id: '123', message: 'Hello!' } },
    ];

    const storeResult = await handleStoreSkill({
      name: 'Direct Greeting',
      trigger_type: 'cron',
      instructions: 'Send a greeting via Telegram',
      execution_plan: plan,
    });

    expect(storeResult.success).toBe(true);
    const skillId = storeResult.data?.skill_id;
    expect(skillId).toBeGreaterThan(0);

    // Retrieve and verify round-trip
    const getResult = await handleGetSkill({ skill_id: skillId });
    expect(getResult.success).toBe(true);
    expect(getResult.data?.skill?.execution_plan).toEqual(plan);
  });

  it('should store a skill without execution_plan (null)', async () => {
    const storeResult = await handleStoreSkill({
      name: 'Agent Skill',
      trigger_type: 'cron',
      instructions: 'Complex task requiring LLM reasoning',
    });

    expect(storeResult.success).toBe(true);
    const skillId = storeResult.data?.skill_id;

    const getResult = await handleGetSkill({ skill_id: skillId });
    expect(getResult.success).toBe(true);
    expect(getResult.data?.skill?.execution_plan).toBeNull();
  });

  it('should update a skill to add execution_plan', async () => {
    const storeResult = await handleStoreSkill({
      name: 'Upgradeable Skill',
      trigger_type: 'manual',
      instructions: 'Do something',
    });

    const skillId = storeResult.data?.skill_id;

    const plan = [
      { id: 'fetch', toolName: 'searcher_web_search', parameters: { query: 'news' } },
      { id: 'notify', toolName: 'telegram_send_message', parameters: { message: 'Done' } },
    ];

    const updateResult = await handleUpdateSkill({
      skill_id: skillId,
      execution_plan: plan,
    });

    expect(updateResult.success).toBe(true);

    const getResult = await handleGetSkill({ skill_id: skillId });
    expect(getResult.data?.skill?.execution_plan).toEqual(plan);
  });

  it('should round-trip execution_plan with dependsOn field', async () => {
    const plan = [
      { id: 'step1', toolName: 'searcher_web_search', parameters: { query: 'weather' } },
      { id: 'step2', toolName: 'telegram_send_message', parameters: { message: 'result' }, dependsOn: ['step1'] },
    ];

    const storeResult = await handleStoreSkill({
      name: 'Dependent Steps',
      trigger_type: 'cron',
      instructions: 'Search then notify',
      execution_plan: plan,
    });

    const skillId = storeResult.data?.skill_id;
    const getResult = await handleGetSkill({ skill_id: skillId });

    expect(getResult.data?.skill?.execution_plan).toEqual(plan);
  });

  it('should include execution_plan in list_skills response', async () => {
    const plan = [{ id: 'send', toolName: 'telegram_send_message', parameters: { message: 'hi' } }];

    await handleStoreSkill({
      name: 'Listed Skill',
      trigger_type: 'cron',
      instructions: 'Send hi',
      execution_plan: plan,
    });

    const listResult = await handleListSkills({ agent_id: 'main' });
    expect(listResult.success).toBe(true);
    expect(listResult.data?.skills).toHaveLength(1);
    expect(listResult.data?.skills[0].execution_plan).toEqual(plan);
  });

  it('should validate execution_plan step schema', async () => {
    // Missing required 'id' field
    const result = await handleStoreSkill({
      name: 'Bad Plan',
      trigger_type: 'manual',
      instructions: 'Won\'t work',
      execution_plan: [{ toolName: 'telegram_send_message' }],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid input');
  });
});
