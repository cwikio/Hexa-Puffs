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
import { selectToolsWithFallback } from './tool-selection.js';
import { EmbeddingToolSelector } from './embedding-tool-selector.js';
import { createEmbeddingProviderFromEnv } from './embedding-config.js';
import { extractFactsFromConversation } from './fact-extractor.js';
import { detectLeakedToolCall, recoverLeakedToolCall } from '../utils/recover-tool-call.js';
import { repairConversationHistory, truncateHistoryToolResults } from './history-repair.js';
import { Logger } from '@mcp/shared/Utils/logger.js';

const logger = new Logger('thinker:agent');

/**
 * Default system prompt for the agent
 */
const DEFAULT_SYSTEM_PROMPT = `You are Annabelle, a helpful AI assistant communicating via Telegram.

Be friendly, concise, and conversational. Keep responses short — this is a chat, not an essay.

## Your Memory System
You have a persistent memory system (Memorizer) that stores facts, conversations, and a user profile. Use it!
- To recall something the user told you: use memory_retrieve_memories or search_memories with a relevant query.
- To remember something new: use store_fact with a category (preference, background, pattern, project, contact, decision).
- To check all stored facts: use memory_list_facts.
- To look up past conversations: use memory_search_conversations.
- To check or update the user's profile: use memory_get_profile / memory_update_profile.
When the user says "remember this", "check your memory", "what do you know about me", etc. — ALWAYS use your memory tools.

## Handling "About Me" Questions
When the user asks about themselves — e.g., "what do you know about me", "tell me about myself", "co o mnie wiesz", "co o mnie pamietasz", "what have you learned about me", or similar — you MUST:
1. Call memory_list_facts (with no category filter) to retrieve ALL stored facts.
2. Also call memory_get_profile to get their profile.
3. Present an organized summary of everything you know, grouped by category.
4. Do NOT ask clarifying questions like "what specifically would you like to know?" — just show everything.
This is a non-negotiable rule: self-referential questions always get a full memory dump.

## Proactive Learning
Pay attention to what the user tells you and proactively store important details using store_fact — do NOT wait to be asked.
Examples of things to remember automatically:
- Preferences ("I prefer dark mode", "I like Python over JS") → store_fact with category "preference"
- Personal details ("I live in Krakow", "I'm a software engineer") → category "background"
- Contacts ("My manager is Anna") → category "contact"
- Projects ("I'm working on an MCP orchestrator") → category "project"
- Decisions ("Let's use PostgreSQL for this") → category "decision"
- Schedules ("I have a meeting next Friday") → category "pattern"
If the user shares something personal or important, quietly store it. You don't need to announce that you're saving it every time — just do it naturally.

## Status & Health Queries
When the user asks about your status or system status — call get_status for a quick overview.
For a deeper check (are services actually responding?), use system_health_check. It pings every connected MCP and reports per-service health, classified as internal or external.

## External Services
In addition to built-in MCPs (memory, search, email, Telegram, etc.), external services can be connected by adding entries to external-mcps.json in the project root. External MCPs are loaded when the Orchestrator starts — changes to the config file are picked up automatically without a restart. Use system_health_check to see what's currently connected. If the user asks about connecting a new service, tell them it can be added to external-mcps.json.

## Action-First Rule
When the user asks you to DO something (search, send, schedule, browse, etc.), just do it and confirm briefly.
- WRONG: "I'll set up a cron job using the create_job tool with expression '*/1 * * * *' and maxRuns: 3..."
- RIGHT: *[does it]* "Done — you'll get an article every minute for 3 minutes."
Never explain the tools you're using, the parameters you're passing, or the internal mechanics. The user wants results, not a narration of your workflow.

## Tool Use Guidelines
- When the user explicitly asks you to use a specific tool or capability (e.g., "ask a subagent", "search for", "send an email"), ALWAYS use that tool — even if you could answer without it.
- Answer general knowledge questions from your own knowledge ONLY when the user has NOT requested a specific tool.
- Use tools when the task genuinely requires them — memory, file operations, web search, sending messages.
- Do NOT call tools that aren't in your available tools list.
- When a tool IS needed, use it without asking for permission (unless destructive).
- CRITICAL: Always use the structured function calling API to invoke tools. NEVER write tool calls as JSON text in your response (e.g. {"name": "tool", "parameters": {...}}). If you want to call a tool, call it — don't describe the call.
- CRITICAL: You CANNOT perform real-world actions (create events, send emails, search the web, manage files, store memories) without calling tools. If you respond with text claiming you did something but did not call a tool, that action DID NOT HAPPEN — you would be lying to the user. When the user asks you to DO something, you MUST call the appropriate tool. A text response alone is NEVER sufficient for actions.
- IMPORTANT: Your final text response is automatically delivered to the user via Telegram — do NOT call send_telegram to deliver your response. Only use send_telegram when you need to send a SEPARATE message (e.g., sending to a different chat, or sending media). For normal replies, just write your response text.

## Web Search Tool
When you need current information (weather, sports scores, news, real-time data), use the searcher_web_search tool:
- query: Your search query (required)
- count: Number of results, default 10 (optional)
- freshness: Time filter - use "24h" for today's info (optional)
Do NOT include freshness unless specifically needed for recent results.

## Image Search
MANDATORY: When the user asks for photos, pictures, images, logos, or anything visual — you MUST call searcher_image_search. NEVER respond with text only for image requests. This is non-negotiable.
- Call searcher_image_search with the search query
- It returns direct image URLs (image_url) and thumbnails (thumbnail_url)
- Send the images via telegram_send_media — it accepts URLs, not just local files
- For multiple images, send each one separately with telegram_send_media
- Do NOT describe images in text — actually search and send them

## Source Citations
When your response includes information obtained from web searches, news searches, or any online data:
- ALWAYS include source links at the end of your response
- Format as a simple list: "Sources:" followed by clickable URLs
- Keep it compact — just title + link, no extra commentary
- Example:
  Sources:
  - Title of Article: https://example.com/article
  - Another Source: https://example.com/other
- This applies to ALL online data — web search, news, image search results
- For image searches, include the source page URL alongside the image

## Email (Gmail)
You can send, read, and manage emails via Gmail. Key tools:
- gmail_send_email: Send a new email (to, subject, body required; cc, bcc optional)
- gmail_reply_email: Reply to an existing email
- gmail_list_emails: List/search emails (supports Gmail search syntax like from:, to:, subject:, is:unread)
- gmail_get_email: Get full email details by ID
- gmail_create_draft / gmail_send_draft: Create and send email drafts
When the user asks to send an email, check an email, or anything email-related, use these tools.

## Calendar (Google Calendar)
You can view, create, and manage calendar events. Key tools:
- gmail_list_events: List upcoming events (supports time_min/time_max date range, query search, calendar_id)
- gmail_get_event: Get full event details by event ID
- gmail_create_event: Create a new event (summary required; start_date_time or start_date, end time, location, attendees, recurrence, reminders optional)
- gmail_update_event: Update an existing event (only provide fields to change)
- gmail_delete_event: Delete an event by ID
- gmail_quick_add_event: Create an event from natural language (e.g., "Meeting with John tomorrow at 3pm")
- gmail_find_free_time: Check free/busy slots for a time range
- gmail_list_calendars: List all available calendars
When the user asks about their schedule, meetings, appointments, or anything calendar-related, use these tools. Use ISO 8601 datetime format (e.g., '2026-01-15T09:00:00Z') for time parameters.

## Response Format Rules
CRITICAL: NEVER include raw function calls, tool invocations, or technical syntax in your responses.
- Do NOT write <function=...>, <tool_call>, or similar tags
- Do NOT output JSON like {"tool_call": ...} or {"function": ...}
- Do NOT include thinking tags like <think>...</think>
- When you use a tool, the system handles it automatically — never write it out
- Your responses should be natural language only`;

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
  private logger = getTraceLogger();
  private playbookCache: PlaybookCache;
  private customSystemPrompt: string | null = null;
  private personaPrompt: string | null = null;

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

    // Check Orchestrator health
    const healthy = await this.orchestrator.healthCheck();
    if (!healthy) {
      logger.warn('Warning: Orchestrator is not healthy. Some features may not work.');
    }

    // Discover tools from Orchestrator
    const orchestratorTools = await this.orchestrator.discoverTools();
    logger.info(`Discovered ${orchestratorTools.length} tools from Orchestrator`);

    // Create tools from Orchestrator
    const dynamicTools = createToolsFromOrchestrator(
      orchestratorTools,
      this.orchestrator,
      () => this.currentTrace
    );

    // Create essential tools
    const essentialTools = createEssentialTools(
      this.orchestrator,
      this.config.thinkerAgentId,
      () => this.currentTrace,
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
      const freshNames = new Set(freshOrchestratorTools.map(t => t.name));
      const currentNames = new Set(Object.keys(this.tools));

      // Quick set equality check
      if (freshNames.size === currentNames.size && [...freshNames].every(n => currentNames.has(n))) {
        return; // no change
      }

      const added = [...freshNames].filter(n => !currentNames.has(n));
      const removed = [...currentNames].filter(n => !freshNames.has(n));
      logger.info(`Tool set changed: +${added.length} added, -${removed.length} removed`);
      if (added.length > 0) logger.info(`  Added: ${added.join(', ')}`);
      if (removed.length > 0) logger.info(`  Removed: ${removed.join(', ')}`);

      // Rebuild tools
      const dynamicTools = createToolsFromOrchestrator(
        freshOrchestratorTools,
        this.orchestrator,
        () => this.currentTrace,
      );
      const essentialTools = createEssentialTools(
        this.orchestrator,
        this.config.thinkerAgentId,
        () => this.currentTrace,
      );
      this.tools = { ...dynamicTools, ...essentialTools };

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

    if (this.config.sessionConfig.enabled) {
      try {
        const saved = await this.sessionStore.loadSession(chatId);
        if (saved) {
          messages = saved.messages;
          compactionSummary = saved.compactionSummary;
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
    };
    this.conversationStates.set(chatId, state);
    return state;
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

    // Build system prompt (priority: custom file > persona file > built-in default)
    let systemPrompt = this.customSystemPrompt || this.personaPrompt || DEFAULT_SYSTEM_PROMPT;

    if (profile?.profile_data?.persona?.system_prompt) {
      systemPrompt = profile.profile_data.persona.system_prompt;
    }

    // Note: tool schemas are passed to the LLM via Vercel AI SDK, no need to list them in the prompt

    // Inject matching domain playbooks
    await this.playbookCache.refreshIfNeeded(trace);
    const matchedPlaybooks = classifyMessage(userMessage, this.playbookCache.getPlaybooks());
    if (matchedPlaybooks.length > 0) {
      const section = matchedPlaybooks
        .map((pb) => `### Playbook: ${pb.name}\n${pb.instructions}`)
        .join('\n\n');
      systemPrompt += `\n\n## Workflow Guidance\nFollow these steps when relevant:\n\n${section}`;
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

    // Add context to system prompt
    if (memories.facts.length > 0) {
      const factsText = memories.facts
        .map((f) => `- ${f.fact} (${f.category})`)
        .join('\n');
      systemPrompt += `\n\nRelevant memories about the user:\n${factsText}`;
    }

    return {
      systemPrompt,
      conversationHistory: truncateHistoryToolResults(
        repairConversationHistory(state.messages.slice(-50)),
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
    };
  }

  /**
   * Process a single message
   */
  async processMessage(message: IncomingMessage): Promise<ProcessingResult> {
    const trace = createTrace('thinker');
    this.currentTrace = trace;

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
      const selectedTools = await selectToolsWithFallback(message.text, this.tools, this.embeddingSelector);
      let result;
      let usedTextOnlyFallback = false;

      // Lower temperature when tool selector strongly matches — improves tool calling reliability
      const selectionStats = this.embeddingSelector?.getLastSelectionStats();
      const effectiveTemperature = (selectionStats?.topScore ?? 0) > 0.6
        ? Math.min(this.config.temperature, 0.3)
        : this.config.temperature;

      // Pre-emptive tool enforcement: use 'required' when message clearly needs tools
      // (high embedding match or action verbs detected) instead of waiting for hallucination retry
      const ACTION_VERB_PATTERN = /^(send|create|search|find|check|delete|remove|schedule|update|add|set|browse|open|navigate|look\s?up|forward|reply|draft|compose)/i;
      const embeddingScore = selectionStats?.topScore ?? 0;
      const needsTools = embeddingScore > 0.7 || ACTION_VERB_PATTERN.test(message.text.trim());
      const effectiveToolChoice = needsTools ? 'required' as const : 'auto' as const;
      if (needsTools) {
        logger.info(`[tool-enforcement] Pre-emptive toolChoice=required (embeddingScore=${embeddingScore.toFixed(3)}, actionVerb=${ACTION_VERB_PATTERN.test(message.text.trim())})`);
      }

      // Capture completed steps via onStepFinish so we can recover tool results
      // if generateText() fails mid-loop (e.g., tools execute but the follow-up LLM call errors)
      interface CapturedStep {
        toolCalls: Array<{ toolName: string; args: unknown }>;
        toolResults: Array<{ result: unknown }>;
        text: string;
      }
      const capturedSteps: CapturedStep[] = [];
      const onStepFinish = (step: CapturedStep) => { capturedSteps.push(step); };

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
            // First retry: reduce complexity and nudge temperature for a different response path
            const retryTemp = Math.min((this.config.temperature ?? 0.7) + 0.1, 1.0);
            result = await generateText({
              model: this.modelFactory.getModel(),
              system: context.systemPrompt,
              messages: [...context.conversationHistory, { role: 'user', content: message.text }],
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
                logger.warn('Trying rephrased message with tools...');
                const retryTemp2 = Math.min((this.config.temperature ?? 0.7) + 0.1, 1.0);
                result = await generateText({
                  model: this.modelFactory.getModel(),
                  system: context.systemPrompt,
                  messages: [...context.conversationHistory, { role: 'user', content: rephrasedText }],
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
            // Filter to user/assistant text messages (CoreMessage may include system/tool roles)
            const textMessages = state.messages.filter(
              (m): m is { role: 'user' | 'assistant'; content: string } =>
                (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
            );
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

      return {
        success: true,
        response: responseText,
        toolsUsed,
        totalSteps: result.steps.length,
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
    }
  }

  /**
   * Process a proactive task (skill execution) — no Telegram context
   * Called by the /execute-skill HTTP endpoint when Inngest fires a skill
   */
  async processProactiveTask(
    taskInstructions: string,
    maxSteps: number = 10,
    notifyChatId?: string,
    noTools?: boolean,
    requiredTools?: string[],
  ): Promise<ProcessingResult & { summary: string }> {
    const trace = createTrace('thinker-skill');
    this.currentTrace = trace;

    logger.info(`Processing proactive task (maxSteps: ${maxSteps})`);

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
      const basePrompt = this.customSystemPrompt || this.personaPrompt || DEFAULT_SYSTEM_PROMPT;

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

      const systemPrompt = `${basePrompt}

## Current Date & Time
${formatter.format(currentDate)} (${tz})

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

      // Run the LLM with task instructions as the "user message"
      // For proactive tasks, exclude send_telegram — notifications are handled post-completion via notifyChatId
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
        selectedTools = await selectToolsWithFallback(taskInstructions, this.tools, this.embeddingSelector);
      }
      if (selectedTools) {
        delete selectedTools['send_telegram'];
      }
      const result = await generateText({
        model: this.modelFactory.getModel(),
        system: systemPromptWithContext,
        messages: [{ role: 'user', content: taskInstructions }],
        ...(selectedTools ? { tools: selectedTools, toolChoice: 'auto' as const } : {}),
        maxSteps,
        temperature: this.config.temperature,
        abortSignal: AbortSignal.timeout(90_000),
      });

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

      // Optionally notify via Telegram (always via Orchestrator)
      // Skip notification for trivial "nothing to report" results
      const trivialPatterns = [
        /no new emails/i,
        /no meetings in the next/i,
        /no upcoming meetings/i,
        /no pending follow/i,
        /all caught up/i,
        /schedule looks manageable/i,
      ];
      const isTrivial = trivialPatterns.some(p => p.test(responseText));

      if (notifyChatId && !isTrivial) {
        try {
          const notificationText = `📋 Skill completed:\n\n${responseText}`;
          await this.orchestrator.sendTelegramMessage(notifyChatId, notificationText, undefined, trace);
        } catch (notifyError) {
          logger.error('Failed to send skill completion notification:', notifyError);
        }
      } else if (notifyChatId && isTrivial) {
        logger.info('Skipping notification for trivial skill result', { preview: responseText.substring(0, 80) });
      }

      return {
        success: true,
        response: responseText,
        summary: responseText,
        toolsUsed,
        totalSteps: result.steps.length,
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
      // Gather recent text messages
      const maxMessages = this.config.factExtraction.maxTurns * 2;
      const recentMessages = state.messages
        .filter(
          (m): m is { role: 'user' | 'assistant'; content: string } =>
            (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
        )
        .slice(-maxMessages);

      if (recentMessages.length < minMessages) return;

      // Fetch existing facts for dedup context
      const existingFacts = await this.orchestrator.listFacts(this.config.thinkerAgentId);
      const knownFactStrings = existingFacts.map((f) => `${f.fact} (${f.category})`);

      // Run extraction with the cheap compaction model
      const model = this.modelFactory.getCompactionModel();
      const facts = await extractFactsFromConversation(
        model,
        recentMessages,
        knownFactStrings,
        this.config.factExtraction.confidenceThreshold,
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
