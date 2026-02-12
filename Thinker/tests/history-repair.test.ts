/**
 * Unit tests for the conversation history repair logic.
 *
 * Tests orphan removal, synthetic result insertion,
 * and structural integrity of repaired message chains.
 */

import { describe, it, expect } from 'vitest';
import type { CoreMessage } from 'ai';
import { repairConversationHistory, truncateHistoryToolResults } from '../src/agent/history-repair.js';

/** Helper to create a user message */
function userMsg(text: string): CoreMessage {
  return { role: 'user', content: text };
}

/** Helper to create a plain assistant message */
function assistantMsg(text: string): CoreMessage {
  return { role: 'assistant', content: text };
}

/** Helper to create an assistant message with tool calls */
function assistantToolCall(calls: Array<{ id: string; name: string; args?: unknown }>): CoreMessage {
  return {
    role: 'assistant',
    content: calls.map(c => ({
      type: 'tool-call' as const,
      toolCallId: c.id,
      toolName: c.name,
      args: c.args ?? {},
    })),
  };
}

/** Helper to create a tool result message */
function toolResult(results: Array<{ id: string; name: string; result: unknown }>): CoreMessage {
  return {
    role: 'tool',
    content: results.map(r => ({
      type: 'tool-result' as const,
      toolCallId: r.id,
      toolName: r.name,
      result: r.result,
    })),
  };
}

