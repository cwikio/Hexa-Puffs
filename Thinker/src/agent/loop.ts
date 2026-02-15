import { readFile } from 'fs/promises';
import { resolve, join } from 'path';
import { homedir } from 'os';
import { generateText, type CoreMessage, type CoreTool } from 'ai';
import type { LanguageModelV1 } from 'ai';
import type { Config } from '../config.js';
import type { TraceContext } from '../tracing/types.js';
import { createTrace, getTraceDuration } from '../tracing/context.js';
import { getTraceLogger } from '../tracing/logger.js';
import { OrchestratorClient } from '../orchestrator/client.js';
import { createEssentialTools, createToolsFromOrchestrator } from '../orchestrator/tools.js';
import { ModelFactory } from '../llm/factory.js';
import { sanitizeResponseText } from '../utils/sanitize.js';
import { CostMonitor } from '../cost/index.js';
import type { CostStatus } from '../cost/types.js';
import { SessionStore } from '../session/index.js';
import type { IncomingMessage, ProcessingResult, AgentContext, AgentState } from './types.js';
import { PlaybookCache } from './playbook-cache.js';
import { classifyMessage } from './playbook-classifier.js';
import { seedPlaybooks } from './playbook-seed.js';
import { selectToolsWithFallback, CORE_TOOL_NAMES } from './tool-selection.js';
import { TOOL_GROUPS } from './tool-selector.js';
import { EmbeddingToolSelector } from './embedding-tool-selector.js';
import { createEmbeddingProviderFromEnv } from './embedding-config.js';
import { extractFactsFromConversation, loadExtractionPromptTemplate } from './fact-extractor.js';
import { detectLeakedToolCall, recoverLeakedToolCall } from '../utils/recover-tool-call.js';
import { repairConversationHistory, truncateHistoryToolResults } from './history-repair.js';
import { cosineSimilarity } from '@mcp/shared/Embeddings/math.js';
import { Logger } from '@mcp/shared/Utils/logger.js';

const logger = new Logger('thinker:agent');

const STICKY_TOOLS_LOOKBACK = parseInt(process.env.THINKER_STICKY_TOOLS_LOOKBACK ?? '3', 10);
const STICKY_TOOLS_MAX = parseInt(process.env.THINKER_STICKY_TOOLS_MAX ?? '8', 10);

/**
 * Extract text from a CoreMessage content field.
 *
 * Assistant messages from the Vercel AI SDK may store content as a string
 * (plain text) or an array of content blocks (text + tool-call parts).
 * Returns null when there is no meaningful text.
 */
function extractMessageText(content: CoreMessage['content']): string | null {
  if (typeof content === 'string') return content || null;
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const part of content) {
      if (
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        part.type === 'text' &&
        'text' in part
      ) {
        const t = (part as { type: 'text'; text: string }).text;
        if (t) texts.push(t);
      }
    }
    return texts.length > 0 ? texts.join('\n') : null;
  }
  return null;
}

/**
 * Walk a CoreMessage array and return properly-paired user/assistant text
 * turns. For each user message, captures the last assistant text before the
 * next user message, so multi-step tool-calling flows collapse into a single
 * turn with the final answer. Only emits complete pairs.
 */
