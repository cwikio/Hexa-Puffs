import { describe, it, expect } from 'vitest';
import {
  IncomingAgentMessageSchema,
  ProcessingResponseSchema,
  type IncomingAgentMessage,
  type ProcessingResponse,
} from '../Types/agent-contract.js';

describe('IncomingAgentMessageSchema', () => {
  const validMessage = {
    id: 'msg-1',
    chatId: 'chat-123',
    senderId: 'user-456',
    text: 'hello',
    date: '2025-01-15T12:00:00Z',
    channel: 'telegram',
  };

  it('should accept a valid message with all required fields', () => {
    const result = IncomingAgentMessageSchema.safeParse(validMessage);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentId).toBe('main'); // default
    }
  });

  it('should apply default agentId when not provided', () => {
    const result = IncomingAgentMessageSchema.safeParse(validMessage);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentId).toBe('main');
    }
  });

  it('should accept explicit agentId', () => {
    const result = IncomingAgentMessageSchema.safeParse({
      ...validMessage,
      agentId: 'custom-agent',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentId).toBe('custom-agent');
    }
  });

  it('should reject when id is missing', () => {
    const { id, ...noId } = validMessage;
    const result = IncomingAgentMessageSchema.safeParse(noId);
    expect(result.success).toBe(false);
  });

  it('should reject when chatId is missing', () => {
    const { chatId, ...noChatId } = validMessage;
    const result = IncomingAgentMessageSchema.safeParse(noChatId);
    expect(result.success).toBe(false);
  });

  it('should reject when text is missing', () => {
    const { text, ...noText } = validMessage;
    const result = IncomingAgentMessageSchema.safeParse(noText);
    expect(result.success).toBe(false);
  });

  it('should reject when senderId is missing', () => {
    const { senderId, ...noSender } = validMessage;
    const result = IncomingAgentMessageSchema.safeParse(noSender);
    expect(result.success).toBe(false);
  });

  it('should reject when date is missing', () => {
    const { date, ...noDate } = validMessage;
    const result = IncomingAgentMessageSchema.safeParse(noDate);
    expect(result.success).toBe(false);
  });

  it('should reject when channel is missing', () => {
    const { channel, ...noChannel } = validMessage;
    const result = IncomingAgentMessageSchema.safeParse(noChannel);
    expect(result.success).toBe(false);
  });

  it('should reject non-string field values', () => {
    const result = IncomingAgentMessageSchema.safeParse({
      ...validMessage,
      chatId: 123,
    });
    expect(result.success).toBe(false);
  });

  it('should reject completely empty input', () => {
    const result = IncomingAgentMessageSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should strip unknown fields', () => {
    const result = IncomingAgentMessageSchema.safeParse({
      ...validMessage,
      extraField: 'should be dropped',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('extraField' in result.data).toBe(false);
    }
  });
});

describe('ProcessingResponseSchema', () => {
  it('should accept a minimal success response', () => {
    const result = ProcessingResponseSchema.safeParse({
      success: true,
      toolsUsed: ['searcher_web_search'],
      totalSteps: 3,
    });
    expect(result.success).toBe(true);
  });

  it('should accept a full success response with optional fields', () => {
    const result = ProcessingResponseSchema.safeParse({
      success: true,
      response: 'Here are the results',
      toolsUsed: ['searcher_web_search', 'send_telegram'],
      totalSteps: 5,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.response).toBe('Here are the results');
    }
  });

  it('should accept an error response', () => {
    const result = ProcessingResponseSchema.safeParse({
      success: false,
      toolsUsed: [],
      totalSteps: 0,
      error: 'Circuit breaker tripped',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.error).toBe('Circuit breaker tripped');
    }
  });

  it('should accept paused flag', () => {
    const result = ProcessingResponseSchema.safeParse({
      success: false,
      toolsUsed: [],
      totalSteps: 0,
      error: 'cost limit exceeded',
      paused: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.paused).toBe(true);
    }
  });

  it('should reject when success is missing', () => {
    const result = ProcessingResponseSchema.safeParse({
      toolsUsed: [],
      totalSteps: 0,
    });
    expect(result.success).toBe(false);
  });

  it('should reject when toolsUsed is missing', () => {
    const result = ProcessingResponseSchema.safeParse({
      success: true,
      totalSteps: 3,
    });
    expect(result.success).toBe(false);
  });

  it('should reject when totalSteps is missing', () => {
    const result = ProcessingResponseSchema.safeParse({
      success: true,
      toolsUsed: [],
    });
    expect(result.success).toBe(false);
  });

  it('should reject non-boolean success', () => {
    const result = ProcessingResponseSchema.safeParse({
      success: 'yes',
      toolsUsed: [],
      totalSteps: 0,
    });
    expect(result.success).toBe(false);
  });

  it('should reject non-array toolsUsed', () => {
    const result = ProcessingResponseSchema.safeParse({
      success: true,
      toolsUsed: 'searcher_web_search',
      totalSteps: 0,
    });
    expect(result.success).toBe(false);
  });
});
