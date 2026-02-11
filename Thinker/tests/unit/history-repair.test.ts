import { describe, it, expect } from 'vitest';
import type { CoreMessage } from 'ai';
import { repairConversationHistory } from '../../src/agent/history-repair.js';

// ── Helpers ──────────────────────────────────────────────────────────

function userMsg(text: string): CoreMessage {
  return { role: 'user', content: text };
}

function assistantText(text: string): CoreMessage {
  return { role: 'assistant', content: text };
}

function assistantToolCall(
  ...calls: Array<{ id: string; name: string; args?: unknown }>
): CoreMessage {
  return {
    role: 'assistant',
    content: calls.map((c) => ({
      type: 'tool-call' as const,
      toolCallId: c.id,
      toolName: c.name,
      args: c.args ?? {},
    })),
  };
}

function toolResult(
  ...results: Array<{ id: string; name: string; result?: unknown }>
): CoreMessage {
  return {
    role: 'tool',
    content: results.map((r) => ({
      type: 'tool-result' as const,
      toolCallId: r.id,
      toolName: r.name,
      result: r.result ?? { success: true },
    })),
  };
}

function syntheticResult(id: string, name: string): object {
  return {
    type: 'tool-result',
    toolCallId: id,
    toolName: name,
    result: { error: 'Tool result unavailable (recovered from broken history)' },
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('repairConversationHistory', () => {
  // 1. Passthrough — clean history unchanged
  describe('passthrough', () => {
    it('returns empty array for empty input', () => {
      expect(repairConversationHistory([])).toEqual([]);
    });

    it('passes through clean user/assistant text pairs unchanged', () => {
      const msgs: CoreMessage[] = [
        userMsg('hello'),
        assistantText('hi there'),
        userMsg('how are you'),
        assistantText('good'),
      ];
      expect(repairConversationHistory(msgs)).toEqual(msgs);
    });
  });

  // 2. Well-formed tool sequences unchanged
  describe('well-formed tool sequences', () => {
    it('passes through a single tool-call + result pair', () => {
      const msgs: CoreMessage[] = [
        userMsg('search for cats'),
        assistantToolCall({ id: 'tc1', name: 'web_search' }),
        toolResult({ id: 'tc1', name: 'web_search' }),
        assistantText('Here are the results'),
      ];
      expect(repairConversationHistory(msgs)).toEqual(msgs);
    });

    it('passes through multi-step tool sequences', () => {
      const msgs: CoreMessage[] = [
        userMsg('search and send'),
        assistantToolCall({ id: 'tc1', name: 'web_search' }),
        toolResult({ id: 'tc1', name: 'web_search' }),
        assistantToolCall({ id: 'tc2', name: 'send_telegram' }),
        toolResult({ id: 'tc2', name: 'send_telegram' }),
        assistantText('Done'),
      ];
      expect(repairConversationHistory(msgs)).toEqual(msgs);
    });
  });

  // 3. Drop leading orphan tool results
  describe('leading orphan tool results', () => {
    it('drops a single leading orphan tool result', () => {
      const msgs: CoreMessage[] = [
        toolResult({ id: 'orphan1', name: 'web_search' }),
        userMsg('hello'),
        assistantText('hi'),
      ];
      expect(repairConversationHistory(msgs)).toEqual([
        userMsg('hello'),
        assistantText('hi'),
      ]);
    });

    it('drops multiple consecutive leading orphan tool results', () => {
      const msgs: CoreMessage[] = [
        toolResult({ id: 'orphan1', name: 'web_search' }),
        toolResult({ id: 'orphan2', name: 'send_telegram' }),
        userMsg('hello'),
        assistantText('hi'),
      ];
      expect(repairConversationHistory(msgs)).toEqual([
        userMsg('hello'),
        assistantText('hi'),
      ]);
    });
  });

  // 4. Patch missing tool results
  describe('missing tool results', () => {
    it('inserts synthetic result when tool result is missing', () => {
      const msgs: CoreMessage[] = [
        userMsg('search'),
        assistantToolCall({ id: 'tc1', name: 'web_search' }),
        userMsg('what happened?'),
        assistantText('sorry'),
      ];
      const result = repairConversationHistory(msgs);
      expect(result).toEqual([
        userMsg('search'),
        assistantToolCall({ id: 'tc1', name: 'web_search' }),
        { role: 'tool', content: [syntheticResult('tc1', 'web_search')] },
        userMsg('what happened?'),
        assistantText('sorry'),
      ]);
    });

    it('inserts synthetic result for multiple tool calls in one message', () => {
      const msgs: CoreMessage[] = [
        userMsg('do both'),
        assistantToolCall(
          { id: 'tc1', name: 'web_search' },
          { id: 'tc2', name: 'store_fact' },
        ),
        userMsg('next'),
      ];
      const result = repairConversationHistory(msgs);
      expect(result[2]).toEqual({
        role: 'tool',
        content: [
          syntheticResult('tc1', 'web_search'),
          syntheticResult('tc2', 'store_fact'),
        ],
      });
    });

    it('inserts synthetic result when tool call is the last message', () => {
      const msgs: CoreMessage[] = [
        userMsg('search'),
        assistantToolCall({ id: 'tc1', name: 'web_search' }),
      ];
      const result = repairConversationHistory(msgs);
      expect(result).toHaveLength(3);
      expect(result[2]).toEqual({
        role: 'tool',
        content: [syntheticResult('tc1', 'web_search')],
      });
    });
  });

  // 5. Remove orphaned tool results (no matching call)
  describe('orphaned tool results', () => {
    it('removes a tool result that has no matching preceding call', () => {
      const msgs: CoreMessage[] = [
        userMsg('hello'),
        assistantText('hi'),
        toolResult({ id: 'ghost', name: 'web_search' }),
      ];
      expect(repairConversationHistory(msgs)).toEqual([
        userMsg('hello'),
        assistantText('hi'),
      ]);
    });
  });

  // 6. Mixed damage — multiple repairs in one pass
  describe('mixed damage', () => {
    it('handles leading orphan + missing result + valid sequence together', () => {
      const msgs: CoreMessage[] = [
        toolResult({ id: 'orphan', name: 'old_tool' }),          // leading orphan — drop
        userMsg('hello'),
        assistantToolCall({ id: 'tc1', name: 'web_search' }),    // missing result — synthesize
        userMsg('and also'),
        assistantToolCall({ id: 'tc2', name: 'send_telegram' }), // has result — keep
        toolResult({ id: 'tc2', name: 'send_telegram' }),
        assistantText('Done'),
      ];
      const result = repairConversationHistory(msgs);
      expect(result).toEqual([
        userMsg('hello'),
        assistantToolCall({ id: 'tc1', name: 'web_search' }),
        { role: 'tool', content: [syntheticResult('tc1', 'web_search')] },
        userMsg('and also'),
        assistantToolCall({ id: 'tc2', name: 'send_telegram' }),
        toolResult({ id: 'tc2', name: 'send_telegram' }),
        assistantText('Done'),
      ]);
    });
  });

  // 7. Does not mutate input array
  describe('immutability', () => {
    it('does not mutate the input array', () => {
      const msgs: CoreMessage[] = [
        toolResult({ id: 'orphan', name: 'web_search' }),
        userMsg('hello'),
        assistantToolCall({ id: 'tc1', name: 'web_search' }),
      ];
      const original = [...msgs];
      repairConversationHistory(msgs);
      expect(msgs).toEqual(original);
      expect(msgs).toHaveLength(3); // original untouched
    });
  });

  // 8. Assistant with string content is never touched
  describe('string content assistant messages', () => {
    it('does not treat assistant text messages as tool calls', () => {
      const msgs: CoreMessage[] = [
        userMsg('hi'),
        assistantText('I called web_search and found results'),
        userMsg('ok'),
        assistantText('great'),
      ];
      expect(repairConversationHistory(msgs)).toEqual(msgs);
    });
  });
});