function extractTextTurns(
  messages: CoreMessage[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const result: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let pendingUser: string | null = null;
  let lastAssistantText: string | null = null;

  for (const m of messages) {
    if (m.role === 'user') {
      // Flush previous complete turn
      if (pendingUser !== null && lastAssistantText !== null) {
        result.push({ role: 'user', content: pendingUser });
        result.push({ role: 'assistant', content: lastAssistantText });
      }
      pendingUser = extractMessageText(m.content) ?? '';
      lastAssistantText = null;
    } else if (m.role === 'assistant') {
      const text = extractMessageText(m.content);
      if (text) lastAssistantText = text;
    }
    // Skip 'system' and 'tool' messages
  }

  // Flush final complete turn
  if (pendingUser !== null && lastAssistantText !== null) {
    result.push({ role: 'user', content: pendingUser });
    result.push({ role: 'assistant', content: lastAssistantText });
  }

  return result;
}

/**
 * Default system prompt for the agent (used when no persona file is loaded)
 */
const DEFAULT_SYSTEM_PROMPT = `You are Annabelle, a helpful AI assistant communicating via Telegram.

Be friendly, concise, and conversational. Keep responses short — this is a chat, not an essay.`;

/**
 * Agent that processes messages using ReAct pattern
 */
export class Agent {
  private config: Config;
  private orchestrator: OrchestratorClient;
  private modelFactory: ModelFactory;
  private tools: Record<string, CoreTool> = {};
  private conversationStates: Map<string, AgentState> = new Map();
  private currentTrace: TraceContext | undefined;
  private currentChatId: string | undefined;
  private logger = getTraceLogger();
  private playbookCache: PlaybookCache;
  private customSystemPrompt: string | null = null;
  private personaPrompt: string | null = null;
  private defaultSystemPrompt: string = DEFAULT_SYSTEM_PROMPT;

  // Rate limiting
  private lastApiCallTime = 0;
  private minApiCallIntervalMs = 1000; // 1 second minimum between calls

  // Circuit breaker
  private consecutiveErrors = 0;
  private maxConsecutiveErrors = 5;
  private circuitBreakerTripped = false;

  // Cost controls
  private costMonitor: CostMonitor | null = null;

  // Session persistence
  private sessionStore: SessionStore;

  // Embedding-based tool selector (null = disabled, use regex fallback)
  private embeddingSelector: EmbeddingToolSelector | null = null;

  // Post-conversation fact extraction idle timers (per chatId)
  private extractionTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: Config) {
    this.config = config;
    this.orchestrator = new OrchestratorClient(config);
    this.modelFactory = new ModelFactory(config);
    const resolvedSkillsDir = config.skillsDir.replace(/^~/, homedir());
    this.playbookCache = new PlaybookCache(this.orchestrator, config.thinkerAgentId, resolvedSkillsDir);
    this.sessionStore = new SessionStore(
      config.sessionsDir,
      config.thinkerAgentId,
      config.sessionConfig
    );

    // Initialize cost monitor if enabled
    if (config.costControl?.enabled) {
      this.costMonitor = new CostMonitor(config.costControl);
      logger.info(`Cost monitor enabled (spike: ${config.costControl.spikeMultiplier}x, hard cap: ${config.costControl.hardCapTokensPerHour} tokens/hr)`);
    }

    if (config.sessionConfig.enabled) {
      logger.info(`Session persistence enabled (dir: ${config.sessionsDir}, compaction: ${config.sessionConfig.compactionEnabled})`);
    }

    if (config.factExtraction.enabled) {
      logger.info(`Fact extraction enabled (idle: ${config.factExtraction.idleMs / 1000}s, maxTurns: ${config.factExtraction.maxTurns})`);
    }
  }

  /**
   * Initialize the agent - discover tools, etc.
   */
  async initialize(): Promise<void> {
    logger.info('Initializing agent...');

    // Load custom system prompt from file if configured
    if (this.config.systemPromptPath) {
      try {
        this.customSystemPrompt = await readFile(this.config.systemPromptPath, 'utf-8');
        logger.info(`Loaded custom system prompt from ${this.config.systemPromptPath} (${this.customSystemPrompt.length} chars)`);
      } catch (error) {
        logger.error(`Failed to load system prompt from ${this.config.systemPromptPath}:`, error);
        // Fall through to DEFAULT_SYSTEM_PROMPT
      }
    }

    // Load persona file from ~/.annabelle/agents/{agentId}/instructions.md
    const personaDir = this.config.personaDir.replace(/^~/, homedir());
    const personaPath = resolve(personaDir, this.config.thinkerAgentId, 'instructions.md');
    try {
      this.personaPrompt = await readFile(personaPath, 'utf-8');
      logger.info(`Loaded persona from ${personaPath} (${this.personaPrompt.length} chars)`);
    } catch {
      logger.info(`No persona file at ${personaPath}, using defaults`);
    }

    // Load default system prompt from file (shipped with package or configured via env)
    const defaultPromptPath = this.config.defaultSystemPromptPath
      ?? resolve(import.meta.dirname, '../../prompts/default-system-prompt.md');
    try {
      const loaded = await readFile(defaultPromptPath, 'utf-8');
      if (loaded.trim().length > 0) {
        this.defaultSystemPrompt = loaded.trim();
        logger.info(`Loaded default system prompt from ${defaultPromptPath} (${this.defaultSystemPrompt.length} chars)`);
      }
    } catch {
      logger.info(`No default system prompt file at ${defaultPromptPath}, using built-in fallback`);
    }

    // Load fact extraction prompt template (non-fatal)
    if (this.config.factExtraction.enabled) {
      await loadExtractionPromptTemplate(this.config.factExtractionPromptPath);
    }

    // Check Orchestrator health
    const healthy = await this.orchestrator.healthCheck();
    if (!healthy) {
      logger.warn('Warning: Orchestrator is not healthy. Some features may not work.');
    }

    // Discover tools from Orchestrator
    const orchestratorTools = await this.orchestrator.discoverTools();
    logger.info(`Discovered ${orchestratorTools.length} tools from Orchestrator`);

    // Create tools from Orchestrator
    const getChatId = () => this.currentChatId || this.config.defaultNotifyChatId;
    const dynamicTools = createToolsFromOrchestrator(
      orchestratorTools,
      this.orchestrator,
      () => this.currentTrace,
      getChatId,
    );

    // Create essential tools
    const essentialTools = createEssentialTools(
      this.orchestrator,
      this.config.thinkerAgentId,
      () => this.currentTrace,
      getChatId,
    );

    // Merge tools (essential tools override dynamic ones)
    this.tools = { ...dynamicTools, ...essentialTools };

    logger.info(`Total tools available: ${Object.keys(this.tools).length}`);

    // Initialize embedding-based tool selector (non-fatal if it fails)
    try {
      const provider = createEmbeddingProviderFromEnv();
      if (provider) {
        const cacheDir = (this.config.embeddingCacheDir ?? '~/.annabelle/data').replace(/^~/, homedir());
        this.embeddingSelector = new EmbeddingToolSelector(provider, {
          similarityThreshold: Number(process.env.TOOL_SELECTOR_THRESHOLD) || 0.3,
          topK: Number(process.env.TOOL_SELECTOR_TOP_K) || 15,
          minTools: Number(process.env.TOOL_SELECTOR_MIN_TOOLS) || 5,
          cachePath: join(cacheDir, 'embedding-cache.json'),
          providerName: process.env.EMBEDDING_PROVIDER || 'ollama',
          modelName: process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text',
        });
        await this.embeddingSelector.initialize(this.tools);
      }
    } catch (error) {
      logger.warn('Failed to initialize embedding tool selector (non-fatal):', error);
      this.embeddingSelector = null;
    }

    // Seed default playbooks (idempotent) and initialize cache
    try {
      await seedPlaybooks(this.orchestrator, this.config.thinkerAgentId);
      await this.playbookCache.initialize();
      logger.info(`Playbook cache loaded: ${this.playbookCache.getPlaybooks().length} playbook(s)`);
    } catch (error) {
      logger.warn('Failed to initialize playbooks (non-fatal):', error);
    }
  }

  /**
   * Re-discover tools from Orchestrator and re-initialize the embedding selector
   * when the tool set changes. Uses getCachedToolsOrRefresh() which has a 10-min
   * TTL, so this is a no-op on most calls.
   */
  private async refreshToolsIfNeeded(): Promise<void> {
    try {
      const freshOrchestratorTools = await this.orchestrator.getCachedToolsOrRefresh();
      const currentNames = new Set(Object.keys(this.tools));

      // Always rebuild (cheap) so essential tools stay current
      const getChatId = () => this.currentChatId || this.config.defaultNotifyChatId;
      const dynamicTools = createToolsFromOrchestrator(
        freshOrchestratorTools,
        this.orchestrator,
        () => this.currentTrace,
        getChatId,
      );
      const essentialTools = createEssentialTools(
        this.orchestrator,
        this.config.thinkerAgentId,
        () => this.currentTrace,
        getChatId,
      );
      this.tools = { ...dynamicTools, ...essentialTools };

      // Compare rebuilt set against previous set to detect real changes
      const rebuiltNames = new Set(Object.keys(this.tools));
      if (rebuiltNames.size === currentNames.size && [...rebuiltNames].every(n => currentNames.has(n))) {
        return; // no real change
      }

      const added = [...rebuiltNames].filter(n => !currentNames.has(n));
      const removed = [...currentNames].filter(n => !rebuiltNames.has(n));
      logger.info(`Tool set changed: +${added.length} added, -${removed.length} removed`);
      if (added.length > 0) logger.info(`  Added: ${added.join(', ')}`);
      if (removed.length > 0) logger.info(`  Removed: ${removed.join(', ')}`);

      // Re-initialize embedding selector (cache makes this fast for existing tools)
      if (this.embeddingSelector) {
        await this.embeddingSelector.initialize(this.tools);
      }
    } catch (error) {
      logger.warn('refreshToolsIfNeeded failed (non-fatal):', error);
    }
  }

  /**
   * Get or create conversation state for a chat.
   * On cache miss, attempts to load from disk (session JSONL file).
   */
  private async getConversationState(chatId: string): Promise<AgentState> {
    let state = this.conversationStates.get(chatId);
    if (state) {
      state.lastActivity = Date.now();
      return state;
    }

    // Try loading from disk
    let messages: CoreMessage[] = [];
    let compactionSummary: string | undefined;
    let recentToolsByTurn: Array<{ turnIndex: number; tools: string[] }> = [];

    if (this.config.sessionConfig.enabled) {
      try {
        const saved = await this.sessionStore.loadSession(chatId, STICKY_TOOLS_LOOKBACK);
        if (saved) {
          messages = saved.messages;
          compactionSummary = saved.compactionSummary;
          recentToolsByTurn = saved.recentToolsByTurn;
          logger.info(`Restored session ${chatId} from disk (${saved.turnCount} turns${compactionSummary ? ', with compaction summary' : ''})`);
        }
      } catch (error) {
        logger.warn(`Failed to load session ${chatId} from disk:`, error);
      }
    }

    state = {
      chatId,
      messages,
      lastActivity: Date.now(),
      compactionSummary,
      recentToolsByTurn,
    };
    this.conversationStates.set(chatId, state);
    return state;
  }

  /**
   * Select relevant history messages using embedding similarity.
   * Always includes the last 3 exchanges (6 messages) for recency.
   * Older messages are scored by cosine similarity to the current message
   * and included if above threshold. Cap total at 20 messages.
   */
  private async selectRelevantHistory(
    userMessage: string,
    allMessages: CoreMessage[],
  ): Promise<CoreMessage[]> {
    const RECENT_EXCHANGES = 3; // always include last N exchanges
    const RECENT_MESSAGES = RECENT_EXCHANGES * 2;
    const MAX_TOTAL = 20;
    const threshold = Number(process.env.HISTORY_RELEVANCE_THRESHOLD) || 0.45;

    // If we don't have enough messages to bother filtering, return all
    if (allMessages.length <= RECENT_MESSAGES) {
      return allMessages;
    }

    // Check if embedding provider is available
    if (!this.embeddingSelector?.isInitialized()) {
      // Fallback: just return the last 20
      return allMessages.slice(-MAX_TOTAL);
    }

    const provider = this.embeddingSelector.getProvider();

    // Split into older candidates and guaranteed recent
    const olderMessages = allMessages.slice(0, -RECENT_MESSAGES);
    const recentMessages = allMessages.slice(-RECENT_MESSAGES);

    // Extract user-turn texts from older messages with their indices
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
      // Embed current message and all older user turns in one batch
      const textsToEmbed = [userMessage, ...olderUserTurns.map(t => t.text)];
      const embeddings = await provider.embedBatch(textsToEmbed);
      const currentEmbedding = embeddings[0];

      // Score each older user turn
      const scored: Array<{ pairStart: number; score: number }> = [];
      for (let i = 0; i < olderUserTurns.length; i++) {
        const score = cosineSimilarity(currentEmbedding, embeddings[i + 1]);
        if (score >= threshold) {
          scored.push({ pairStart: olderUserTurns[i].pairStart, score });
        }
      }

      // Sort by score descending, then pick top ones within budget
      scored.sort((a, b) => b.score - a.score);

      // Budget: how many older messages can we include
      const budget = MAX_TOTAL - recentMessages.length;
      const selectedOlderMessages: CoreMessage[] = [];

      for (const { pairStart } of scored) {
        if (selectedOlderMessages.length >= budget) break;

        // Include the user message and the next message (assistant response) as a pair
        selectedOlderMessages.push(olderMessages[pairStart]);
        if (pairStart + 1 < olderMessages.length) {
          selectedOlderMessages.push(olderMessages[pairStart + 1]);
        }
      }

      // Sort selected older messages by original index to maintain chronological order
      // (they're already in order from the original array since pairStart is monotonic within scored)
      // Actually, scored is sorted by score — re-sort by pairStart
      selectedOlderMessages.sort((a, b) => {
        const idxA = olderMessages.indexOf(a);
        const idxB = olderMessages.indexOf(b);
        return idxA - idxB;
      });

      const result = [...selectedOlderMessages, ...recentMessages];

      logger.info(
        `[history-select] Selected ${result.length}/${allMessages.length} messages ` +
        `(${scored.length} relevant older exchanges, threshold=${threshold})`
      );

      return result;
    } catch (error) {
      logger.warn('[history-select] Embedding failed, falling back to slice:', error);
      return allMessages.slice(-MAX_TOTAL);
    }
  }

  /**
   * Build context for agent processing
   */
  private async buildContext(
    chatId: string,
    userMessage: string,
    trace: TraceContext
  ): Promise<AgentContext> {
    const state = await this.getConversationState(chatId);

    // Get profile and memories from Orchestrator
    const profile = await this.orchestrator.getProfile(this.config.thinkerAgentId, trace);
    const memories = await this.orchestrator.retrieveMemories(
      this.config.thinkerAgentId,
      userMessage,
      5,
      trace
    );

    await this.logger.logContextLoaded(trace, memories.facts.length, !!profile);

    // Build system prompt: persona → datetime → chat_id → compaction → playbooks → skills → memories
    // Tool calling rules are in the persona file (instructions.md) — single source of truth.
    const basePrompt = this.customSystemPrompt || this.personaPrompt || this.defaultSystemPrompt;
    let systemPrompt = basePrompt;

    if (profile?.profile_data?.persona?.system_prompt) {
      systemPrompt = profile.profile_data.persona.system_prompt;
    }

    // Add current date/time context
    const now = new Date();
    const tz = this.config.userTimezone;
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
    await this.playbookCache.refreshIfNeeded(trace);
    const matchedPlaybooks = classifyMessage(userMessage, this.playbookCache.getPlaybooks());
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
    const descriptionOnlySkills = this.playbookCache.getDescriptionOnlySkills();
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
          await this.selectRelevantHistory(userMessage, state.messages.slice(-30))
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
   * Process a single message
   */
  async processMessage(message: IncomingMessage): Promise<ProcessingResult> {
    const trace = createTrace('thinker');
    this.currentTrace = trace;
    this.currentChatId = message.chatId;

    await this.logger.logMessageReceived(trace, message.chatId, message.text);

    const state = await this.getConversationState(message.chatId);
    const providerInfo = this.modelFactory.getProviderInfo();

    try {
      // Circuit breaker check
      if (this.circuitBreakerTripped) {
        logger.warn('Circuit breaker is tripped - skipping message processing');
        return {
          success: false,
          toolsUsed: [],
          totalSteps: 0,
          error: 'Circuit breaker tripped - too many consecutive errors',
        };
      }

      // Cost control pause check
      if (this.costMonitor?.paused) {
        logger.warn('Agent paused by cost controls - skipping message processing');
        return {
          success: false,
          toolsUsed: [],
          totalSteps: 0,
          error: `Agent paused: ${this.costMonitor.pauseReason || 'cost limit exceeded'}`,
          paused: true,
        };
      }

      // Rate limiting - ensure minimum interval between API calls
      const now = Date.now();
      const timeSinceLastCall = now - this.lastApiCallTime;
      if (timeSinceLastCall < this.minApiCallIntervalMs) {
        await new Promise((r) => setTimeout(r, this.minApiCallIntervalMs - timeSinceLastCall));
      }
      this.lastApiCallTime = Date.now();

      // Check for tool changes (uses TTL-cached Orchestrator call — fast no-op most of the time)
      await this.refreshToolsIfNeeded();

      // Build context
      const context = await this.buildContext(message.chatId, message.text, trace);

      // Add user message to conversation
      state.messages.push({
        role: 'user',
        content: message.text,
      });

      // Log LLM call start
      await this.logger.logLLMCallStart(trace, providerInfo.provider, providerInfo.model);
      const llmStartTime = Date.now();

      // Generate response using ReAct pattern (no retries to prevent runaway costs)
      // 90s timeout leaves buffer within ThinkerClient's 120s limit
      const agentAbort = AbortSignal.timeout(90_000);
      const selectedTools = await selectToolsWithFallback(message.text, this.tools, this.embeddingSelector, this.orchestrator.getMCPMetadata());

      // Force-include tools required by matched playbooks (they may have been dropped by the tool cap)
      if (selectedTools && context.playbookRequiredTools.length > 0) {
        let injected = 0;
        for (const name of context.playbookRequiredTools) {
          if (!selectedTools[name] && this.tools[name]) {
            selectedTools[name] = this.tools[name];
            injected++;
          } else if (!this.tools[name]) {
            logger.warn(`[playbook-tools] Required tool '${name}' not found (MCP may be down)`);
          }
        }
        if (injected > 0) {
          logger.info(`[playbook-tools] Injected ${injected} required tool(s) from matched playbook(s)`);
        }
      }

      // Sticky tools: inject tools used in recent turns so follow-up messages
      // ("what about the other one?") can still call them even when the embedding
      // selector doesn't match them for the current message.
      // Also injects sibling tools from the same group — e.g. if gmail_list_emails
      // was used, gmail_get_email is also injected for full-content follow-ups.
      if (state.recentToolsByTurn.length > 0) {
        const coreSet = new Set(CORE_TOOL_NAMES);
        const allToolNames = Object.keys(this.tools);
        const stickyNames: string[] = [];

        // Collect exact tools used in recent turns (newest first)
        const usedNames: string[] = [];
        for (let i = state.recentToolsByTurn.length - 1; i >= 0; i--) {
          for (const name of state.recentToolsByTurn[i].tools) {
            if (!coreSet.has(name) && !usedNames.includes(name)) {
              usedNames.push(name);
            }
          }
        }

        // Expand to group siblings: find groups each used tool belongs to,
        // then include all tools from those groups.
        const siblingGroups = new Set<string>();
        for (const usedName of usedNames) {
          for (const [groupName, patterns] of Object.entries(TOOL_GROUPS)) {
            if (groupName === 'core') continue;
            for (const pattern of patterns) {
              if (pattern.includes('*')) {
                const re = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
                if (re.test(usedName)) siblingGroups.add(groupName);
              } else if (pattern === usedName) {
                siblingGroups.add(groupName);
              }
            }
          }
        }

        // Add exact used tools first, then sibling tools
        for (const name of usedNames) {
          if (!selectedTools[name] && this.tools[name] && !stickyNames.includes(name)) {
            stickyNames.push(name);
          }
        }
        for (const groupName of siblingGroups) {
          const patterns = TOOL_GROUPS[groupName];
          if (!patterns) continue;
          for (const pattern of patterns) {
            const expanded = pattern.includes('*')
              ? allToolNames.filter(n => new RegExp(`^${pattern.replace(/\*/g, '.*')}$`).test(n))
              : [pattern];
            for (const name of expanded) {
              if (!selectedTools[name] && this.tools[name] && !coreSet.has(name) && !stickyNames.includes(name)) {
                stickyNames.push(name);
              }
            }
          }
        }

        const toInject = stickyNames.slice(0, STICKY_TOOLS_MAX);
        for (const name of toInject) {
          selectedTools[name] = this.tools[name];
        }
        if (toInject.length > 0) {
          logger.info(`[sticky-tools] Injected ${toInject.length} tool(s) from recent turns: ${toInject.join(', ')}`);
        }
      }

      let result;
      let usedTextOnlyFallback = false;

      // Lower temperature when tool selector strongly matches — improves tool calling reliability
      const selectionStats = this.embeddingSelector?.getLastSelectionStats();
      const effectiveTemperature = (selectionStats?.topScore ?? 0) > 0.6
        ? Math.min(this.config.temperature, 0.3)
        : this.config.temperature;

      // Tool choice: always 'auto' for multi-step calls.
      // 'required' forces tool calls on EVERY step, which crashes Groq/Llama on step 2+
      // when the model wants to respond with text (summarize results) instead of calling another tool.
      // Playbook instructions, system prompt, and embedding-selected tools provide sufficient guidance
      // for the model to call tools on step 1 without forcing it.
      const embeddingScore = selectionStats?.topScore ?? 0;
      const effectiveToolChoice = 'auto' as const;
      logger.info(`[tool-enforcement] toolChoice=auto (embeddingScore=${embeddingScore.toFixed(3)})`);

      // Capture completed steps via onStepFinish so we can recover tool results
      // if generateText() fails mid-loop (e.g., tools execute but the follow-up LLM call errors)
      interface CapturedStep {
        toolCalls: Array<{ toolCallId: string; toolName: string; args: unknown }>;
        toolResults: Array<{ toolCallId: string; toolName: string; result: unknown }>;
        text: string;
      }
      const capturedSteps: CapturedStep[] = [];
      const onStepFinish = (step: CapturedStep) => { capturedSteps.push(step); };

      // Convert captured steps into CoreMessage pairs (assistant tool-call + tool result)
      // so retries can continue from where the previous attempt left off
      const buildRetryMessages = (stepsCount: number, userText?: string, errorContext?: string): CoreMessage[] => {
        const msgs: CoreMessage[] = [
          ...context.conversationHistory,
          { role: 'user' as const, content: userText ?? message.text },
        ];
        if (errorContext) {
          msgs.push({ role: 'assistant' as const, content: errorContext });
          msgs.push({ role: 'user' as const, content: 'Please try again using only the tools available to you.' });
        }
        for (let i = 0; i < stepsCount; i++) {
          const step = capturedSteps[i];
          if (step.toolCalls.length > 0) {
            msgs.push({
              role: 'assistant' as const,
              content: step.toolCalls.map(tc => ({
                type: 'tool-call' as const,
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                args: tc.args as Record<string, unknown>,
              })),
            });
            msgs.push({
              role: 'tool' as const,
              content: step.toolResults.map(tr => ({
                type: 'tool-result' as const,
                toolCallId: tr.toolCallId,
                toolName: tr.toolName,
                result: tr.result,
              })),
            });
          }
        }
        return msgs;
      };

      try {
        result = await generateText({
          model: this.modelFactory.getModel(),
          system: context.systemPrompt,
          messages: [...context.conversationHistory, { role: 'user', content: message.text }],
          tools: selectedTools,
          toolChoice: effectiveToolChoice,
          maxSteps: 8,
          temperature: effectiveTemperature,
          abortSignal: agentAbort,
          onStepFinish,
        });
      } catch (toolError) {
        // If function calling fails (malformed JSON from model), retry with tools once, then fallback
        const toolErrorMsg = toolError instanceof Error ? toolError.message : '';
        const isToolCallError =
          toolErrorMsg.includes('Failed to call a function') ||
          toolErrorMsg.includes('failed_generation') ||
          toolErrorMsg.includes('tool call validation failed') ||
          toolErrorMsg.includes('maximum number of items');
        if (isToolCallError) {
          logger.warn(`Tool call failed, retrying once with tools: ${toolErrorMsg}`);

          try {
            // First retry: include captured step results so the model continues from where it left off
            // instead of repeating the same tool calls from scratch.
            // Also inject the error message so the model knows what went wrong.
            const stepsSnapshot = capturedSteps.length;
            if (stepsSnapshot > 0) {
              logger.info(`[retry] Including ${stepsSnapshot} captured step(s) in retry context`);
            }
            const errorHint = toolErrorMsg.includes('was not in request.tools')
              ? `I tried to call a tool that doesn't exist: ${toolErrorMsg}. I need to use only the tools provided to me.`
              : undefined;
            const retryTemp = Math.min((this.config.temperature ?? 0.7) + 0.1, 1.0);
            result = await generateText({
              model: this.modelFactory.getModel(),
              system: context.systemPrompt,
              messages: buildRetryMessages(stepsSnapshot, undefined, errorHint),
              tools: selectedTools,
              toolChoice: 'auto',
              maxSteps: 4,
              temperature: retryTemp,
              abortSignal: agentAbort,
              onStepFinish,
            });
          } catch (retryError) {
            const retryErrorMsg = retryError instanceof Error ? retryError.message : '';
            logger.warn(`Tool retry failed: ${retryErrorMsg}`);

            // Second retry: rephrase the message with explicit context from the last assistant turn
            const lastAssistantMsg = context.conversationHistory
              .filter((m) => m.role === 'assistant')
              .at(-1);
            if (lastAssistantMsg && typeof lastAssistantMsg.content === 'string') {
              const rephrasedText = `Context from the previous response: "${lastAssistantMsg.content.substring(0, 300)}"\n\nThe user is now asking: ${message.text}`;
              try {
                const stepsSnapshot2 = capturedSteps.length;
                logger.warn(`Trying rephrased message with tools (${stepsSnapshot2} prior steps)...`);
                const retryTemp2 = Math.min((this.config.temperature ?? 0.7) + 0.1, 1.0);
                result = await generateText({
                  model: this.modelFactory.getModel(),
                  system: context.systemPrompt,
                  messages: buildRetryMessages(stepsSnapshot2, rephrasedText),
                  tools: selectedTools,
                  toolChoice: 'auto',
                  maxSteps: 4,
                  temperature: retryTemp2,
                  abortSignal: agentAbort,
                  onStepFinish,
                });
              } catch (rephraseError) {
                const rephraseErrorMsg = rephraseError instanceof Error ? rephraseError.message : '';
                logger.warn(`Rephrased retry also failed, falling back to text-only: ${rephraseErrorMsg}`);
                result = undefined;
              }
            }

            // If retries failed but tools DID execute (captured via onStepFinish),
            // summarize the tool results instead of losing them to text-only fallback
            if (!result && capturedSteps.length > 0) {
              const collectedResults: Array<{ tool: string; result: unknown }> = [];
              for (const step of capturedSteps) {
                if (step.toolCalls?.length && step.toolResults?.length) {
                  for (let j = 0; j < step.toolCalls.length; j++) {
                    const call = step.toolCalls[j];
                    const res = step.toolResults[j];
                    if (res?.result !== undefined && res.result !== null) {
                      collectedResults.push({ tool: call.toolName, result: res.result });
                    }
                  }
                }
              }

              if (collectedResults.length > 0) {
                logger.info(`[tool-recovery] Retries failed but ${collectedResults.length} tool(s) executed — summarizing results`);
                const resultsText = collectedResults
                  .map((r) => {
                    const json = JSON.stringify(r.result);
                    const truncated = json.length > 2000 ? json.substring(0, 2000) + '...(truncated)' : json;
                    return `Tool: ${r.tool}\nResult: ${truncated}`;
                  })
                  .join('\n\n');

                try {
                  result = await generateText({
                    model: this.modelFactory.getModel(),
                    system: 'You are a helpful assistant. The user asked a question and tools were called to get data. Summarize the tool results into a concise, natural response for the user. Do NOT mention tool names or internal mechanics. If the results contain URLs or source links, ALWAYS include them at the end of your response in a "Sources:" section.',
                    messages: [
                      { role: 'user', content: message.text },
                      { role: 'user', content: `Here are the results:\n\n${resultsText}` },
                    ],
                    temperature: this.config.temperature,
                    abortSignal: agentAbort,
                  });
                  logger.info('[tool-recovery] Summarization successful');
                } catch (summaryError) {
                  logger.warn('[tool-recovery] Summarization failed, using raw output:', summaryError);
                  // Build a synthetic result-like object — the raw text will be used as responseText
                  const rawText = collectedResults
                    .map((r) => {
                      const json = JSON.stringify(r.result, null, 2);
                      return json.length > 500 ? json.substring(0, 500) + '...' : json;
                    })
                    .join('\n\n');
                  result = { text: rawText, steps: [], toolCalls: [], toolResults: [], finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, warnings: undefined, response: { id: '', timestamp: new Date(), modelId: '' }, logprobs: undefined, reasoning: undefined, reasoningDetails: [], files: [], sources: [], request: {}, responseMessages: [] } as unknown as typeof result;
                }
              }
            }

            // Final fallback: text-only with improved prompt
            if (!result) {
              const textOnlyPrompt = context.systemPrompt + `

IMPORTANT: Due to a technical issue, your tools are temporarily unavailable for this response.
- First, check the conversation history above — if it already contains relevant data (e.g., search results, email content, etc.), use that information to answer.
- Only say you cannot help if the conversation history has NO relevant context for the question.
- Do NOT pretend you can look something up — be honest that tools are temporarily unavailable if you truly have no data to answer with.`;

              result = await generateText({
                model: this.modelFactory.getModel(),
                system: textOnlyPrompt,
                messages: [...context.conversationHistory, { role: 'user', content: message.text }],
                temperature: this.config.temperature,
                abortSignal: agentAbort,
              });
              usedTextOnlyFallback = true;
            }
          }
        } else {
          throw toolError;
        }
      }

      // Decrement error count on success (don't fully reset — prevents breaker bypass)
      if (this.consecutiveErrors > 0) this.consecutiveErrors--;

      // Log LLM call complete
      const llmDuration = Date.now() - llmStartTime;
      const promptTokens = result.usage?.promptTokens || 0;
      const completionTokens = result.usage?.completionTokens || 0;
      await this.logger.logLLMCallComplete(
        trace,
        providerInfo.provider,
        providerInfo.model,
        promptTokens,
        completionTokens,
        llmDuration
      );

      // Record token usage in cost monitor
      this.costMonitor?.recordUsage(promptTokens, completionTokens);

      // ─── Tool Call Recovery ───────────────────────────────────────
      // Groq/Llama sometimes leaks tool calls as text instead of using
      // structured function calling. Detect and execute when this happens.
      let responseText: string;
      let recoveredTools: string[] = [];

      const shouldAttemptRecovery =
        result.finishReason === 'stop' &&
        (!result.toolCalls || result.toolCalls.length === 0) &&
        result.text;

      if (shouldAttemptRecovery) {
        const leak = detectLeakedToolCall(result.text, selectedTools);
        if (leak.detected) {
          logger.info(`[tool-recovery] Leaked tool detected: ${leak.toolName}`);
          const recovery = await recoverLeakedToolCall(
            leak.toolName,
            leak.parameters,
            selectedTools,
          );
          if (recovery.success) {
            // Extract meaningful response from tool result (e.g. spawn_subagent returns {data: {response: "..."}})
            let toolResponse = '';
            if (recovery.result && typeof recovery.result === 'object') {
              const res = recovery.result as Record<string, unknown>;
              const data = res.data as Record<string, unknown> | undefined;
              if (data?.response && typeof data.response === 'string') {
                toolResponse = data.response;
              }
            }

            if (leak.preamble) {
              responseText = leak.preamble;
            } else if (toolResponse) {
              responseText = toolResponse;
            } else {
              // No preamble or extractable text — ask LLM to summarize the tool result
              try {
                const resultJson = JSON.stringify(recovery.result);
                const truncated = resultJson.length > 2000 ? resultJson.substring(0, 2000) + '...(truncated)' : resultJson;
                const summary = await generateText({
                  model: this.modelFactory.getModel(),
                  system: 'You are a helpful assistant. The user asked a question and a tool was called to get data. Summarize the tool result into a concise, natural response for the user. Do NOT mention tool names or internal mechanics. If the results contain URLs or source links, ALWAYS include them at the end of your response in a "Sources:" section.',
                  messages: [
                    { role: 'user', content: message.text },
                    { role: 'user', content: `Here is the result from ${leak.toolName}:\n\n${truncated}` },
                  ],
                  temperature: this.config.temperature,
                });
                this.costMonitor?.recordUsage(
                  summary.usage?.promptTokens || 0,
                  summary.usage?.completionTokens || 0,
                );
                responseText = summary.text ? sanitizeResponseText(summary.text) : 'Done.';
              } catch (summaryError) {
                logger.warn('[tool-recovery] Summarization failed, using fallback:', summaryError);
                responseText = 'Done.';
              }
            }

            recoveredTools = [leak.toolName];
            logger.info(`[tool-recovery] Recovery successful, response: "${responseText.substring(0, 80)}"`);
          } else {
            logger.warn(`[tool-recovery] Recovery failed: ${recovery.error}`);
            responseText = leak.preamble || 'I tried to do that but ran into an issue. Could you try again?';
          }
        } else {
          responseText = sanitizeResponseText(result.text || '');
        }
      } else {
        // Normal path: sanitize any leaked syntax
        responseText = sanitizeResponseText(result.text || '');
      }

      // ─── Hallucination Guard ────────────────────────────────────────
      // If the model claims it performed an action but called no tools,
      // it hallucinated. Retry with toolChoice: 'required' to force actual tool use.
      const noToolsUsed =
        result.steps.every((step) => !step.toolCalls?.length) &&
        recoveredTools.length === 0;

      if (noToolsUsed && responseText) {
        const actionClaimedPattern =
          /I('ve| have) (created|sent|scheduled|deleted|updated|added|removed|set up|stored|saved|found|searched|looked up|checked|gone ahead)|has been (created|sent|scheduled|deleted|updated|added|removed|stored|saved)|Event details:|Email sent|event .* (created|scheduled)|calendar .* (updated|created)|Here's the email I sent|I've gone ahead and|I searched for|I looked up|I checked your|The results show|I found the following/i;

        if (actionClaimedPattern.test(responseText)) {
          logger.warn(`[hallucination-guard] Model claimed action without tool calls, retrying with toolChoice: required`);
          try {
            const retryResult = await generateText({
              model: this.modelFactory.getModel(),
              system: context.systemPrompt,
              messages: [...context.conversationHistory, { role: 'user', content: message.text }],
              tools: selectedTools,
              toolChoice: 'required' as const,
              maxSteps: 8,
              temperature: Math.min(this.config.temperature, 0.3),
              abortSignal: agentAbort,
              onStepFinish,
            });
            const retryPromptTokens = retryResult.usage?.promptTokens || 0;
            const retryCompletionTokens = retryResult.usage?.completionTokens || 0;
            this.costMonitor?.recordUsage(retryPromptTokens, retryCompletionTokens);

            // Only accept the retry if it actually called tools
            const retryUsedTools = retryResult.steps.some((step) => step.toolCalls?.length > 0);
            if (retryUsedTools) {
              result = retryResult;
              responseText = sanitizeResponseText(result.text || '');
              logger.info(`[hallucination-guard] Retry successful — tools were called`);
            } else {
              logger.warn(`[hallucination-guard] Retry still did not call tools, using original response with disclaimer`);
              responseText = "I wasn't able to complete this action. Please try again.";
            }
          } catch (retryError) {
            logger.warn(`[hallucination-guard] Retry failed:`, retryError);
            responseText = "I wasn't able to complete this action. Please try again.";
          }
        }
      }

      // If no text response but we have tool results, extract text from steps
      // This handles cases where the LLM only emits tool calls without a final text response
      if (responseText === 'I apologize, but I was unable to generate a response.' && result.steps?.length > 0) {
        // First, look for text in any step (check all steps, last to first)
        for (let i = result.steps.length - 1; i >= 0; i--) {
          const step = result.steps[i];
          if (step.text) {
            const sanitized = sanitizeResponseText(step.text);
            if (sanitized !== 'I apologize, but I was unable to generate a response.') {
              responseText = sanitized;
              break;
            }
          }
        }

        // If still no text, collect all tool results and ask the LLM to summarize them
        if (responseText === 'I apologize, but I was unable to generate a response.') {
          const collectedResults: Array<{ tool: string; result: unknown }> = [];

          for (const step of result.steps) {
            if (step.toolCalls?.length && step.toolResults?.length) {
              const toolResults = step.toolResults as Array<{ result?: unknown }>;
              for (let j = 0; j < step.toolCalls.length; j++) {
                const call = step.toolCalls[j];
                const res = toolResults[j];
                if (res?.result !== undefined && res.result !== null) {
                  collectedResults.push({ tool: call.toolName, result: res.result });
                }
              }
            }
          }

          if (collectedResults.length > 0) {
            // Truncate large results to avoid blowing up the summarization call
            const resultsText = collectedResults
              .map((r) => {
                const json = JSON.stringify(r.result);
                const truncated = json.length > 2000 ? json.substring(0, 2000) + '...(truncated)' : json;
                return `Tool: ${r.tool}\nResult: ${truncated}`;
              })
              .join('\n\n');

            try {
              const summary = await generateText({
                model: this.modelFactory.getModel(),
                system: 'You are a helpful assistant. The user asked a question and tools were called to get data. Summarize the tool results into a concise, natural response for the user. Do NOT mention tool names or internal mechanics. If the results contain URLs or source links, ALWAYS include them at the end of your response in a "Sources:" section.',
                messages: [
                  { role: 'user', content: message.text },
                  { role: 'user', content: `Here are the results from the tools that were called:\n\n${resultsText}` },
                ],
                temperature: this.config.temperature,
              });
              // Record summarization call tokens
              this.costMonitor?.recordUsage(
                summary.usage?.promptTokens || 0,
                summary.usage?.completionTokens || 0
              );
              if (summary.text) {
                responseText = sanitizeResponseText(summary.text);
              }
            } catch (summaryError) {
              // If summarization fails, fall back to raw formatted output
              logger.warn('Tool result summarization failed, using raw output:', summaryError);
              responseText = collectedResults
                .map((r) => {
                  const json = JSON.stringify(r.result, null, 2);
                  return json.length > 500 ? json.substring(0, 500) + '...' : json;
                })
                .join('\n\n');
            }
          }
        }
      }

      // Add assistant response to conversation
      // When tools were used via the normal generateText flow, preserve the full
      // responseMessages (including tool_calls + tool_results) so subsequent turns
      // can reference IDs, data, etc. from previous tool results.
      // For recovery/fallback paths, just store the text response.
      const hasStructuredResponse = !usedTextOnlyFallback &&
        recoveredTools.length === 0 &&
        result?.response?.messages?.length > 0;

      if (hasStructuredResponse) {
        state.messages.push(...result.response.messages);
      } else {
        state.messages.push({
          role: 'assistant',
          content: responseText,
        });
      }
      state.lastActivity = Date.now();

      // Persist turn to session JSONL
      if (this.config.sessionConfig.enabled) {
        try {
          // Build the full structured message sequence for this turn when tools were used.
          // This preserves tool-call/result structure across Thinker restarts.
          const turnMessages: CoreMessage[] | undefined = hasStructuredResponse
            ? [{ role: 'user' as const, content: message.text }, ...result.response.messages]
            : undefined;

          await this.sessionStore.saveTurn(
            message.chatId,
            message.text,
            responseText,
            result.steps
              .flatMap((step) => step.toolCalls?.map((tc) => tc.toolName) || []),
            { prompt: promptTokens, completion: completionTokens },
            turnMessages
          );

          // Run compaction if needed
          if (this.sessionStore.shouldCompact(message.chatId)) {
            // Extract properly-paired user/assistant text turns from the full
            // CoreMessage history (which includes tool-call and tool-result messages
            // with array content that a simple typeof-string filter would drop).
            const textMessages = extractTextTurns(state.messages);
            const compactionModel = this.modelFactory.getCompactionModel();
            const compactionResult = await this.sessionStore.compact(
              message.chatId,
              textMessages,
              compactionModel
            );
            if (compactionResult.summary) {
              state.messages = compactionResult.messages;
              state.compactionSummary = compactionResult.summary;
              state.lastCompactionAt = Date.now();
            }
          }
        } catch (sessionError) {
          logger.warn('Session persistence error (non-fatal):', sessionError);
        }
      }

      // Collect tools used (include any recovered leaked tool calls and captured step tools)
      const resultToolNames = result.steps.flatMap(
        (step) => step.toolCalls?.map((tc) => tc.toolName) || []
      );
      const capturedToolNames = capturedSteps.flatMap(
        (step) => step.toolCalls?.map((tc) => tc.toolName) || []
      );
      const toolsUsed = usedTextOnlyFallback
        ? ['(text-only fallback)']
        : [...new Set([...resultToolNames, ...capturedToolNames, ...recoveredTools])];

      // Update sticky tools sliding window — track non-core tools used this turn
      const coreSet = new Set(CORE_TOOL_NAMES);
      const stickyToolsThisTurn = toolsUsed.filter(
        (t) => t !== '(text-only fallback)' && !coreSet.has(t),
      );
      if (stickyToolsThisTurn.length > 0) {
        const turnIndex = (state.recentToolsByTurn.at(-1)?.turnIndex ?? 0) + 1;
        state.recentToolsByTurn.push({ turnIndex, tools: stickyToolsThisTurn });
        // Trim to lookback window
        if (state.recentToolsByTurn.length > STICKY_TOOLS_LOOKBACK) {
          state.recentToolsByTurn = state.recentToolsByTurn.slice(-STICKY_TOOLS_LOOKBACK);
        }
      }

      // Send response to Telegram and store conversation
      // (skip when Orchestrator handles delivery — sendResponseDirectly=false)
      if (this.config.sendResponseDirectly) {
        await this.orchestrator.sendTelegramMessage(message.chatId, responseText, undefined, trace);
        await this.logger.logResponseSent(trace, message.chatId, responseText.length);

        await this.orchestrator.storeConversation(
          this.config.thinkerAgentId,
          message.text,
          responseText,
          undefined,
          trace
        );
      } else {
        await this.logger.logResponseSent(trace, message.chatId, responseText.length);
      }

      // Schedule post-conversation fact extraction (resets on each message)
      this.scheduleFactExtraction(message.chatId);

      // Invalidate playbook cache if any skill-modifying tools were called
      const skillTools = ['memory_store_skill', 'memory_update_skill', 'memory_delete_skill'];
      if (toolsUsed.some((t) => skillTools.includes(t))) {
        this.playbookCache.invalidate();
      }

      // Log completion
      await this.logger.logComplete(trace, toolsUsed, result.steps.length);

      // Flag if cost monitor tripped during this loop (so upstream can notify)
      const pausedDuringLoop = this.costMonitor?.paused ?? false;

      return {
        success: true,
        response: responseText,
        toolsUsed,
        totalSteps: result.steps.length,
        ...(pausedDuringLoop && { paused: true }),
      };
    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Tag LLM provider errors so upstream can show helpful messages (e.g. "Are you on VPN?")
      const lowerErr = errorMessage.toLowerCase();
      if (lowerErr.includes('forbidden') || lowerErr.includes('403') || lowerErr.includes('access denied')) {
        errorMessage = `${providerInfo.provider} API error: ${errorMessage}`;
      }

      logger.error('Error processing message:', errorMessage);

      await this.logger.logError(trace, errorMessage);

      // Circuit breaker: track consecutive errors
      this.consecutiveErrors++;
      if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
        logger.error(`CIRCUIT BREAKER TRIPPED: ${this.consecutiveErrors} consecutive errors`);
        this.circuitBreakerTripped = true;
      }

      // DO NOT send error messages to chat - this caused infinite feedback loops!
      // The bot would pick up its own error messages and try to process them.

      return {
        success: false,
        toolsUsed: [],
        totalSteps: 0,
        error: errorMessage,
      };
    } finally {
      this.currentTrace = undefined;
      this.currentChatId = undefined;
    }
  }

  /**
   * Process a proactive task (skill execution) — no Telegram context
   * Called by the /execute-skill HTTP endpoint when Inngest fires a skill
   */
  async processProactiveTask(
    taskInstructions: string,
    maxSteps: number = 10,
    noTools?: boolean,
    requiredTools?: string[],
    skillName?: string,
    chatId?: string,
  ): Promise<ProcessingResult & { summary: string }> {
    const trace = createTrace('thinker-skill');
    this.currentTrace = trace;
    this.currentChatId = chatId;

    logger.info(`Processing proactive task (maxSteps: ${maxSteps}, chatId: ${chatId || 'none'})`);

    const providerInfo = this.modelFactory.getProviderInfo();

    // Cost control pause check
    if (this.costMonitor?.paused) {
      logger.warn('Agent paused by cost controls - skipping proactive task');
      return {
        success: false,
        summary: 'Agent paused by cost controls',
        toolsUsed: [],
        totalSteps: 0,
        error: `Agent paused: ${this.costMonitor.pauseReason || 'cost limit exceeded'}`,
        paused: true,
      };
    }

    try {
      // Rate limiting
      const now = Date.now();
      const timeSinceLastCall = now - this.lastApiCallTime;
      if (timeSinceLastCall < this.minApiCallIntervalMs) {
        await new Promise((r) => setTimeout(r, this.minApiCallIntervalMs - timeSinceLastCall));
      }
      this.lastApiCallTime = Date.now();

      // Check for tool changes
      await this.refreshToolsIfNeeded();

      // Build system prompt for autonomous task (same priority chain as buildContext)
      let basePrompt = this.customSystemPrompt || this.personaPrompt || this.defaultSystemPrompt;

      // Apply profile persona override (same as buildContext)
      const profile = await this.orchestrator.getProfile(this.config.thinkerAgentId, trace);
      if (profile?.profile_data?.persona?.system_prompt) {
        basePrompt = profile.profile_data.persona.system_prompt;
      }

      // Inject current date/time so the LLM knows "today" (same as buildContext)
      const tz = this.config.userTimezone;
      const currentDate = new Date();
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

      const chatSection = chatId ? `\n\n## Current Chat\nchat_id: ${chatId}` : '';

      const systemPrompt = `${basePrompt}

## Current Date & Time
${formatter.format(currentDate)} (${tz})${chatSection}

## Current Task
You are executing an autonomous scheduled task. There is no user message — follow the instructions below as your goal.
Complete the task step by step, using your available tools. When done, provide a brief summary of what you accomplished.`;

      // Retrieve relevant memories for context
      const memories = await this.orchestrator.retrieveMemories(
        this.config.thinkerAgentId,
        taskInstructions,
        5,
        trace
      );

      let systemPromptWithContext = systemPrompt;
      if (memories.facts.length > 0) {
        const factsText = memories.facts
          .map((f) => `- ${f.fact} (${f.category})`)
          .join('\n');
        systemPromptWithContext += `\n\nRelevant memories:\n${factsText}`;
      }

      const promptChars = systemPromptWithContext.length;
      logger.info(`[prompt-size] Proactive task prompt: ~${Math.ceil(promptChars / 4)} tokens (${promptChars} chars)`);

      // Run the LLM with task instructions as the "user message"
      let selectedTools: Record<string, CoreTool> | undefined;
      if (noTools) {
        selectedTools = undefined;
      } else if (requiredTools && requiredTools.length > 0) {
        // Skills declare required_tools — resolve directly instead of keyword-matching
        selectedTools = {};
        for (const name of requiredTools) {
          if (this.tools[name]) {
            selectedTools[name] = this.tools[name];
          }
        }
        logger.info(`Tool selection: method=required_tools, resolved=${Object.keys(selectedTools).length}/${requiredTools.length}`);
      } else {
        selectedTools = await selectToolsWithFallback(taskInstructions, this.tools, this.embeddingSelector, this.orchestrator.getMCPMetadata());
      }
      let result;
      try {
        result = await generateText({
          model: this.modelFactory.getModel(),
          system: systemPromptWithContext,
          messages: [{ role: 'user', content: taskInstructions }],
          ...(selectedTools ? { tools: selectedTools, toolChoice: 'auto' as const } : {}),
          maxSteps,
          temperature: this.config.temperature,
          abortSignal: AbortSignal.timeout(90_000),
        });
      } catch (genError) {
        const genMsg = genError instanceof Error ? genError.message : '';
        const isToolCallError =
          genMsg.includes('Failed to call a function') ||
          genMsg.includes('failed_generation') ||
          genMsg.includes('tool call validation failed') ||
          genMsg.includes('maximum number of items');

        if (isToolCallError && selectedTools) {
          logger.warn(`[proactive] Tool call failed, retrying once: ${genMsg}`);
          const isFormatError = genMsg.includes('was not in request.tools');
          const isGenerationError = genMsg.includes('failed_generation');

          // Retry strategy depends on error type:
          // - Format error (args in tool name): lower temp + hint about tool name format
          // - Generation error (Groq can't parse output): force 'required' tool choice
          //   to enable grammar-constrained decoding + lower temp + limit steps
          // - Other: slight temp increase
          let retryTemp: number;
          let retryToolChoice: 'auto' | 'required' = 'auto';
          let retryMaxSteps = Math.min(maxSteps, 4);
          let errorHint = '';

          if (isFormatError) {
            retryTemp = Math.max((this.config.temperature ?? 0.7) - 0.2, 0.1);
            errorHint = '\n\nCRITICAL: Use tools by their exact name only. Do NOT embed parameters in the tool name — pass them as separate structured arguments.';
          } else if (isGenerationError) {
            retryTemp = Math.max((this.config.temperature ?? 0.7) - 0.3, 0.0);
            retryToolChoice = 'required';
            retryMaxSteps = Math.min(maxSteps, 3);
            errorHint = '\n\nYou MUST call the available tools to complete this task. Call the search tool first, then send the results.';
          } else {
            retryTemp = Math.min((this.config.temperature ?? 0.7) + 0.1, 1.0);
          }

          logger.info(`[proactive] Retry config: toolChoice=${retryToolChoice}, temp=${retryTemp}, maxSteps=${retryMaxSteps}`);
          result = await generateText({
            model: this.modelFactory.getModel(),
            system: systemPromptWithContext + errorHint,
            messages: [{ role: 'user', content: taskInstructions }],
            tools: selectedTools,
            toolChoice: retryToolChoice as 'auto',
            maxSteps: retryMaxSteps,
            temperature: retryTemp,
            abortSignal: AbortSignal.timeout(90_000),
          });
        } else {
          throw genError;
        }
      }

      // Record token usage in cost monitor
      this.costMonitor?.recordUsage(
        result.usage?.promptTokens || 0,
        result.usage?.completionTokens || 0
      );

      // ─── Tool Call Recovery (proactive tasks) ─────────────────────
      let responseText: string;
      let recoveredTools: string[] = [];

      if (
        selectedTools &&
        result.finishReason === 'stop' &&
        (!result.toolCalls || result.toolCalls.length === 0) &&
        result.text
      ) {
        const leak = detectLeakedToolCall(result.text, selectedTools);
        if (leak.detected) {
          logger.info(`[tool-recovery] Proactive task: leaked tool detected: ${leak.toolName}`);
          const recovery = await recoverLeakedToolCall(
            leak.toolName,
            leak.parameters,
            selectedTools,
          );
          if (recovery.success) {
            let toolResponse = '';
            if (recovery.result && typeof recovery.result === 'object') {
              const res = recovery.result as Record<string, unknown>;
              const data = res.data as Record<string, unknown> | undefined;
              if (data?.response && typeof data.response === 'string') {
                toolResponse = data.response;
              }
            }
            responseText = leak.preamble || toolResponse || 'Task completed.';
            recoveredTools = [leak.toolName];
          } else {
            logger.warn(`[tool-recovery] Proactive recovery failed: ${recovery.error}`);
            responseText = leak.preamble || 'Task encountered an issue. Please check and try again.';
          }
        } else {
          responseText = sanitizeResponseText(result.text || 'Task completed without summary.');
        }
      } else {
        responseText = sanitizeResponseText(result.text || 'Task completed without summary.');
      }

      const toolsUsed = [
        ...result.steps.flatMap((step) => step.toolCalls?.map((tc) => tc.toolName) || []),
        ...recoveredTools,
      ];

      logger.info(`Proactive task completed (${result.steps.length} steps, tools: ${toolsUsed.join(', ') || 'none'})`);

      // Framework: store execution summary in memory as a pattern fact
      try {
        await this.orchestrator.storeFact(
          this.config.thinkerAgentId,
          `Skill execution summary: ${responseText.substring(0, 500)}`,
          'pattern',
          trace
        );
      } catch (memError) {
        logger.error('Failed to store skill execution summary in memory:', memError);
      }

      // Flag if cost monitor tripped during this loop (so upstream can notify)
      const pausedDuringLoop = this.costMonitor?.paused ?? false;

      return {
        success: true,
        response: responseText,
        summary: responseText,
        toolsUsed,
        totalSteps: result.steps.length,
        ...(pausedDuringLoop && { paused: true }),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error processing proactive task:', errorMessage);

      return {
        success: false,
        summary: `Error: ${errorMessage}`,
        toolsUsed: [],
        totalSteps: 0,
        error: errorMessage,
      };
    } finally {
      this.currentTrace = undefined;
      this.currentChatId = undefined;
    }
  }

  // ─── Post-Conversation Fact Extraction ─────────────────────────

  /**
   * Schedule fact extraction for a chat after idle timeout.
   * Resets the timer on each new message so extraction only runs
   * after the conversation goes quiet.
   */
  private scheduleFactExtraction(chatId: string): void {
    if (!this.config.factExtraction.enabled) return;

    // Clear existing timer for this chat
    const existing = this.extractionTimers.get(chatId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.extractionTimers.delete(chatId);
      this.runFactExtraction(chatId).catch((error) => {
        logger.warn('[fact-extraction] Error (non-fatal):', error);
      });
    }, this.config.factExtraction.idleMs);

    this.extractionTimers.set(chatId, timer);
  }

  /**
   * Run post-conversation fact extraction for a chat.
   * Reviews recent turns with awareness of existing facts to catch
   * information the LLM didn't store during task-focused exchanges.
   */
  private async runFactExtraction(chatId: string): Promise<void> {
    const state = this.conversationStates.get(chatId);
    if (!state) return;

    // Need enough conversation to extract from
    const minMessages = 4; // at least 2 exchanges
    if (state.messages.length < minMessages) return;

    // Skip if already extracted for the current conversation state
    if (state.lastExtractionAt && state.lastExtractionAt >= state.lastActivity) return;

    logger.info(`[fact-extraction] Running for chat ${chatId} (${state.messages.length} messages)`);

    try {
      // Gather recent text turns (properly extracts text from tool-calling
      // assistant messages that store content as arrays).
      const maxMessages = this.config.factExtraction.maxTurns * 2;
      const recentMessages = extractTextTurns(state.messages).slice(-maxMessages);

      if (recentMessages.length < minMessages) return;

      // Fetch existing facts for dedup context
      const existingFacts = await this.orchestrator.listFacts(this.config.thinkerAgentId);
      const knownFactStrings = existingFacts.map((f) => `${f.fact} (${f.category})`);

      // Run extraction with the cheap compaction model
      const model = this.modelFactory.getCompactionModel();
      const userIdentity = this.config.userName
        ? { name: this.config.userName, email: this.config.userEmail }
        : undefined;
      const facts = await extractFactsFromConversation(
        model,
        recentMessages,
        knownFactStrings,
        this.config.factExtraction.confidenceThreshold,
        userIdentity,
      );

      if (facts.length === 0) {
        logger.info('[fact-extraction] No new facts found');
        state.lastExtractionAt = Date.now();
        return;
      }

      // Store each extracted fact via Orchestrator → Memorizer
      let stored = 0;
      for (const fact of facts) {
        const success = await this.orchestrator.storeFact(
          this.config.thinkerAgentId,
          fact.fact,
          fact.category,
        );
        if (success) stored++;
      }

      state.lastExtractionAt = Date.now();
      logger.info(`[fact-extraction] Stored ${stored}/${facts.length} new facts for chat ${chatId}`);
    } catch (error) {
      logger.warn(
        '[fact-extraction] Failed (non-fatal):',
        error instanceof Error ? error.message : error,
      );
    }
  }

  /**
   * Clean up old conversation states
   */
  cleanupOldConversations(maxAgeMs: number = 30 * 60 * 1000): void {
    const now = Date.now();

    for (const [chatId, state] of this.conversationStates) {
      if (now - state.lastActivity > maxAgeMs) {
        this.conversationStates.delete(chatId);
        // Clear any pending extraction timer for this chat
        const timer = this.extractionTimers.get(chatId);
        if (timer) {
          clearTimeout(timer);
          this.extractionTimers.delete(chatId);
        }
      }
    }
  }

  // ─── Session Persistence API ─────────────────────────────────────

  /**
   * Clear a session entirely — deletes JSONL file, clears in-memory state,
   * and cancels any pending fact extraction timer.
   */
  async clearSession(chatId: string): Promise<void> {
    // Clear in-memory conversation state
    this.conversationStates.delete(chatId);

    // Clear pending extraction timer
    const timer = this.extractionTimers.get(chatId);
    if (timer) {
      clearTimeout(timer);
      this.extractionTimers.delete(chatId);
    }

    // Clear persisted session
    await this.sessionStore.clearSession(chatId);
    logger.info(`Session cleared for chat ${chatId}`);
  }

  /**
   * Clean up session JSONL files older than the configured max age.
   */
  async cleanupOldSessions(): Promise<void> {
    if (!this.config.sessionConfig.enabled) return;
    await this.sessionStore.cleanupOldSessions();
  }

  // ─── Cost Control API ───────────────────────────────────────────

  /**
   * Get current cost monitor status (for /cost-status endpoint).
   */
  getCostStatus(): CostStatus | null {
    return this.costMonitor?.getStatus() ?? null;
  }

  /**
   * Get embedding selector status (for /health endpoint).
   */
  getEmbeddingSelectorStatus(): {
    enabled: boolean;
    initialized: boolean;
    toolCount: number;
    lastSelection: { method: string; selectedCount: number; totalTools: number; topScore: number } | null;
  } {
    if (!this.embeddingSelector) {
      return { enabled: false, initialized: false, toolCount: 0, lastSelection: null };
    }
    const stats = this.embeddingSelector.getLastSelectionStats();
    return {
      enabled: true,
      initialized: this.embeddingSelector.isInitialized(),
      toolCount: Object.keys(this.tools).length,
      lastSelection: stats ? {
        method: stats.method,
        selectedCount: stats.selectedCount,
        totalTools: stats.totalTools,
        topScore: stats.topScore,
      } : null,
    };
  }

  /**
   * Check if Orchestrator is reachable (for deep health checks).
   */
  async checkOrchestratorHealth(): Promise<boolean> {
    return this.orchestrator.healthCheck();
  }

  /**
   * Resume from a cost-control pause (for /cost-resume endpoint).
   */
  resumeFromCostPause(resetWindow = false): { success: boolean; message: string } {
    if (!this.costMonitor) {
      return { success: false, message: 'Cost controls not enabled' };
    }
    if (!this.costMonitor.paused) {
      return { success: false, message: 'Agent is not paused' };
    }
    this.costMonitor.resume(resetWindow);
    logger.info(`Agent resumed from cost pause (resetWindow=${resetWindow})`);
    return { success: true, message: 'Agent resumed' };
  }
}
