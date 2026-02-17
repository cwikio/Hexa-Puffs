import { describe, it, expect, vi } from 'vitest';
import { detectLeakedToolCall, recoverLeakedToolCall } from '../../src/utils/recover-tool-call.js';
import type { CoreTool } from 'ai';
import { z } from 'zod';

/** Helper to create a mock CoreTool with an execute function */
function mockTool(executeFn?: (...args: unknown[]) => unknown): CoreTool {
  return {
    type: 'function',
    description: 'test tool',
    parameters: z.object({ message: z.string() }),
    execute: executeFn ?? vi.fn().mockResolvedValue({ success: true }),
  } as unknown as CoreTool;
}

const tools: Record<string, CoreTool> = {
  create_job: mockTool(),
  send_telegram: mockTool(),
};

describe('detectLeakedToolCall', () => {
  it('detects a leaked tool call with preamble', () => {
    const text = `I'll create a reminder for you.\n{"name": "create_job", "parameters": {"type": "scheduled", "scheduledAt": "2026-02-09T18:45:00Z"}}`;
    const result = detectLeakedToolCall(text, tools);

    expect(result.detected).toBe(true);
    expect(result.toolName).toBe('create_job');
    expect(result.parameters).toEqual({ type: 'scheduled', scheduledAt: '2026-02-09T18:45:00Z' });
    expect(result.preamble).toBe("I'll create a reminder for you.");
  });

  it('detects a leaked tool call without preamble', () => {
    const text = `{"name": "send_telegram", "parameters": {"chat_id": "123", "message": "Hello"}}`;
    const result = detectLeakedToolCall(text, tools);

    expect(result.detected).toBe(true);
    expect(result.toolName).toBe('send_telegram');
    expect(result.preamble).toBe('');
  });

  it('ignores JSON with unknown tool name', () => {
    const text = `{"name": "unknown_tool", "parameters": {"foo": "bar"}}`;
    const result = detectLeakedToolCall(text, tools);

    expect(result.detected).toBe(false);
  });

  it('ignores text without JSON', () => {
    const text = 'Just a normal response with no JSON at all.';
    const result = detectLeakedToolCall(text, tools);

    expect(result.detected).toBe(false);
  });

  it('ignores malformed JSON parameters', () => {
    const text = `{"name": "create_job", "parameters": {invalid json}}`;
    const result = detectLeakedToolCall(text, tools);

    expect(result.detected).toBe(false);
  });

  it('handles nested parameters objects', () => {
    const text = `Sure!\n{"name": "create_job", "parameters": {"name": "Reminder", "action": {"type": "tool_call", "toolName": "send_telegram", "parameters": {"message": "Hi"}}}}`;
    const result = detectLeakedToolCall(text, tools);

    expect(result.detected).toBe(true);
    expect(result.toolName).toBe('create_job');
    expect(result.parameters).toHaveProperty('action');
  });
});

describe('recoverLeakedToolCall', () => {
  it('executes the tool and returns success', async () => {
    const executeFn = vi.fn().mockResolvedValue({ success: true, data: 'ok' });
    const testTools: Record<string, CoreTool> = {
      create_job: mockTool(executeFn),
    };

    const result = await recoverLeakedToolCall(
      'create_job',
      { name: 'test', type: 'scheduled' },
      testTools,
    );

    expect(result.success).toBe(true);
    expect(executeFn).toHaveBeenCalledOnce();
    expect(executeFn).toHaveBeenCalledWith(
      { name: 'test', type: 'scheduled' },
      expect.objectContaining({ toolCallId: expect.stringContaining('recovery-') }),
    );
  });

  it('returns error when tool has no execute function', async () => {
    const noExecTools: Record<string, CoreTool> = {
      broken: { type: 'function', description: 'no exec', parameters: z.object({}) } as unknown as CoreTool,
    };

    const result = await recoverLeakedToolCall('broken', {}, noExecTools);

    expect(result.success).toBe(false);
    expect(result.error).toContain('no execute function');
  });

  it('returns error when tool execution throws', async () => {
    const throwingFn = vi.fn().mockRejectedValue(new Error('network timeout'));
    const testTools: Record<string, CoreTool> = {
      send_telegram: mockTool(throwingFn),
    };

    const result = await recoverLeakedToolCall(
      'send_telegram',
      { chat_id: '123', message: 'hi' },
      testTools,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('network timeout');
  });
});
