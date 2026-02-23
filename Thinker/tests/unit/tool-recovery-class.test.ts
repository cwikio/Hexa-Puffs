import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mcp/shared/Utils/logger.js', () => ({
  Logger: class { info = vi.fn(); warn = vi.fn(); error = vi.fn(); debug = vi.fn(); },
}));

const mockDetectLeakedToolCall = vi.fn();
const mockRecoverLeakedToolCall = vi.fn();

vi.mock('../../src/utils/recover-tool-call.js', () => ({
  detectLeakedToolCall: (...args: unknown[]) => mockDetectLeakedToolCall(...args),
  recoverLeakedToolCall: (...args: unknown[]) => mockRecoverLeakedToolCall(...args),
}));

import { ToolRecovery } from '../../src/agent/components/tool-recovery.js';
import type { CoreMessage } from 'ai';

describe('ToolRecovery', () => {
  let recovery: ToolRecovery;
  const history: CoreMessage[] = [];
  const tools = { send_email: { type: 'function', execute: vi.fn() } as any };

  beforeEach(() => {
    vi.clearAllMocks();
    recovery = new ToolRecovery();
  });

  describe('handleLeakedToolCall', () => {
    it('returns recovered: false when no leak is detected', async () => {
      mockDetectLeakedToolCall.mockReturnValue(null);

      const result = await recovery.handleLeakedToolCall('Normal text', history, tools);

      expect(result.recovered).toBe(false);
      expect(result.messages).toBeUndefined();
    });

    it('returns recovered: false when leaked tool is not in availableTools', async () => {
      mockDetectLeakedToolCall.mockReturnValue({
        detected: true,
        toolName: 'unknown_tool',
        parameters: {},
        preamble: '',
      });

      const result = await recovery.handleLeakedToolCall('leaked json', history, tools);

      // The tool check happens inside handleLeakedToolCall
      expect(result.recovered).toBe(false);
    });

    it('recovers a leaked tool call and returns messages', async () => {
      mockDetectLeakedToolCall.mockReturnValue({
        detected: true,
        toolName: 'send_email',
        parameters: { to: 'john@test.com' },
        preamble: "I'll send that.",
      });
      mockRecoverLeakedToolCall.mockResolvedValue({
        success: true,
        result: { sent: true },
        toolCallId: 'recovery-123',
      });

      const result = await recovery.handleLeakedToolCall('leaked json', history, tools);

      expect(result.recovered).toBe(true);
      expect(result.messages).toHaveLength(2);

      // First message: assistant with tool-call
      const assistantMsg = result.messages![0];
      expect(assistantMsg.role).toBe('assistant');
      expect(Array.isArray(assistantMsg.content)).toBe(true);
      const toolCall = (assistantMsg.content as any[]).find((c: any) => c.type === 'tool-call');
      expect(toolCall.toolName).toBe('send_email');
      expect(toolCall.args).toEqual({ to: 'john@test.com' });

      // Second message: tool result
      const toolMsg = result.messages![1];
      expect(toolMsg.role).toBe('tool');
    });

    it('returns recovered: false when recoverLeakedToolCall returns null', async () => {
      mockDetectLeakedToolCall.mockReturnValue({
        detected: true,
        toolName: 'send_email',
        parameters: { to: 'a@b.com' },
        preamble: '',
      });
      mockRecoverLeakedToolCall.mockResolvedValue(null);

      const result = await recovery.handleLeakedToolCall('leaked json', history, tools);

      expect(result.recovered).toBe(false);
    });

    it('calls detectLeakedToolCall with text and available tools', async () => {
      mockDetectLeakedToolCall.mockReturnValue(null);

      await recovery.handleLeakedToolCall('some text', history, tools);

      expect(mockDetectLeakedToolCall).toHaveBeenCalledWith('some text', tools);
    });

    it('calls recoverLeakedToolCall with tool name, params, and tools', async () => {
      mockDetectLeakedToolCall.mockReturnValue({
        detected: true,
        toolName: 'send_email',
        parameters: { msg: 'hello' },
        preamble: '',
      });
      mockRecoverLeakedToolCall.mockResolvedValue({
        success: true,
        result: {},
        toolCallId: 'recovery-456',
      });

      await recovery.handleLeakedToolCall('leaked', history, tools);

      expect(mockRecoverLeakedToolCall).toHaveBeenCalledWith(
        'send_email',
        { msg: 'hello' },
        tools,
      );
    });

    it('uses fallback toolCallId when recovery result has no toolCallId', async () => {
      mockDetectLeakedToolCall.mockReturnValue({
        detected: true,
        toolName: 'send_email',
        parameters: {},
        preamble: '',
      });
      mockRecoverLeakedToolCall.mockResolvedValue({
        success: true,
        result: {},
        // no toolCallId
      });

      const result = await recovery.handleLeakedToolCall('leaked', history, tools);

      expect(result.recovered).toBe(true);
      const toolCall = (result.messages![0].content as any[]).find((c: any) => c.type === 'tool-call');
      expect(toolCall.toolCallId).toBe('unknown-id');
    });
  });
});
