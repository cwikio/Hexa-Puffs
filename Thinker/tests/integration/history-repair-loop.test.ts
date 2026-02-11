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

/** Build a simple text-only turn (user + assistant) */
function textTurn(i: number): CoreMessage[] {
  return [
    userMsg(`User message ${i}`),
    assistantText(`Assistant response ${i}`),
  ];
}

/** Build a tool-using turn (user + assistant-toolcall + tool-result + assistant-text) */
function toolTurn(i: number): CoreMessage[] {
  return [
    userMsg(`User action request ${i}`),
    assistantToolCall({ id: `tc-${i}`, name: `tool_${i}` }),
    toolResult({ id: `tc-${i}`, name: `tool_${i}` }),
    assistantText(`Tool result summary ${i}`),
  ];
}

/** Validate that a repaired message array has no structural violations */
function assertValidHistory(messages: CoreMessage[]): void {
  const pendingToolCallIds = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Tool results must not be the first message
    if (i === 0 && msg.role === 'tool') {
      throw new Error(`History starts with a tool result at index 0`);
    }

    // Track tool call IDs from assistant messages
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (typeof part === 'object' && part !== null && 'type' in part && part.type === 'tool-call') {
          const tc = part as { toolCallId: string };
          pendingToolCallIds.add(tc.toolCallId);
        }
      }
    }

    // Tool results should match pending tool call IDs
    if (msg.role === 'tool' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (typeof part === 'object' && part !== null && 'type' in part && part.type === 'tool-result') {
          const tr = part as { toolCallId: string };
          if (!pendingToolCallIds.has(tr.toolCallId)) {
            throw new Error(
              `Orphaned tool result at index ${i}: toolCallId=${tr.toolCallId} has no matching call`
            );
          }
          pendingToolCallIds.delete(tr.toolCallId);
        }
      }
    }
  }

  // All tool calls should have been resolved
  if (pendingToolCallIds.size > 0) {
    throw new Error(
      `Unresolved tool calls: ${[...pendingToolCallIds].join(', ')}`
    );
  }
}

// ── Integration Tests ────────────────────────────────────────────────