describe('repairConversationHistory', () => {
  // ─── Clean histories (no repair needed) ──────────────────────
  describe('clean histories', () => {
    it('should return empty array for empty input', () => {
      expect(repairConversationHistory([])).toEqual([]);
    });

    it('should pass through simple user/assistant exchanges unchanged', () => {
      const messages: CoreMessage[] = [
        userMsg('hello'),
        assistantMsg('hi there'),
        userMsg('how are you?'),
        assistantMsg('great, thanks!'),
      ];
      const result = repairConversationHistory(messages);
      expect(result).toHaveLength(4);
      expect(result[0]).toEqual(messages[0]);
      expect(result[1]).toEqual(messages[1]);
    });

    it('should pass through valid tool-call/result pairs', () => {
      const messages: CoreMessage[] = [
        userMsg('check status'),
        assistantToolCall([{ id: 'call-1', name: 'get_status' }]),
        toolResult([{ id: 'call-1', name: 'get_status', result: { status: 'ok' } }]),
        assistantMsg('Everything is running.'),
      ];
      const result = repairConversationHistory(messages);
      expect(result).toHaveLength(4);
    });
  });

  // ─── Rule 1: Leading orphan tool results ─────────────────────
  describe('Rule 1: leading orphan tool results', () => {
    it('should remove leading tool results with no preceding call', () => {
      const messages: CoreMessage[] = [
        toolResult([{ id: 'orphan-1', name: 'some_tool', result: 'data' }]),
        userMsg('hello'),
        assistantMsg('hi'),
      ];
      const result = repairConversationHistory(messages);
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('user');
    });

    it('should remove multiple leading orphan tool results', () => {
      const messages: CoreMessage[] = [
        toolResult([{ id: 'orphan-1', name: 'tool_a', result: 'data' }]),
        toolResult([{ id: 'orphan-2', name: 'tool_b', result: 'data' }]),
        userMsg('hello'),
      ];
      const result = repairConversationHistory(messages);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
    });
  });

  // ─── Rule 2: Missing tool results ────────────────────────────
  describe('Rule 2: missing tool results', () => {
    it('should insert synthetic result when tool result is missing', () => {
      const messages: CoreMessage[] = [
        userMsg('do something'),
        assistantToolCall([{ id: 'call-1', name: 'some_tool' }]),
        // Missing tool result here
        userMsg('next question'),
      ];
      const result = repairConversationHistory(messages);
      // Should have: user, assistant(tool-call), tool(synthetic), user
      expect(result).toHaveLength(4);
      expect(result[2].role).toBe('tool');

      // Verify synthetic result
      const content = result[2].content;
      expect(Array.isArray(content)).toBe(true);
      const parts = content as Array<{ type: string; toolCallId: string; result: unknown }>;
      expect(parts[0].toolCallId).toBe('call-1');
      expect(parts[0].result).toEqual({ error: 'Tool result unavailable (recovered from broken history)' });
    });

    it('should insert synthetic result at end of history', () => {
      const messages: CoreMessage[] = [
        userMsg('do something'),
        assistantToolCall([{ id: 'call-1', name: 'some_tool' }]),
        // History ends without tool result
      ];
      const result = repairConversationHistory(messages);
      expect(result).toHaveLength(3);
      expect(result[2].role).toBe('tool');
    });

    it('should handle multiple tool calls with missing results', () => {
      const messages: CoreMessage[] = [
        userMsg('do things'),
        assistantToolCall([
          { id: 'call-1', name: 'tool_a' },
          { id: 'call-2', name: 'tool_b' },
        ]),
        // Missing results for both
        userMsg('next'),
      ];
      const result = repairConversationHistory(messages);
      expect(result).toHaveLength(4);
      expect(result[2].role).toBe('tool');

      const parts = result[2].content as Array<{ toolCallId: string }>;
      expect(parts).toHaveLength(2);
      expect(parts[0].toolCallId).toBe('call-1');
      expect(parts[1].toolCallId).toBe('call-2');
    });
  });

  // ─── Rule 3: Orphaned tool results ───────────────────────────
  describe('Rule 3: orphaned tool results (no matching call)', () => {
    it('should remove tool results with no matching preceding call', () => {
      const messages: CoreMessage[] = [
        userMsg('hello'),
        assistantMsg('hi'),
        toolResult([{ id: 'no-matching-call', name: 'ghost_tool', result: 'data' }]),
      ];
      const result = repairConversationHistory(messages);
      expect(result).toHaveLength(2);
      expect(result.every(m => m.role !== 'tool')).toBe(true);
    });

    it('should keep matched parts and remove unmatched parts', () => {
      const messages: CoreMessage[] = [
        userMsg('do something'),
        assistantToolCall([{ id: 'call-1', name: 'real_tool' }]),
        toolResult([
          { id: 'call-1', name: 'real_tool', result: 'good data' },
          { id: 'no-match', name: 'ghost_tool', result: 'bad data' },
        ]),
      ];
      const result = repairConversationHistory(messages);
      expect(result).toHaveLength(3);
      expect(result[2].role).toBe('tool');

      const parts = result[2].content as Array<{ toolCallId: string }>;
      expect(parts).toHaveLength(1);
      expect(parts[0].toolCallId).toBe('call-1');
    });
  });

  // ─── Complex scenarios ───────────────────────────────────────
  describe('complex scenarios', () => {
    it('should handle a realistic multi-turn conversation with tool use', () => {
      const messages: CoreMessage[] = [
        userMsg('check my emails'),
        assistantToolCall([{ id: 'c1', name: 'gmail_list_emails' }]),
        toolResult([{ id: 'c1', name: 'gmail_list_emails', result: { emails: [] } }]),
        assistantMsg('No new emails.'),
        userMsg('what about the weather?'),
        assistantToolCall([{ id: 'c2', name: 'searcher_web_search' }]),
        toolResult([{ id: 'c2', name: 'searcher_web_search', result: { results: ['sunny'] } }]),
        assistantMsg('It will be sunny today.'),
      ];
      const result = repairConversationHistory(messages);
      expect(result).toHaveLength(8);
    });

    it('should not mutate the input array', () => {
      const messages: CoreMessage[] = [
        toolResult([{ id: 'orphan', name: 'tool', result: 'data' }]),
        userMsg('hello'),
      ];
      const originalLength = messages.length;
      repairConversationHistory(messages);
      expect(messages).toHaveLength(originalLength);
    });
  });
});

