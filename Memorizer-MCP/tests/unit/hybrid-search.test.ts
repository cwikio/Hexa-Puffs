/**
 * Unit tests for hybrid search pure functions.
 * No database or provider dependencies — tests normalizeScores and hybridRank only.
 */

import { describe, it, expect } from 'vitest';
import { normalizeScores, hybridRank } from '../../src/tools/memory.js';

describe('normalizeScores', () => {
  it('should return empty map for empty input', () => {
    const result = normalizeScores(new Map());
    expect(result.size).toBe(0);
  });

  it('should normalize to [0, 1] range', () => {
    const input = new Map([
      [1, 10],
      [2, 20],
      [3, 30],
    ]);
    const result = normalizeScores(input);

    expect(result.get(1)).toBeCloseTo(0);
    expect(result.get(2)).toBeCloseTo(0.5);
    expect(result.get(3)).toBeCloseTo(1);
  });

  it('should return 0.5 for all equal scores', () => {
    const input = new Map([
      [1, 5],
      [2, 5],
      [3, 5],
    ]);
    const result = normalizeScores(input);

    expect(result.get(1)).toBe(0.5);
    expect(result.get(2)).toBe(0.5);
    expect(result.get(3)).toBe(0.5);
  });

  it('should handle single entry', () => {
    const input = new Map([[1, 42]]);
    const result = normalizeScores(input);

    // Single entry → all equal → 0.5
    expect(result.get(1)).toBe(0.5);
  });

  it('should handle two entries', () => {
    const input = new Map([
      [1, 0],
      [2, 100],
    ]);
    const result = normalizeScores(input);

    expect(result.get(1)).toBeCloseTo(0);
    expect(result.get(2)).toBeCloseTo(1);
  });
});

describe('hybridRank', () => {
  it('should combine vector and text scores with weights', () => {
    const vectorResults = new Map([
      [1, 0.9],
      [2, 0.5],
    ]);
    const textResults = new Map([
      [1, 0.3],
      [2, 0.8],
    ]);

    const ranked = hybridRank(vectorResults, textResults, 0.6, 0.4);

    expect(ranked).toHaveLength(2);
    // Both IDs should be present
    const ids = ranked.map((r) => r.id);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
  });

  it('should sort by score descending', () => {
    const vectorResults = new Map([
      [1, 1.0],
      [2, 0.0],
    ]);
    const textResults = new Map([
      [1, 1.0],
      [2, 0.0],
    ]);

    const ranked = hybridRank(vectorResults, textResults, 0.6, 0.4);

    expect(ranked[0].id).toBe(1);
    expect(ranked[1].id).toBe(2);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it('should handle vector-only results (no text matches)', () => {
    const vectorResults = new Map([
      [1, 0.9],
      [2, 0.7],
    ]);
    const textResults = new Map<number, number>();

    const ranked = hybridRank(vectorResults, textResults, 0.6, 0.4);

    expect(ranked).toHaveLength(2);
    // Text component is 0 for all, only vector contributes
    expect(ranked[0].id).toBe(1);
    expect(ranked[1].id).toBe(2);
  });

  it('should handle text-only results (no vector matches)', () => {
    const vectorResults = new Map<number, number>();
    const textResults = new Map([
      [1, 0.9],
      [2, 0.7],
    ]);

    const ranked = hybridRank(vectorResults, textResults, 0.6, 0.4);

    expect(ranked).toHaveLength(2);
    expect(ranked[0].id).toBe(1);
    expect(ranked[1].id).toBe(2);
  });

  it('should produce union of both result sets', () => {
    // ID 1 only in vector, ID 2 only in text, ID 3 in both (highest in both)
    const vectorResults = new Map([
      [1, 0.5],
      [3, 0.9],
    ]);
    const textResults = new Map([
      [2, 0.5],
      [3, 0.9],
    ]);

    const ranked = hybridRank(vectorResults, textResults, 0.6, 0.4);

    expect(ranked).toHaveLength(3);
    const ids = ranked.map((r) => r.id);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
    expect(ids).toContain(3);

    // ID 3 is highest in both sets → normalized to 1.0 in both → highest combined
    expect(ranked[0].id).toBe(3);
  });

  it('should handle empty inputs', () => {
    const ranked = hybridRank(new Map(), new Map(), 0.6, 0.4);
    expect(ranked).toHaveLength(0);
  });
});
