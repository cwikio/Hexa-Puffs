/**
 * Unit tests for GuardedMCPClient decorator.
 * Verifies that Guardian scanning is correctly applied as a transparent wrapper
 * around any IMCPClient, with configurable input/output scanning.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GuardedMCPClient } from '../../src/mcp-clients/guarded-client.js';
import { SecurityError } from '../../src/utils/errors.js';
import type { StdioGuardianClient } from '../../src/mcp-clients/stdio-guardian.js';
import type { IMCPClient, MCPToolCall, ToolCallResult } from '../../src/mcp-clients/types.js';
import type { ScanResult } from '../../src/mcp-clients/guardian-types.js';

// Mock IMCPClient
function createMockInner(overrides?: Partial<IMCPClient>): IMCPClient {
  return {
    name: 'test-mcp',
    isAvailable: true,
    isRequired: false,
    isSensitive: false,
    initialize: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue([]),
    callTool: vi.fn().mockResolvedValue({
      success: true,
      content: { content: [{ type: 'text', text: '{"success":true,"data":"ok"}' }] },
    }),
    ...overrides,
  };
}

// Mock StdioGuardianClient
function createMockGuardian(overrides?: Partial<StdioGuardianClient>): StdioGuardianClient {
  return {
    isAvailable: true,
    scanContent: vi.fn().mockResolvedValue({
      allowed: true,
      risk: 'none',
      reason: 'No threats detected',
    } satisfies ScanResult),
    ...overrides,
  } as StdioGuardianClient;
}

const cleanToolCall: MCPToolCall = {
  name: 'send_message',
  arguments: { message: 'Hello world' },
};

describe('GuardedMCPClient', () => {
  describe('delegation', () => {
    it('should delegate name, isAvailable, isRequired, isSensitive to inner', () => {
      const inner = createMockInner({
        name: 'telegram',
        isAvailable: true,
        isRequired: true,
        isSensitive: true,
      });
      const guardian = createMockGuardian();
      const guarded = new GuardedMCPClient(inner, guardian, {
        scanInput: false,
        scanOutput: false,
        failMode: 'closed',
      });

      expect(guarded.name).toBe('telegram');
      expect(guarded.isAvailable).toBe(true);
      expect(guarded.isRequired).toBe(true);
      expect(guarded.isSensitive).toBe(true);
    });

    it('should delegate initialize() to inner', async () => {
      const inner = createMockInner();
      const guardian = createMockGuardian();
      const guarded = new GuardedMCPClient(inner, guardian, {
        scanInput: false,
        scanOutput: false,
        failMode: 'closed',
      });

      await guarded.initialize();
      expect(inner.initialize).toHaveBeenCalled();
    });

    it('should delegate listTools() to inner', async () => {
      const inner = createMockInner();
      const guardian = createMockGuardian();
      const guarded = new GuardedMCPClient(inner, guardian, {
        scanInput: false,
        scanOutput: false,
        failMode: 'closed',
      });

      await guarded.listTools();
      expect(inner.listTools).toHaveBeenCalled();
    });
  });

  describe('input scanning', () => {
    it('should scan input when scanInput is enabled', async () => {
      const inner = createMockInner();
      const guardian = createMockGuardian();
      const guarded = new GuardedMCPClient(inner, guardian, {
        scanInput: true,
        scanOutput: false,
        failMode: 'closed',
      });

      await guarded.callTool(cleanToolCall);

      expect(guardian.scanContent).toHaveBeenCalledWith(
        JSON.stringify(cleanToolCall.arguments),
        'test-mcp'
      );
      expect(inner.callTool).toHaveBeenCalledWith(cleanToolCall);
    });

    it('should NOT scan input when scanInput is disabled', async () => {
      const inner = createMockInner();
      const guardian = createMockGuardian();
      const guarded = new GuardedMCPClient(inner, guardian, {
        scanInput: false,
        scanOutput: false,
        failMode: 'closed',
      });

      await guarded.callTool(cleanToolCall);

      expect(guardian.scanContent).not.toHaveBeenCalled();
      expect(inner.callTool).toHaveBeenCalledWith(cleanToolCall);
    });

    it('should throw SecurityError when input is blocked', async () => {
      const inner = createMockInner();
      const guardian = createMockGuardian({
        scanContent: vi.fn().mockResolvedValue({
          allowed: false,
          risk: 'high',
          reason: 'Prompt injection detected',
          threats: ['prompt_injection'],
        } satisfies ScanResult),
      });
      const guarded = new GuardedMCPClient(inner, guardian, {
        scanInput: true,
        scanOutput: false,
        failMode: 'closed',
      });

      await expect(guarded.callTool(cleanToolCall)).rejects.toThrow(SecurityError);
      await expect(guarded.callTool(cleanToolCall)).rejects.toThrow('Input blocked by Guardian');

      // Inner should NOT have been called
      expect(inner.callTool).not.toHaveBeenCalled();
    });
  });

  describe('output scanning', () => {
    it('should scan output when scanOutput is enabled', async () => {
      const mockResult: ToolCallResult = {
        success: true,
        content: { content: [{ type: 'text', text: '{"success":true,"data":"sensitive"}' }] },
      };
      const inner = createMockInner({
        callTool: vi.fn().mockResolvedValue(mockResult),
      });
      const guardian = createMockGuardian();
      const guarded = new GuardedMCPClient(inner, guardian, {
        scanInput: false,
        scanOutput: true,
        failMode: 'closed',
      });

      await guarded.callTool(cleanToolCall);

      expect(guardian.scanContent).toHaveBeenCalledWith(
        JSON.stringify(mockResult.content),
        'test-mcp'
      );
    });

    it('should NOT scan output when scanOutput is disabled', async () => {
      const inner = createMockInner();
      const guardian = createMockGuardian();
      const guarded = new GuardedMCPClient(inner, guardian, {
        scanInput: false,
        scanOutput: false,
        failMode: 'closed',
      });

      await guarded.callTool(cleanToolCall);

      expect(guardian.scanContent).not.toHaveBeenCalled();
    });

    it('should NOT scan output when inner call failed', async () => {
      const inner = createMockInner({
        callTool: vi.fn().mockResolvedValue({ success: false, error: 'MCP error' }),
      });
      const guardian = createMockGuardian();
      const guarded = new GuardedMCPClient(inner, guardian, {
        scanInput: false,
        scanOutput: true,
        failMode: 'closed',
      });

      const result = await guarded.callTool(cleanToolCall);

      expect(result.success).toBe(false);
      expect(guardian.scanContent).not.toHaveBeenCalled();
    });

    it('should throw SecurityError when output is blocked', async () => {
      const inner = createMockInner();
      const scanFn = vi.fn().mockResolvedValue({
        allowed: false,
        risk: 'high',
        reason: 'Credential leakage detected',
        threats: ['data_exfiltration'],
      } satisfies ScanResult);
      const guardian = createMockGuardian({ scanContent: scanFn });
      const guarded = new GuardedMCPClient(inner, guardian, {
        scanInput: false,
        scanOutput: true,
        failMode: 'closed',
      });

      await expect(guarded.callTool(cleanToolCall)).rejects.toThrow(SecurityError);
      await expect(guarded.callTool(cleanToolCall)).rejects.toThrow('Output blocked by Guardian');
    });
  });

  describe('both input and output scanning', () => {
    it('should scan both input and output', async () => {
      const inner = createMockInner();
      const scanFn = vi.fn().mockResolvedValue({
        allowed: true,
        risk: 'none',
      } satisfies ScanResult);
      const guardian = createMockGuardian({ scanContent: scanFn });
      const guarded = new GuardedMCPClient(inner, guardian, {
        scanInput: true,
        scanOutput: true,
        failMode: 'closed',
      });

      await guarded.callTool(cleanToolCall);

      // Should have been called twice: once for input, once for output
      expect(scanFn).toHaveBeenCalledTimes(2);
      expect(inner.callTool).toHaveBeenCalledWith(cleanToolCall);
    });

    it('should not reach output scan if input is blocked', async () => {
      const inner = createMockInner();
      const scanFn = vi.fn().mockResolvedValue({
        allowed: false,
        risk: 'high',
        reason: 'Blocked',
      } satisfies ScanResult);
      const guardian = createMockGuardian({ scanContent: scanFn });
      const guarded = new GuardedMCPClient(inner, guardian, {
        scanInput: true,
        scanOutput: true,
        failMode: 'closed',
      });

      await expect(guarded.callTool(cleanToolCall)).rejects.toThrow(SecurityError);

      // Only one scan call (input), inner never called
      expect(scanFn).toHaveBeenCalledTimes(1);
      expect(inner.callTool).not.toHaveBeenCalled();
    });
  });
});
