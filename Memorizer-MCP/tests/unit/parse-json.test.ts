import { describe, it, expect } from 'vitest';
import { parseJsonFromLLM } from '../../src/utils/parse-json.js';

describe('parseJsonFromLLM', () => {
  it('parses clean JSON response', () => {
    const input = '{"actions": [], "summary": "All facts are clean"}';
    const result = parseJsonFromLLM(input);
    expect(result).toEqual({ actions: [], summary: 'All facts are clean' });
  });

  it('parses JSON wrapped in markdown code block', () => {
    const input = '```json\n{"actions": [], "summary": "done"}\n```';
    const result = parseJsonFromLLM(input);
    expect(result).toEqual({ actions: [], summary: 'done' });
  });

  it('parses JSON in bare markdown code block', () => {
    const input = '```\n{"facts": [{"fact": "likes coffee", "category": "preference", "confidence": 0.9}]}\n```';
    const result = parseJsonFromLLM(input);
    expect(result).toEqual({
      facts: [{ fact: 'likes coffee', category: 'preference', confidence: 0.9 }],
    });
  });

  it('parses JSON with trailing explanation text', () => {
    const input = '{"actions": [{"type": "delete", "fact_id": 5, "reason": "stale"}], "summary": "cleaned"}\n\nI removed one stale fact.';
    const result = parseJsonFromLLM(input);
    expect(result).toEqual({
      actions: [{ type: 'delete', fact_id: 5, reason: 'stale' }],
      summary: 'cleaned',
    });
  });

  it('parses JSON with leading explanation text', () => {
    const input = 'Here is the result:\n{"actions": [], "summary": "no changes"}';
    const result = parseJsonFromLLM(input);
    expect(result).toEqual({ actions: [], summary: 'no changes' });
  });

  it('parses JSON with both leading and trailing text', () => {
    const input = 'Analysis complete.\n{"actions": [], "summary": "clean"}\nLet me know if you need more.';
    const result = parseJsonFromLLM(input);
    expect(result).toEqual({ actions: [], summary: 'clean' });
  });

  it('handles JSON with nested objects and arrays', () => {
    const input = '{"actions": [{"type": "merge", "keep_id": 1, "delete_ids": [2, 3], "updated_text": "merged"}], "summary": "merged dupes"}';
    const result = parseJsonFromLLM(input);
    expect(result).toEqual({
      actions: [{ type: 'merge', keep_id: 1, delete_ids: [2, 3], updated_text: 'merged' }],
      summary: 'merged dupes',
    });
  });

  it('returns null for JavaScript code instead of JSON', () => {
    const input = '{"delete_ids": Array.from([1, 2, 3]), "summary": "cleaned"}';
    const result = parseJsonFromLLM(input);
    // Array.from is not valid JSON — all tiers should fail
    expect(result).toBeNull();
  });

  it('returns null for plain text with no JSON', () => {
    const input = 'All facts look good. No changes needed.';
    const result = parseJsonFromLLM(input);
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = parseJsonFromLLM('');
    expect(result).toBeNull();
  });

  it('handles JSON with escaped quotes in strings', () => {
    const input = '{"summary": "User said \\"hello world\\""}';
    const result = parseJsonFromLLM(input);
    expect(result).toEqual({ summary: 'User said "hello world"' });
  });

  it('handles JSON with braces inside string values', () => {
    const input = '{"summary": "Merged {old} into {new} format"} trailing text with } braces';
    const result = parseJsonFromLLM(input);
    expect(result).toEqual({ summary: 'Merged {old} into {new} format' });
  });

  it('handles truncated JSON gracefully', () => {
    const input = '{"actions": [{"type": "merge", "keep_id": 1';
    const result = parseJsonFromLLM(input);
    expect(result).toBeNull();
  });

  it('handles JSON with whitespace padding', () => {
    const input = '  \n  {"actions": [], "summary": "clean"}  \n  ';
    const result = parseJsonFromLLM(input);
    expect(result).toEqual({ actions: [], summary: 'clean' });
  });
});
