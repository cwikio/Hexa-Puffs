import { getEmbeddingProvider } from './index.js';
import { getDatabase } from '../db/index.js';
import { logger } from '@mcp/shared/Utils/logger.js';

/**
 * Generate an embedding for a fact and store it in vec_facts.
 * No-op if embeddings are disabled or sqlite-vec is not loaded.
 */
export async function embedFact(factId: number, factText: string): Promise<void> {
  const provider = getEmbeddingProvider();
  if (!provider) return;

  try {
    const db = getDatabase();

    // Check if vec_facts table exists (sqlite-vec may not be loaded)
    try {
      db.prepare('SELECT COUNT(*) FROM vec_facts LIMIT 1').get();
    } catch {
      return; // vec_facts doesn't exist — sqlite-vec not loaded
    }

    const embedding = await provider.embed(factText);
    // sqlite-vec requires BigInt for rowid on INSERT
    db.prepare(
      'INSERT OR REPLACE INTO vec_facts(rowid, embedding) VALUES (?, ?)'
    ).run(BigInt(factId), Buffer.from(embedding.buffer));
  } catch (error) {
    logger.warn('Failed to embed fact', { factId, error });
    // Never throw — embedding failure should not block fact storage
  }
}

/**
 * Re-embed a fact after its text was updated.
 */
export async function reembedFact(factId: number, factText: string): Promise<void> {
  const provider = getEmbeddingProvider();
  if (!provider) return;

  try {
    const db = getDatabase();

    try {
      db.prepare('SELECT COUNT(*) FROM vec_facts LIMIT 1').get();
    } catch {
      return;
    }

    db.prepare('DELETE FROM vec_facts WHERE rowid = ?').run(factId);

    const embedding = await provider.embed(factText);
    // sqlite-vec requires BigInt for rowid on INSERT
    db.prepare(
      'INSERT INTO vec_facts(rowid, embedding) VALUES (?, ?)'
    ).run(BigInt(factId), Buffer.from(embedding.buffer));
  } catch (error) {
    logger.warn('Failed to re-embed fact', { factId, error });
  }
}

/**
 * Delete the embedding for a fact.
 * Synchronous — just a local DB operation.
 */
export function deleteFactEmbedding(factId: number): void {
  try {
    const db = getDatabase();

    try {
      db.prepare('SELECT COUNT(*) FROM vec_facts LIMIT 1').get();
    } catch {
      return;
    }

    db.prepare('DELETE FROM vec_facts WHERE rowid = ?').run(factId);
  } catch (error) {
    logger.warn('Failed to delete fact embedding', { factId, error });
  }
}