describe('history-repair integration with slice(-50)', () => {
  it('repairs when slice(-50) starts on an orphaned tool result', () => {
    // Build 55 messages: starts with a tool-using turn (4 msgs), then text turns
    const messages: CoreMessage[] = [
      ...toolTurn(0),      // indices 0-3: user, assistant(tc), tool(result), assistant(text)
      ...textTurn(1),      // 4-5
      ...textTurn(2),      // 6-7
      ...textTurn(3),      // 8-9
      ...textTurn(4),      // 10-11
      ...textTurn(5),      // 12-13
      ...textTurn(6),      // 14-15
      ...textTurn(7),      // 16-17
      ...textTurn(8),      // 18-19
      ...textTurn(9),      // 20-21
      ...textTurn(10),     // 22-23
      ...textTurn(11),     // 24-25
      ...textTurn(12),     // 26-27
      ...textTurn(13),     // 28-29
      ...textTurn(14),     // 30-31
      ...textTurn(15),     // 32-33
      ...textTurn(16),     // 34-35
      ...textTurn(17),     // 36-37
      ...textTurn(18),     // 38-39
      ...textTurn(19),     // 40-41
      ...textTurn(20),     // 42-43
      ...textTurn(21),     // 44-45
      ...textTurn(22),     // 46-47
      ...textTurn(23),     // 48-49
      ...textTurn(24),     // 50-51
      ...textTurn(25),     // 52-53
      ...textTurn(26),     // 54-55
    ];
    expect(messages.length).toBeGreaterThan(50);

    // slice(-50) starts at index 6 which is a user message — but let's create a scenario
    // where it starts on a tool result by putting a tool turn near the boundary.
    // Better approach: build exactly so slice(-50) starts on a tool result.
    const precise: CoreMessage[] = [];
    // 5 padding messages, then a tool turn at indices 5-8
    for (let i = 0; i < 5; i++) precise.push(userMsg(`pad-${i}`));
    precise.push(...toolTurn(99)); // indices 5-8: user, assistant(tc), tool(result), assistant(text)
    // Fill remaining with text turns to reach 55 total
    while (precise.length < 55) {
      const idx = Math.floor(precise.length / 2);
      precise.push(...textTurn(idx));
    }
    // slice(-50) starts at index 5 = the user message of toolTurn(99)
    // We want to start on the tool result, so let's put it at index 5 directly.

    // Build array so that slice(-50) starts exactly on an orphaned tool result.
    // We need: [N cut messages] [orphan tool result] [50 - 1 remaining messages]
    // Total = N + 1 + 49 messages. slice(-50) starts at the orphan.
    const directMessages: CoreMessage[] = [
      userMsg('old-1'),                                          // 0 — cut
      userMsg('old-2'),                                          // 1 — cut
      assistantToolCall({ id: 'tc-cut', name: 'old_search' }),   // 2 — cut (call for result at 3)
      toolResult({ id: 'tc-cut', name: 'old_search' }),          // 3 — cut
      assistantText('old result'),                                // 4 — cut
      toolResult({ id: 'tc-boundary', name: 'boundary_tool' }), // 5 — orphan! First after slice.
    ];
    // Add exactly 49 more messages to bring total to 55; slice(-50) = indices 5..54
    // 24 text turns (48 msgs) + 1 extra user message = 49
    for (let i = 0; i < 24; i++) directMessages.push(...textTurn(i));
    directMessages.push(userMsg('final'));
    expect(directMessages.length).toBe(55);

    const sliced = directMessages.slice(-50);
    expect(sliced.length).toBe(50);
    // First message after slice is the orphaned tool result
    expect(sliced[0].role).toBe('tool');

    const repaired = repairConversationHistory(sliced);

    // The orphan should be gone
    expect(repaired[0].role).not.toBe('tool');
    expect(repaired.length).toBe(49); // 50 - 1 orphan removed

    // Validate the entire result
    assertValidHistory(repaired);
  });

  it('repairs when slice(-50) cuts between assistant tool-call and its result', () => {
    // Build array where slice(-50) boundary falls between a tool call and its result
    const messages: CoreMessage[] = [
      userMsg('old-1'),                                          // 0
      userMsg('old-2'),                                          // 1
      userMsg('old-3'),                                          // 2
      userMsg('old-4'),                                          // 3
      userMsg('request'),                                        // 4
      assistantToolCall({ id: 'tc-split', name: 'web_search' }),// 5 — first msg after slice(-50)
      toolResult({ id: 'tc-split', name: 'web_search' }),       // 6 — cut off!
    ];
    // We need index 5 to be the start of slice(-50), so we need 55 total messages
    // and the tool result at index 6 should be included too.
    // Actually, let's think: if array has 55 items, slice(-50) gives indices 5-54.
    // So index 5 = assistantToolCall, index 6 = toolResult — both included. That's fine.
    // For the split: we need index 5 = assistantToolCall but index 6 (toolResult) cut.
    // So: array of 56 items, slice(-50) → indices 6-55. Put toolCall at index 6, result at index 5.
    // No — we need toolCall IN the slice but result BEFORE the slice.
    // Correct: put assistantToolCall at the start of the slice, its toolResult before the slice.
    // That means: result at index 5, toolCall at index 6, slice(-50) starts at 6.
    // Wait, that's backwards. The sequence is: assistant(toolCall) → tool(result).
    // If slice starts after assistant(toolCall) was already placed before the boundary...
    // Actually the case is: assistantToolCall is at index 5, toolResult at index 6.
    // slice(-50) from 56 items starts at index 6. So assistantToolCall is CUT, toolResult is included.
    // That gives us a leading orphan tool result — covered by test 1.
    //
    // The opposite case: assistantToolCall included, toolResult cut. This can't happen with
    // slice(-50) because the result comes AFTER the call, and slice(-50) takes the END.
    // BUT it can happen at the END of the array — if the last message is an assistantToolCall
    // with no result following it (e.g., process crashed before result was appended).

    const endMessages: CoreMessage[] = [];
    for (let i = 0; i < 10; i++) endMessages.push(...textTurn(i));
    // Last message: an assistant tool call with no result
    endMessages.push(userMsg('search for cats'));
    endMessages.push(assistantToolCall({ id: 'tc-dangling', name: 'web_search' }));

    const sliced = endMessages.slice(-50);
    const lastMsg = sliced[sliced.length - 1];
    // Confirm last message is the dangling tool call
    expect(lastMsg.role).toBe('assistant');
    expect(Array.isArray(lastMsg.content)).toBe(true);

    const repaired = repairConversationHistory(sliced);

    // Should have a synthetic result appended
    expect(repaired.length).toBe(sliced.length + 1);
    const syntheticMsg = repaired[repaired.length - 1];
    expect(syntheticMsg.role).toBe('tool');
    expect(Array.isArray(syntheticMsg.content)).toBe(true);
    const content = syntheticMsg.content as Array<{ toolCallId: string; result: unknown }>;
    expect(content[0].toolCallId).toBe('tc-dangling');
    expect(content[0].result).toEqual({
      error: 'Tool result unavailable (recovered from broken history)',
    });

    assertValidHistory(repaired);
  });

  it('handles a realistic 20-turn mixed conversation after slice', () => {
    const messages: CoreMessage[] = [];

    // Build 20 turns: mix of text-only and tool-using turns
    for (let i = 0; i < 20; i++) {
      if (i % 3 === 0) {
        // Every 3rd turn uses tools (turns 0, 3, 6, 9, 12, 15, 18)
        messages.push(...toolTurn(i));
      } else {
        messages.push(...textTurn(i));
      }
    }

    // Total messages: 7 tool turns × 4 msgs + 13 text turns × 2 msgs = 28 + 26 = 54
    expect(messages.length).toBe(54);

    // Slice to 50 — cuts first 4 messages (the first tool turn)
    const sliced = messages.slice(-50);
    expect(sliced.length).toBe(50);

    const repaired = repairConversationHistory(sliced);

    // Validate the entire result has no structural violations
    assertValidHistory(repaired);

    // Should have at least the text turns intact
    const userMsgs = repaired.filter((m) => m.role === 'user');
    expect(userMsgs.length).toBeGreaterThan(10);
  });
});