// ─── truncateHistoryToolResults ──────────────────────────────────
describe('truncateHistoryToolResults', () => {
  it('should return empty array for empty input', () => {
    expect(truncateHistoryToolResults([])).toEqual([]);
  });

  it('should not truncate when tool count <= preserveLastN', () => {
    const messages: CoreMessage[] = [
      userMsg('hello'),
      assistantToolCall([{ id: 'c1', name: 'tool_a' }]),
      toolResult([{ id: 'c1', name: 'tool_a', result: { big: 'data'.repeat(1000) } }]),
      assistantMsg('done'),
    ];
    const result = truncateHistoryToolResults(messages, 2);
    // Only 1 tool message, preserveLastN=2 → no truncation
    const toolMsg = result.find(m => m.role === 'tool');
    const parts = toolMsg!.content as Array<{ result: unknown }>;
    expect(typeof parts[0].result).toBe('object');
  });

  it('should truncate old tool results but preserve last N', () => {
    const messages: CoreMessage[] = [
      userMsg('q1'),
      assistantToolCall([{ id: 'c1', name: 'web_fetch' }]),
      toolResult([{ id: 'c1', name: 'web_fetch', result: { html: '<p>very long content</p>'.repeat(500) } }]),
      assistantMsg('answer 1'),
      userMsg('q2'),
      assistantToolCall([{ id: 'c2', name: 'web_search' }]),
      toolResult([{ id: 'c2', name: 'web_search', result: { results: ['a', 'b'] } }]),
      assistantMsg('answer 2'),
      userMsg('q3'),
      assistantToolCall([{ id: 'c3', name: 'gmail_list' }]),
      toolResult([{ id: 'c3', name: 'gmail_list', result: { emails: [1, 2, 3] } }]),
      assistantMsg('answer 3'),
    ];
    const result = truncateHistoryToolResults(messages, 2);

    // First tool result (index 2) should be truncated
    const firstTool = result[2].content as Array<{ result: unknown }>;
    expect(typeof firstTool[0].result).toBe('string');
    expect((firstTool[0].result as string)).toContain('web_fetch: truncated');

    // Second tool result (index 6) should be preserved
    const secondTool = result[6].content as Array<{ result: unknown }>;
    expect(typeof secondTool[0].result).toBe('object');

    // Third tool result (index 10) should be preserved
    const thirdTool = result[10].content as Array<{ result: unknown }>;
    expect(typeof thirdTool[0].result).toBe('object');
  });

  it('should not mutate the input messages', () => {
    const originalResult = { data: 'important' };
    const messages: CoreMessage[] = [
      userMsg('q1'),
      assistantToolCall([{ id: 'c1', name: 'tool_a' }]),
      toolResult([{ id: 'c1', name: 'tool_a', result: originalResult }]),
      assistantMsg('a1'),
      userMsg('q2'),
      assistantToolCall([{ id: 'c2', name: 'tool_b' }]),
      toolResult([{ id: 'c2', name: 'tool_b', result: 'ok' }]),
    ];
    truncateHistoryToolResults(messages, 1);
    // Original message should still have object result
    const parts = messages[2].content as Array<{ result: unknown }>;
    expect(parts[0].result).toEqual(originalResult);
  });

  it('should handle preserveLastN=0 (truncate everything)', () => {
    const messages: CoreMessage[] = [
      userMsg('q1'),
      assistantToolCall([{ id: 'c1', name: 'tool_a' }]),
      toolResult([{ id: 'c1', name: 'tool_a', result: { big: 'data' } }]),
    ];
    const result = truncateHistoryToolResults(messages, 0);
    const parts = result[2].content as Array<{ result: unknown }>;
    expect(typeof parts[0].result).toBe('string');
    expect((parts[0].result as string)).toContain('truncated');
  });

  it('should handle multi-part tool results', () => {
    const messages: CoreMessage[] = [
      userMsg('q1'),
      assistantToolCall([{ id: 'c1', name: 'tool_a' }, { id: 'c2', name: 'tool_b' }]),
      toolResult([
        { id: 'c1', name: 'tool_a', result: { data: 'a' } },
        { id: 'c2', name: 'tool_b', result: { data: 'b' } },
      ]),
      assistantMsg('a1'),
      userMsg('q2'),
      assistantToolCall([{ id: 'c3', name: 'tool_c' }]),
      toolResult([{ id: 'c3', name: 'tool_c', result: 'ok' }]),
    ];
    const result = truncateHistoryToolResults(messages, 1);
    // First tool message (2 parts) should be truncated
    const parts = result[2].content as Array<{ result: unknown }>;
    expect(parts).toHaveLength(2);
    expect(typeof parts[0].result).toBe('string');
    expect((parts[0].result as string)).toContain('tool_a');
    expect(typeof parts[1].result).toBe('string');
    expect((parts[1].result as string)).toContain('tool_b');
  });
});
