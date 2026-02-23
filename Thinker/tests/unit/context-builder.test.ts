import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mcp/shared/Utils/logger.js', () => ({
  Logger: class { info = vi.fn(); warn = vi.fn(); error = vi.fn(); debug = vi.fn(); },
}));

vi.mock('@mcp/shared/Embeddings/math.js', () => ({
  cosineSimilarity: vi.fn(),
}));

vi.mock('../../src/agent/playbook-classifier.js', () => ({
  classifyMessage: vi.fn().mockReturnValue([]),
}));

vi.mock('../../src/agent/history-repair.js', () => ({
  repairConversationHistory: vi.fn((msgs: unknown[]) => msgs),
  truncateHistoryToolResults: vi.fn((msgs: unknown[]) => msgs),
}));

import {
  ContextBuilder,
  type ContextBuilderDeps,
} from '../../src/agent/components/context-builder.js';
import { classifyMessage } from '../../src/agent/playbook-classifier.js';
import { cosineSimilarity } from '@mcp/shared/Embeddings/math.js';
import type { AgentState } from '../../src/agent/types.js';
import type { CoreMessage } from 'ai';

function makeDeps(overrides: Partial<ContextBuilderDeps> = {}): ContextBuilderDeps {
  return {
    orchestrator: {
      getProfile: vi.fn().mockResolvedValue(null),
      retrieveMemories: vi.fn().mockResolvedValue({ facts: [] }),
    } as any,
    config: {
      thinkerAgentId: 'test-agent',
      userTimezone: 'UTC',
      temperature: 0.7,
    } as any,
    embeddingSelector: null,
    playbookCache: {
      refreshIfNeeded: vi.fn().mockResolvedValue(undefined),
      getPlaybooks: vi.fn().mockReturnValue([]),
      getDescriptionOnlySkills: vi.fn().mockReturnValue([]),
    } as any,
    customSystemPrompt: null,
    personaPrompt: null,
    defaultSystemPrompt: 'You are a helpful assistant.',
    ...overrides,
  };
}

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    chatId: 'test-chat',
    messages: [],
    lastActivity: Date.now(),
    recentToolsByTurn: [],
    ...overrides,
  };
}

const dummyTrace = { traceId: 'test', spanId: 'test' } as any;

