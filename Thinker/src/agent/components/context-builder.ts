/**
 * ContextBuilder — assembles the LLM system prompt and conversation history.
 *
 * Extracted from Agent (loop.ts) to isolate prompt construction from message processing.
 */

import type { CoreMessage } from 'ai';
import type { Config } from '../../config.js';
import type { TraceContext } from '../../tracing/types.js';
import type { OrchestratorClient } from '../../orchestrator/client.js';
import type { AgentContext, AgentState } from '../types.js';
import { PlaybookCache } from '../playbook-cache.js';
import { classifyMessage } from '../playbook-classifier.js';
import type { EmbeddingToolSelector } from '../embedding-tool-selector.js';
import { repairConversationHistory, truncateHistoryToolResults } from '../history-repair.js';
import { cosineSimilarity } from '@mcp/shared/Embeddings/math.js';
import { Logger } from '@mcp/shared/Utils/logger.js';

const logger = new Logger('thinker:context-builder');

export interface ContextBuilderDeps {
  orchestrator: OrchestratorClient;
  config: Config;
  embeddingSelector: EmbeddingToolSelector | null;
  playbookCache: PlaybookCache;
  customSystemPrompt: string | null;
  personaPrompt: string | null;
  defaultSystemPrompt: string;
}

export class ContextBuilder {
  constructor(private deps: ContextBuilderDeps) {}

  /**
   * Build the full agent context for a single message processing turn.
   */
  async buildContext(
    chatId: string,
    userMessage: string,
    trace: TraceContext,
    state: AgentState,
  ): Promise<AgentContext> {
    // Get profile and memories from Orchestrator
    const profile = await this.deps.orchestrator.getProfile(this.deps.config.thinkerAgentId, trace);
    const memories = await this.deps.orchestrator.retrieveMemories(
      this.deps.config.thinkerAgentId,
      userMessage,
      5,
      trace,
    );

    // Build system prompt: persona → datetime → chat_id → compaction → playbooks → skills → memories
    const basePrompt =
      this.deps.customSystemPrompt || this.deps.personaPrompt || this.deps.defaultSystemPrompt;
    let systemPrompt = basePrompt;

    if (profile?.profile_data?.persona?.system_prompt) {
      systemPrompt = profile.profile_data.persona.system_prompt;
    }

    // Add current date/time context
    const now = new Date();
    const tz = this.deps.config.userTimezone;
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    systemPrompt += `\n\n## Current Date & Time\n${formatter.format(now)} (${tz})`;

    // Inject chat context so the LLM uses the correct chat_id in tool calls
    systemPrompt += `\n\n## Current Chat\nchat_id: ${chatId}`;

    // Inject compaction summary from previous conversation context
    if (state.compactionSummary) {
      systemPrompt += `\n\n## Previous Conversation Context\n${state.compactionSummary}`;
    }

    // Inject matching domain playbooks (closer to end for recency attention)
    await this.deps.playbookCache.refreshIfNeeded(trace);
    const matchedPlaybooks = classifyMessage(userMessage, this.deps.playbookCache.getPlaybooks());
    const playbookRequiredTools: string[] = [];
    if (matchedPlaybooks.length > 0) {
      const section = matchedPlaybooks
        .map((pb) => `### Playbook: ${pb.name}\n${pb.instructions}`)
        .join('\n\n');
      systemPrompt += `\n\n## Workflow Guidance\nFollow these steps when relevant:\n\n${section}`;
      for (const pb of matchedPlaybooks) {
        playbookRequiredTools.push(...pb.requiredTools);
      }
    }

    // Inject available skills for progressive disclosure (keyword-less file-based skills)
    const descriptionOnlySkills = this.deps.playbookCache.getDescriptionOnlySkills();
    if (descriptionOnlySkills.length > 0) {
      const skillsXml = descriptionOnlySkills
        .map(
          (s) =>
            `  <skill>\n    <name>${s.name}</name>\n    <description>${s.description ?? ''}</description>\n  </skill>`,
        )
        .join('\n');
      systemPrompt += `\n\n<available_skills>\n${skillsXml}\n</available_skills>`;
    }

    // Add memories at the very end (strong recency attention)
    if (memories.facts.length > 0) {
      const factsText = memories.facts
        .map((f) => `- ${f.fact} (${f.category})`)
        .join('\n');
      systemPrompt += `\n\nRelevant memories about the user:\n${factsText}`;
    }

    const promptChars = systemPrompt.length;
    logger.info(`[prompt-size] System prompt: ~${Math.ceil(promptChars / 4)} tokens (${promptChars} chars)`);

    return {
      systemPrompt,
      conversationHistory: truncateHistoryToolResults(
        repairConversationHistory(
          await this.selectRelevantHistory(userMessage, state.messages.slice(-30)),
        ),
        2,
      ),
      facts: memories.facts.map((f) => ({ fact: f.fact, category: f.category })),
      profile: profile?.profile_data?.persona
        ? {
            name: profile.profile_data.persona.name,
            style: profile.profile_data.persona.style,
            tone: profile.profile_data.persona.tone,
          }
        : null,
      playbookRequiredTools,
    };
  }

