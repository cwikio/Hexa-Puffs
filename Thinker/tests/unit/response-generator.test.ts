import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mcp/shared/Utils/logger.js', () => ({
  Logger: class { info = vi.fn(); warn = vi.fn(); error = vi.fn(); debug = vi.fn(); },
}));

vi.mock('@mcp/shared/Types/StandardResponse.js', () => ({
  createErrorFromException: (e: Error) => ({ error: e.message }),
}));

const mockGenerateText = vi.fn();
vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

vi.mock('../../src/agent/components/tool-recovery.js', () => ({
  ToolRecovery: vi.fn(),
}));

import { ResponseGenerator } from '../../src/agent/components/response-generator.js';

function makeModelFactory() {
  return { getModel: vi.fn().mockReturnValue('mock-model') };
}

function makeToolRecovery() {
  return { handleLeakedToolCall: vi.fn().mockResolvedValue({ recovered: false }) } as any;
}

function makeConfig() {
  return { temperature: 0.7 };
}

function makeDefaultResult(overrides: Record<string, any> = {}) {
  return {
    text: 'Hello!',
    steps: [{ toolCalls: [] }],
    toolCalls: [],
    finishReason: 'stop',
    usage: { promptTokens: 100, completionTokens: 50 },
    response: { messages: [] },
    ...overrides,
  };
}

