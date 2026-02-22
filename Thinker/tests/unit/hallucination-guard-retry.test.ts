import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mcp/shared/Utils/logger.js', () => ({
  Logger: class { info = vi.fn(); warn = vi.fn(); error = vi.fn(); debug = vi.fn(); },
}));

vi.mock('../../src/utils/sanitize.js', () => ({
  sanitizeResponseText: (t: string) => t,
}));

const mockGenerateText = vi.fn();
vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

import {
  HallucinationGuard,
  type GuardParams,
} from '../../src/agent/components/hallucination-guard.js';
import type { AgentContext } from '../../src/agent/types.js';

function makeGuardParams(overrides: Partial<GuardParams> = {}): GuardParams {
  return {
    context: {
      systemPrompt: 'You are helpful.',
      conversationHistory: [],
      facts: [],
      profile: null,
      playbookRequiredTools: [],
    } satisfies AgentContext,
    userMessage: 'Send an email',
    selectedTools: { send_email: {} as any },
    temperature: 0.7,
    abortSignal: AbortSignal.timeout(10_000),
    onStepFinish: vi.fn(),
    ...overrides,
  };
}

function makeModelFactory() {
  return { getModel: vi.fn().mockReturnValue('mock-model') } as any;
}

function makeCostMonitor() {
  return { recordUsage: vi.fn() } as any;
}

describe('HallucinationGuard', () => {
  let guard: HallucinationGuard;
  let costMonitor: ReturnType<typeof makeCostMonitor>;

  beforeEach(() => {
    vi.clearAllMocks();
    costMonitor = makeCostMonitor();
    guard = new HallucinationGuard(makeModelFactory(), costMonitor);
  });

  describe('retryActionHallucination', () => {
    it('retries with toolChoice: required and returns result when tools are called', async () => {
      mockGenerateText.mockResolvedValue({
        steps: [{ toolCalls: [{ toolName: 'send_email' }] }],
        text: 'Email sent successfully.',
        usage: { promptTokens: 100, completionTokens: 50 },
      });

      const result = await guard.retryActionHallucination(makeGuardParams());

      expect(result.applied).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.responseText).toBe('Email sent successfully.');
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({ toolChoice: 'required' }),
      );
      expect(costMonitor.recordUsage).toHaveBeenCalledWith(100, 50);
    });

    it('returns disclaimer when retry still calls no tools', async () => {
      mockGenerateText.mockResolvedValue({
        steps: [{ toolCalls: [] }],
        text: 'I created the event.',
        usage: { promptTokens: 100, completionTokens: 50 },
      });

      const result = await guard.retryActionHallucination(makeGuardParams());

      expect(result.applied).toBe(true);
      expect(result.result).toBeUndefined();
      expect(result.responseText).toContain("wasn't able to complete");
    });

    it('returns disclaimer on generateText failure', async () => {
      mockGenerateText.mockRejectedValue(new Error('API timeout'));

      const result = await guard.retryActionHallucination(makeGuardParams());

      expect(result.applied).toBe(true);
      expect(result.responseText).toContain("wasn't able to complete");
    });

    it('lowers temperature to at most 0.3', async () => {
      mockGenerateText.mockResolvedValue({
        steps: [{ toolCalls: [{ toolName: 'send_email' }] }],
        text: 'Done.',
        usage: { promptTokens: 50, completionTokens: 25 },
      });

      await guard.retryActionHallucination(makeGuardParams({ temperature: 0.9 }));

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.3 }),
      );
    });
  });

  describe('retryToolRefusal', () => {
    it('forces tool call and follows up with auto', async () => {
      // Phase 1: forced tool call
      mockGenerateText
        .mockResolvedValueOnce({
          steps: [{ toolCalls: [{ toolName: 'searcher_web_search' }] }],
          usage: { promptTokens: 100, completionTokens: 50 },
          response: { messages: [{ role: 'assistant', content: 'search result' }] },
        })
        // Phase 2: follow-up with auto
        .mockResolvedValueOnce({
          text: 'Here are the search results.',
          steps: [],
          usage: { promptTokens: 200, completionTokens: 100 },
        });

      const result = await guard.retryToolRefusal(makeGuardParams());

      expect(result.applied).toBe(true);
      expect(result.responseText).toBe('Here are the search results.');
      expect(result.recoveredTools).toEqual(['searcher_web_search']);
      expect(mockGenerateText).toHaveBeenCalledTimes(2);
      // First call: required, maxSteps: 1
      expect(mockGenerateText.mock.calls[0][0]).toMatchObject({
        toolChoice: 'required',
        maxSteps: 1,
      });
      // Second call: auto
      expect(mockGenerateText.mock.calls[1][0]).toMatchObject({
        toolChoice: 'auto',
      });
      expect(costMonitor.recordUsage).toHaveBeenCalledTimes(2);
    });

    it('returns not-applied when forced call produces no tools', async () => {
      mockGenerateText.mockResolvedValue({
        steps: [{ toolCalls: [] }],
        usage: { promptTokens: 100, completionTokens: 50 },
      });

      const result = await guard.retryToolRefusal(makeGuardParams());

      expect(result.applied).toBe(false);
      expect(mockGenerateText).toHaveBeenCalledTimes(1);
    });

    it('returns not-applied on generateText failure', async () => {
      mockGenerateText.mockRejectedValue(new Error('API error'));

      const result = await guard.retryToolRefusal(makeGuardParams());

      expect(result.applied).toBe(false);
    });

    it('lowers temperature to at most 0.2 for forced call', async () => {
      mockGenerateText.mockResolvedValue({
        steps: [{ toolCalls: [] }],
        usage: { promptTokens: 50, completionTokens: 25 },
      });

      await guard.retryToolRefusal(makeGuardParams({ temperature: 0.8 }));

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.2 }),
      );
    });
  });

  describe('cost monitor integration', () => {
    it('works without cost monitor (null)', async () => {
      const guardNoCost = new HallucinationGuard(makeModelFactory(), null);
      mockGenerateText.mockResolvedValue({
        steps: [{ toolCalls: [{ toolName: 'send_email' }] }],
        text: 'Done.',
        usage: { promptTokens: 100, completionTokens: 50 },
      });

      const result = await guardNoCost.retryActionHallucination(makeGuardParams());
      expect(result.applied).toBe(true);
    });
  });
});