  /**
   * Select the most relevant conversation history messages using embedding similarity.
   * Falls back to recency-based selection when embeddings are unavailable.
   */
  private async selectRelevantHistory(
    userMessage: string,
    allMessages: CoreMessage[],
  ): Promise<CoreMessage[]> {
    const RECENT_EXCHANGES = 3;
    const RECENT_MESSAGES = RECENT_EXCHANGES * 2;
    const MAX_TOTAL = 20;
    const threshold = Number(process.env.HISTORY_RELEVANCE_THRESHOLD) || 0.45;

    if (allMessages.length <= RECENT_MESSAGES) {
      return allMessages;
    }

    if (!this.deps.embeddingSelector?.isInitialized()) {
      return allMessages.slice(-MAX_TOTAL);
    }

    const provider = this.deps.embeddingSelector.getProvider();

    const olderMessages = allMessages.slice(0, -RECENT_MESSAGES);
    const recentMessages = allMessages.slice(-RECENT_MESSAGES);

    const olderUserTurns: Array<{ text: string; pairStart: number }> = [];
    for (let i = 0; i < olderMessages.length; i++) {
      const msg = olderMessages[i];
      if (msg.role === 'user' && typeof msg.content === 'string') {
        olderUserTurns.push({ text: msg.content, pairStart: i });
      }
    }

    if (olderUserTurns.length === 0) {
      return recentMessages.slice(-MAX_TOTAL);
    }

    try {
      const textsToEmbed = [userMessage, ...olderUserTurns.map((t) => t.text)];
      const embeddings = await provider.embedBatch(textsToEmbed);
      const currentEmbedding = embeddings[0];

      const scored: Array<{ pairStart: number; score: number }> = [];
      for (let i = 0; i < olderUserTurns.length; i++) {
        const score = cosineSimilarity(currentEmbedding, embeddings[i + 1]);
        if (score >= threshold) {
          scored.push({ pairStart: olderUserTurns[i].pairStart, score });
        }
      }

      scored.sort((a, b) => b.score - a.score);

      const budget = MAX_TOTAL - recentMessages.length;
      const selectedOlderMessages: CoreMessage[] = [];

      for (const { pairStart } of scored) {
        if (selectedOlderMessages.length >= budget) break;
        selectedOlderMessages.push(olderMessages[pairStart]);
        if (pairStart + 1 < olderMessages.length) {
          selectedOlderMessages.push(olderMessages[pairStart + 1]);
        }
      }

      selectedOlderMessages.sort((a, b) => {
        const idxA = olderMessages.indexOf(a);
        const idxB = olderMessages.indexOf(b);
        return idxA - idxB;
      });

      const result = [...selectedOlderMessages, ...recentMessages];

      logger.info(
        `[history-select] Selected ${result.length}/${allMessages.length} messages ` +
          `(${scored.length} relevant older exchanges, threshold=${threshold})`,
      );

      return result;
    } catch (error) {
      logger.warn('[history-select] Embedding failed, falling back to slice:', error);
      return allMessages.slice(-MAX_TOTAL);
    }
  }
}