describe('ResponseGenerator', () => {
  let generator: ResponseGenerator;
  let toolRecovery: ReturnType<typeof makeToolRecovery>;

  beforeEach(() => {
    vi.clearAllMocks();
    toolRecovery = makeToolRecovery();
    generator = new ResponseGenerator(makeModelFactory(), toolRecovery, makeConfig());
  });

  describe('standard (no search tools)', () => {
    it('calls generateText with auto toolChoice', async () => {
      mockGenerateText.mockResolvedValue(makeDefaultResult());

      await generator.generateResponse(
        [{ role: 'user', content: 'Hi' }],
        { some_tool: {} as any },
        { systemPrompt: 'You are helpful.', activeChatId: 'chat-1' },
        { temperature: 0.7, signal: AbortSignal.timeout(5000) },
      );

      expect(mockGenerateText).toHaveBeenCalledTimes(1);
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          toolChoice: 'auto',
          maxSteps: 8,
        }),
      );
    });

    it('returns the generateText result', async () => {
      const expected = makeDefaultResult({ text: 'Result text' });
      mockGenerateText.mockResolvedValue(expected);

      const result = await generator.generateResponse(
        [{ role: 'user', content: 'Hi' }],
        {},
        { systemPrompt: 'Sys', activeChatId: 'c' },
        { temperature: 0.5, signal: AbortSignal.timeout(5000) },
      );

      expect(result.text).toBe('Result text');
    });
  });

  describe('search tool enforcement (two-phase)', () => {
    const searchTools = {
      searcher_web_search: {} as any,
      some_other: {} as any,
    };

    it('uses two-phase approach when search tools present and phase 1 succeeds', async () => {
      // Phase 1: forced tool call
      mockGenerateText
        .mockResolvedValueOnce({
          steps: [{ toolCalls: [{ toolName: 'searcher_web_search' }] }],
          usage: { promptTokens: 100, completionTokens: 50 },
          response: { messages: [{ role: 'assistant', content: 'search result' }] },
        })
        // Phase 2: auto
        .mockResolvedValueOnce(makeDefaultResult({ text: 'Search results summary' }));

      const result = await generator.generateResponse(
        [{ role: 'user', content: 'Search for news' }],
        searchTools,
        { systemPrompt: 'Sys', activeChatId: 'c' },
        { temperature: 0.7, signal: AbortSignal.timeout(5000) },
      );

      expect(mockGenerateText).toHaveBeenCalledTimes(2);
      // Phase 1: required, maxSteps 1
      expect(mockGenerateText.mock.calls[0][0]).toMatchObject({
        toolChoice: 'required',
        maxSteps: 1,
      });
      // Phase 2: auto
      expect(mockGenerateText.mock.calls[1][0]).toMatchObject({
        toolChoice: 'auto',
      });
      expect(result.text).toBe('Search results summary');
    });

    it('falls back to auto when phase 1 produces no tool calls', async () => {
      mockGenerateText
        .mockResolvedValueOnce({
          steps: [{ toolCalls: [] }],
          usage: { promptTokens: 50, completionTokens: 25 },
          response: { messages: [] },
        })
        .mockResolvedValueOnce(makeDefaultResult({ text: 'Fallback' }));

      const result = await generator.generateResponse(
        [{ role: 'user', content: 'News?' }],
        searchTools,
        { systemPrompt: 'Sys', activeChatId: 'c' },
        { temperature: 0.7, signal: AbortSignal.timeout(5000) },
      );

      expect(mockGenerateText).toHaveBeenCalledTimes(2);
      expect(mockGenerateText.mock.calls[1][0]).toMatchObject({
        toolChoice: 'auto',
        maxSteps: 8,
      });
    });

    it('falls back to auto on phase 1 error', async () => {
      mockGenerateText
        .mockRejectedValueOnce(new Error('Phase 1 timeout'))
        .mockResolvedValueOnce(makeDefaultResult({ text: 'Recovered' }));

      const result = await generator.generateResponse(
        [{ role: 'user', content: 'Search' }],
        searchTools,
        { systemPrompt: 'Sys', activeChatId: 'c' },
        { temperature: 0.7, signal: AbortSignal.timeout(5000) },
      );

      expect(mockGenerateText).toHaveBeenCalledTimes(2);
      expect(result.text).toBe('Recovered');
    });

    it('caps phase 1 temperature to 0.2', async () => {
      mockGenerateText
        .mockResolvedValueOnce({
          steps: [{ toolCalls: [] }],
          usage: { promptTokens: 50, completionTokens: 25 },
          response: { messages: [] },
        })
        .mockResolvedValueOnce(makeDefaultResult());

      await generator.generateResponse(
        [{ role: 'user', content: 'Search' }],
        searchTools,
        { systemPrompt: 'Sys', activeChatId: 'c' },
        { temperature: 0.9, signal: AbortSignal.timeout(5000) },
      );

      expect(mockGenerateText.mock.calls[0][0].temperature).toBe(0.2);
    });
  });

  describe('tool leak recovery', () => {
    it('attempts recovery when finishReason is stop with no tool calls and text', async () => {
      mockGenerateText.mockResolvedValue(
        makeDefaultResult({ finishReason: 'stop', text: 'leaked json', toolCalls: [] }),
      );

      await generator.generateResponse(
        [{ role: 'user', content: 'Do something' }],
        { my_tool: {} as any },
        { systemPrompt: 'Sys', activeChatId: 'c' },
        { temperature: 0.7, signal: AbortSignal.timeout(5000) },
      );

      expect(toolRecovery.handleLeakedToolCall).toHaveBeenCalledWith(
        'leaked json',
        expect.any(Array),
        expect.any(Object),
      );
    });

    it('generates summary when leak is recovered', async () => {
      mockGenerateText
        .mockResolvedValueOnce(
          makeDefaultResult({ finishReason: 'stop', text: 'leaked', toolCalls: [] }),
        )
        .mockResolvedValueOnce(makeDefaultResult({ text: 'Summary of recovered action' }));

      toolRecovery.handleLeakedToolCall.mockResolvedValue({
        recovered: true,
        messages: [
          { role: 'assistant', content: [{ type: 'text', text: "I'll run that." }, { type: 'tool-call', toolCallId: 'r-1', toolName: 'my_tool', args: {} }] },
          { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'r-1', toolName: 'my_tool', result: {} }] },
        ],
      });

      const result = await generator.generateResponse(
        [{ role: 'user', content: 'Do something' }],
        { my_tool: {} as any },
        { systemPrompt: 'Sys', activeChatId: 'c' },
        { temperature: 0.7, signal: AbortSignal.timeout(5000) },
      );

      // Second generateText call is the summary
      expect(mockGenerateText).toHaveBeenCalledTimes(2);
      expect(result.text).toBe('Summary of recovered action');
    });

    it('skips recovery when tools were used', async () => {
      mockGenerateText.mockResolvedValue(
        makeDefaultResult({
          finishReason: 'stop',
          text: 'Done',
          toolCalls: [{ toolName: 'my_tool' }],
          steps: [{ toolCalls: [{ toolName: 'my_tool' }] }],
        }),
      );

      await generator.generateResponse(
        [{ role: 'user', content: 'Do something' }],
        { my_tool: {} as any },
        { systemPrompt: 'Sys', activeChatId: 'c' },
        { temperature: 0.7, signal: AbortSignal.timeout(5000) },
      );

      expect(toolRecovery.handleLeakedToolCall).not.toHaveBeenCalled();
    });
  });

  describe('hallucination guard', () => {
    it('retries with required when action hallucination detected and no tools used', async () => {
      // First call: hallucinated
      mockGenerateText
        .mockResolvedValueOnce(
          makeDefaultResult({
            text: "I've sent the email to John.",
            steps: [{ toolCalls: [] }],
            toolCalls: [],
            finishReason: 'stop',
          }),
        )
        // Retry with required
        .mockResolvedValueOnce(
          makeDefaultResult({
            text: 'Email sent.',
            steps: [{ toolCalls: [{ toolName: 'send_email' }] }],
          }),
        );

      const result = await generator.generateResponse(
        [{ role: 'user', content: 'Send email' }],
        { send_email: {} as any },
        { systemPrompt: 'Sys', activeChatId: 'c' },
        { temperature: 0.7, signal: AbortSignal.timeout(5000) },
      );

      expect(mockGenerateText).toHaveBeenCalledTimes(2);
      expect(mockGenerateText.mock.calls[1][0].toolChoice).toBe('required');
    });

    it('caps hallucination retry temperature to 0.3', async () => {
      mockGenerateText
        .mockResolvedValueOnce(
          makeDefaultResult({
            text: "I've created the event.",
            steps: [{ toolCalls: [] }],
            toolCalls: [],
            finishReason: 'stop',
          }),
        )
        .mockResolvedValueOnce(makeDefaultResult());

      await generator.generateResponse(
        [{ role: 'user', content: 'Create event' }],
        { create_event: {} as any },
        { systemPrompt: 'Sys', activeChatId: 'c' },
        { temperature: 0.9, signal: AbortSignal.timeout(5000) },
      );

      // Retry call
      expect(mockGenerateText.mock.calls[1][0].temperature).toBeLessThanOrEqual(0.3);
    });
  });

  describe('tool refusal guard', () => {
    it('retries when tool refusal detected and search tools present', async () => {
      mockGenerateText
        // Phase 1 (required, maxSteps 1) — no tool calls
        .mockResolvedValueOnce({
          steps: [{ toolCalls: [] }],
          usage: { promptTokens: 50, completionTokens: 25 },
          response: { messages: [] },
        })
        // Fallback (auto) — produces refusal text
        .mockResolvedValueOnce(
          makeDefaultResult({
            text: "I don't have access to real-time information.",
            steps: [{ toolCalls: [] }],
            toolCalls: [],
            finishReason: 'stop',
          }),
        )
        // Refusal guard retry (required) — recovers
        .mockResolvedValueOnce(
          makeDefaultResult({
            text: 'Here are the results.',
            steps: [{ toolCalls: [{ toolName: 'searcher_web_search' }] }],
          }),
        );

      await generator.generateResponse(
        [{ role: 'user', content: 'Search news' }],
        { searcher_web_search: {} as any },
        { systemPrompt: 'Sys', activeChatId: 'c' },
        { temperature: 0.5, signal: AbortSignal.timeout(5000) },
      );

      // Phase 1 (required, no tools) → fallback (auto, refusal text) → refusal retry (required)
      expect(mockGenerateText).toHaveBeenCalledTimes(3);
      // Last call should be the refusal retry with required
      expect(mockGenerateText.mock.calls[2][0].toolChoice).toBe('required');
    });
  });
});