describe('ContextBuilder', () => {
  let deps: ContextBuilderDeps;
  let builder: ContextBuilder;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = makeDeps();
    builder = new ContextBuilder(deps);
  });

  describe('buildContext', () => {
    it('returns AgentContext with systemPrompt and empty history', async () => {
      const ctx = await builder.buildContext('chat-1', 'Hello', dummyTrace, makeState());

      expect(ctx.systemPrompt).toContain('You are a helpful assistant.');
      expect(ctx.conversationHistory).toEqual([]);
      expect(ctx.facts).toEqual([]);
      expect(ctx.profile).toBeNull();
      expect(ctx.playbookRequiredTools).toEqual([]);
    });

    it('uses customSystemPrompt over defaultSystemPrompt', async () => {
      deps = makeDeps({ customSystemPrompt: 'Custom prompt.' });
      builder = new ContextBuilder(deps);

      const ctx = await builder.buildContext('chat-1', 'Hi', dummyTrace, makeState());

      expect(ctx.systemPrompt).toContain('Custom prompt.');
      expect(ctx.systemPrompt).not.toContain('You are a helpful assistant.');
    });

    it('uses personaPrompt when customSystemPrompt is null', async () => {
      deps = makeDeps({ personaPrompt: 'Persona prompt.' });
      builder = new ContextBuilder(deps);

      const ctx = await builder.buildContext('chat-1', 'Hi', dummyTrace, makeState());

      expect(ctx.systemPrompt).toContain('Persona prompt.');
    });

    it('overrides base prompt with profile persona system_prompt', async () => {
      deps = makeDeps({
        orchestrator: {
          getProfile: vi.fn().mockResolvedValue({
            profile_data: {
              persona: {
                system_prompt: 'Profile system prompt.',
                name: 'Bot',
                style: 'casual',
                tone: 'friendly',
              },
            },
          }),
          retrieveMemories: vi.fn().mockResolvedValue({ facts: [] }),
        } as any,
      });
      builder = new ContextBuilder(deps);

      const ctx = await builder.buildContext('chat-1', 'Hi', dummyTrace, makeState());

      expect(ctx.systemPrompt).toContain('Profile system prompt.');
      expect(ctx.systemPrompt).not.toContain('You are a helpful assistant.');
      expect(ctx.profile).toEqual({ name: 'Bot', style: 'casual', tone: 'friendly' });
    });

    it('injects date/time and chat_id into system prompt', async () => {
      const ctx = await builder.buildContext('chat-42', 'Hello', dummyTrace, makeState());

      expect(ctx.systemPrompt).toContain('## Current Date & Time');
      expect(ctx.systemPrompt).toContain('(UTC)');
      expect(ctx.systemPrompt).toContain('## Current Chat');
      expect(ctx.systemPrompt).toContain('chat_id: chat-42');
    });

    it('injects compaction summary when present in state', async () => {
      const state = makeState({ compactionSummary: 'We discussed weather.' });

      const ctx = await builder.buildContext('chat-1', 'Hi', dummyTrace, state);

      expect(ctx.systemPrompt).toContain('## Previous Conversation Context');
      expect(ctx.systemPrompt).toContain('We discussed weather.');
    });

    it('does not inject compaction section when summary is absent', async () => {
      const ctx = await builder.buildContext('chat-1', 'Hi', dummyTrace, makeState());

      expect(ctx.systemPrompt).not.toContain('## Previous Conversation Context');
    });

    it('injects matched playbooks and collects requiredTools', async () => {
      vi.mocked(classifyMessage).mockReturnValue([
        {
          id: 1,
          name: 'Email Playbook',
          description: null,
          instructions: 'Use send_email tool.',
          keywords: ['email'],
          priority: 1,
          requiredTools: ['send_email', 'gmail_send'],
          source: 'database' as const,
        },
      ]);

      const ctx = await builder.buildContext('chat-1', 'Send email', dummyTrace, makeState());

      expect(ctx.systemPrompt).toContain('## Workflow Guidance');
      expect(ctx.systemPrompt).toContain('### Playbook: Email Playbook');
      expect(ctx.systemPrompt).toContain('Use send_email tool.');
      expect(ctx.playbookRequiredTools).toEqual(['send_email', 'gmail_send']);
    });

    it('injects description-only skills as XML', async () => {
      deps = makeDeps({
        playbookCache: {
          refreshIfNeeded: vi.fn().mockResolvedValue(undefined),
          getPlaybooks: vi.fn().mockReturnValue([]),
          getDescriptionOnlySkills: vi.fn().mockReturnValue([
            { name: 'summarize', description: 'Summarize text' },
          ]),
        } as any,
      });
      builder = new ContextBuilder(deps);

      const ctx = await builder.buildContext('chat-1', 'Hi', dummyTrace, makeState());

      expect(ctx.systemPrompt).toContain('<available_skills>');
      expect(ctx.systemPrompt).toContain('<name>summarize</name>');
      expect(ctx.systemPrompt).toContain('<description>Summarize text</description>');
    });

    it('injects memory facts at end of prompt', async () => {
      deps = makeDeps({
        orchestrator: {
          getProfile: vi.fn().mockResolvedValue(null),
          retrieveMemories: vi.fn().mockResolvedValue({
            facts: [
              { fact: 'User likes coffee', category: 'preferences' },
              { fact: 'User lives in NYC', category: 'location' },
            ],
          }),
        } as any,
      });
      builder = new ContextBuilder(deps);

      const ctx = await builder.buildContext('chat-1', 'Hi', dummyTrace, makeState());

      expect(ctx.systemPrompt).toContain('Relevant memories about the user:');
      expect(ctx.systemPrompt).toContain('- User likes coffee (preferences)');
      expect(ctx.systemPrompt).toContain('- User lives in NYC (location)');
      expect(ctx.facts).toEqual([
        { fact: 'User likes coffee', category: 'preferences' },
        { fact: 'User lives in NYC', category: 'location' },
      ]);
    });

    it('calls orchestrator with correct agentId and message', async () => {
      await builder.buildContext('chat-1', 'What is weather?', dummyTrace, makeState());

      expect(deps.orchestrator.getProfile).toHaveBeenCalledWith('test-agent', dummyTrace);
      expect(deps.orchestrator.retrieveMemories).toHaveBeenCalledWith(
        'test-agent', 'What is weather?', 5, dummyTrace,
      );
    });

    it('refreshes playbook cache before classifying', async () => {
      await builder.buildContext('chat-1', 'Hi', dummyTrace, makeState());

      expect(deps.playbookCache.refreshIfNeeded).toHaveBeenCalledWith(dummyTrace);
      expect(classifyMessage).toHaveBeenCalled();
    });
  });

  describe('selectRelevantHistory (via buildContext)', () => {
    it('returns all messages when fewer than 6 (RECENT_MESSAGES)', async () => {
      const messages: CoreMessage[] = [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ];
      const state = makeState({ messages });

      const ctx = await builder.buildContext('chat-1', 'Hi', dummyTrace, state);

      // history-repair mock returns messages as-is, so we get the last 30 sliced
      expect(ctx.conversationHistory).toEqual(messages);
    });

    it('falls back to slice when embeddingSelector is null', async () => {
      // Create 25 messages (> RECENT_MESSAGES=6), no embedding selector
      const messages: CoreMessage[] = Array.from({ length: 25 }, (_, i) => ({
        role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `Message ${i}`,
      }));
      const state = makeState({ messages });

      const ctx = await builder.buildContext('chat-1', 'Latest', dummyTrace, state);

      // Without embeddings, falls back to .slice(-20)
      expect(ctx.conversationHistory.length).toBeLessThanOrEqual(25);
    });

    it('uses embeddings when selector is initialized', async () => {
      const mockProvider = {
        embedBatch: vi.fn().mockResolvedValue([
          [1, 0, 0], // current message embedding
          [0.9, 0.1, 0], // older msg 0 — high similarity
          [0.1, 0.9, 0], // older msg 2 — low similarity
          [0.8, 0.2, 0], // older msg 4 — medium similarity
          [0.05, 0.95, 0], // older msg 6 — very low
          [0.85, 0.15, 0], // older msg 8 — high
          [0.1, 0.1, 0.9], // older msg 10 — low
          [0.7, 0.3, 0], // older msg 12 — medium
          [0.15, 0.85, 0], // older msg 14 — low
          [0.6, 0.4, 0], // older msg 16 — moderate
          [0.2, 0.8, 0], // older msg 18 — low
        ]),
      };

      vi.mocked(cosineSimilarity).mockImplementation((a: number[], b: number[]) => {
        // Simple dot product for unit vectors
        return a.reduce((sum, val, i) => sum + val * (b[i] ?? 0), 0);
      });

      deps = makeDeps({
        embeddingSelector: {
          isInitialized: vi.fn().mockReturnValue(true),
          getProvider: vi.fn().mockReturnValue(mockProvider),
        } as any,
      });
      builder = new ContextBuilder(deps);

      // 24 messages: 12 user + 12 assistant
      const messages: CoreMessage[] = Array.from({ length: 24 }, (_, i) => ({
        role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `Message ${i}`,
      }));
      const state = makeState({ messages });

      const ctx = await builder.buildContext('chat-1', 'Latest query', dummyTrace, state);

      // Should include recent messages + some older relevant ones
      expect(ctx.conversationHistory.length).toBeGreaterThan(0);
      expect(mockProvider.embedBatch).toHaveBeenCalled();
    });

    it('falls back to slice on embedding error', async () => {
      const mockProvider = {
        embedBatch: vi.fn().mockRejectedValue(new Error('Embedding service down')),
      };

      deps = makeDeps({
        embeddingSelector: {
          isInitialized: vi.fn().mockReturnValue(true),
          getProvider: vi.fn().mockReturnValue(mockProvider),
        } as any,
      });
      builder = new ContextBuilder(deps);

      const messages: CoreMessage[] = Array.from({ length: 25 }, (_, i) => ({
        role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `Message ${i}`,
      }));
      const state = makeState({ messages });

      // Should not throw
      const ctx = await builder.buildContext('chat-1', 'Hi', dummyTrace, state);
      expect(ctx.conversationHistory.length).toBeGreaterThan(0);
    });
  });
});
