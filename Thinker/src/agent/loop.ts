import { readFile } from 'fs/promises';
import { generateText, type CoreMessage, type CoreTool } from 'ai';
import type { LanguageModelV1 } from 'ai';
import type { Config } from '../config.js';
import type { TraceContext } from '../tracing/types.js';
import { createTrace, getTraceDuration } from '../tracing/context.js';
import { getTraceLogger } from '../tracing/logger.js';
import { OrchestratorClient } from '../orchestrator/client.js';
import { TelegramDirectClient } from '../telegram/client.js';
import { createEssentialTools, createToolsFromOrchestrator } from '../orchestrator/tools.js';
import { ModelFactory } from '../llm/factory.js';
import { sanitizeResponseText } from '../utils/sanitize.js';
import type { IncomingMessage, ProcessingResult, AgentContext, AgentState } from './types.js';
import { PlaybookCache } from './playbook-cache.js';
import { classifyMessage } from './playbook-classifier.js';
import { seedPlaybooks } from './playbook-seed.js';

/**
 * Default system prompt for the agent
 */
const DEFAULT_SYSTEM_PROMPT = `You are Annabelle, a helpful AI assistant communicating via Telegram.

Be friendly, concise, and conversational. Keep responses short — this is a chat, not an essay.

## Your Memory System
You have a persistent memory system (Memorizer) that stores facts, conversations, and a user profile. Use it!
- To recall something the user told you: use retrieve_memories or search_memories with a relevant query.
- To remember something new: use store_fact with a category (preference, background, pattern, project, contact, decision).
- To check all stored facts: use list_facts.
- To look up past conversations: use search_conversations.
- To check or update the user's profile: use get_profile / update_profile.
When the user says "remember this", "check your memory", "what do you know about me", etc. — ALWAYS use your memory tools.

## Handling "About Me" Questions
When the user asks about themselves — e.g., "what do you know about me", "tell me about myself", "co o mnie wiesz", "co o mnie pamietasz", "what have you learned about me", or similar — you MUST:
1. Call list_facts (with no category filter) to retrieve ALL stored facts.
2. Also call get_profile to get their profile.
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

## Status Queries
When the user asks about your status, MCP status, or system status — call get_status and present the results as a compact list showing each MCP server name, port (if available), type (stdio/http), and whether it's running or not. Keep it short — no prose, just the data. Example format:
- guardian: running (stdio)
- searcher: running (http, port 8007)
- gmail: down (http, port 8008)

## Tool Use Guidelines
- Answer general knowledge questions (geography, math, science, history) from your own knowledge. Do NOT use tools for these.
- Use tools when the task genuinely requires them — memory, file operations, web search, sending messages.
- Do NOT call tools that aren't in your available tools list.
- When a tool IS needed, use it without asking for permission (unless destructive).

## Web Search Tool
When you need current information (weather, sports scores, news, real-time data), use the web_search tool:
- query: Your search query (required)
- count: Number of results, default 10 (optional)
- freshness: Time filter - use "24h" for today's info (optional)
Do NOT include freshness unless specifically needed for recent results.

## Email (Gmail)
You can send, read, and manage emails via Gmail. Key tools:
- send_email: Send a new email (to, subject, body required; cc, bcc optional)
- reply_email: Reply to an existing email
- list_emails: List/search emails (supports Gmail search syntax like from:, to:, subject:, is:unread)
- get_email: Get full email details by ID
- create_draft / send_draft: Create and send email drafts
When the user asks to send an email, check an email, or anything email-related, use these tools.

## Calendar (Google Calendar)
You can view, create, and manage calendar events. Key tools:
- list_events: List upcoming events (supports time_min/time_max date range, query search, calendar_id)
- get_event: Get full event details by event ID
- create_event: Create a new event (summary required; start_date_time or start_date, end time, location, attendees, recurrence, reminders optional)
- update_event: Update an existing event (only provide fields to change)
- delete_event: Delete an event by ID
- quick_add_event: Create an event from natural language (e.g., "Meeting with John tomorrow at 3pm")
- find_free_time: Check free/busy slots for a time range
- list_calendars: List all available calendars
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
  private telegramDirect: TelegramDirectClient | null = null;
  private modelFactory: ModelFactory;
  private tools: Record<string, CoreTool> = {};
  private conversationStates: Map<string, AgentState> = new Map();
  private currentTrace: TraceContext | undefined;
  private logger = getTraceLogger();
  private processedMessageIds: Set<string> = new Set();
  private botUserId: string | null = null;
  private monitoredChatIds: string[] = [];
  private lastChatRefresh = 0;
  private playbookCache: PlaybookCache;
  private customSystemPrompt: string | null = null;

  // Rate limiting
  private lastApiCallTime = 0;
  private minApiCallIntervalMs = 1000; // 1 second minimum between calls

  // Circuit breaker
  private consecutiveErrors = 0;
  private maxConsecutiveErrors = 5;
  private circuitBreakerTripped = false;

  // Patterns that indicate bot-generated messages (to prevent feedback loops)
  private readonly botMessagePatterns = [
    'I encountered an error:',
    'I apologize, but I was unable to',
    'Failed after',
    'rate limit issue cannot be resolved',
    'Invalid API Key',
    'I was unable to generate a response',
  ];

  constructor(config: Config) {
    this.config = config;
    this.orchestrator = new OrchestratorClient(config);
    this.modelFactory = new ModelFactory(config);
    this.playbookCache = new PlaybookCache(this.orchestrator, config.thinkerAgentId);

    // Initialize direct Telegram client if enabled and URL provided
    if (config.telegramDirectEnabled && config.telegramDirectUrl) {
      this.telegramDirect = new TelegramDirectClient(config.telegramDirectUrl);
    }
  }

  /**
   * Initialize the agent - discover tools, etc.
   */
  async initialize(): Promise<void> {
    console.log('Initializing agent...');

    // Load custom system prompt from file if configured
    if (this.config.systemPromptPath) {
      try {
        this.customSystemPrompt = await readFile(this.config.systemPromptPath, 'utf-8');
        console.log(`Loaded custom system prompt from ${this.config.systemPromptPath} (${this.customSystemPrompt.length} chars)`);
      } catch (error) {
        console.error(`Failed to load system prompt from ${this.config.systemPromptPath}:`, error);
        // Fall through to DEFAULT_SYSTEM_PROMPT
      }
    }

    // Check Orchestrator health
    const healthy = await this.orchestrator.healthCheck();
    if (!healthy) {
      console.warn('Warning: Orchestrator is not healthy. Some features may not work.');
    }

    // Check direct Telegram connection if enabled
    if (this.telegramDirect) {
      const telegramHealthy = await this.telegramDirect.healthCheck();
      if (telegramHealthy) {
        console.log('Direct Telegram MCP connection: healthy');

        // Get bot's user ID to filter out our own messages
        const me = await this.telegramDirect.getMe();
        if (me) {
          this.botUserId = me.id;
          console.log(`Bot user ID: ${me.id}`);
        }
      } else {
        console.warn('Warning: Direct Telegram MCP is not healthy. Falling back to Orchestrator.');
        this.telegramDirect = null;
      }
    }

    // Discover tools from Orchestrator
    const orchestratorTools = await this.orchestrator.discoverTools();
    console.log(`Discovered ${orchestratorTools.length} tools from Orchestrator`);

    // Create tools from Orchestrator
    const dynamicTools = createToolsFromOrchestrator(
      orchestratorTools,
      this.orchestrator,
      () => this.currentTrace
    );

    // Create essential tools (with optional direct Telegram client)
    const essentialTools = createEssentialTools(
      this.orchestrator,
      this.config.thinkerAgentId,
      () => this.currentTrace,
      this.telegramDirect
    );

    // Merge tools (essential tools override dynamic ones)
    this.tools = { ...dynamicTools, ...essentialTools };

    console.log(`Total tools available: ${Object.keys(this.tools).length}`);

    // Seed default playbooks (idempotent) and initialize cache
    try {
      await seedPlaybooks(this.orchestrator, this.config.thinkerAgentId);
      await this.playbookCache.initialize();
      console.log(`Playbook cache loaded: ${this.playbookCache.getPlaybooks().length} playbook(s)`);
    } catch (error) {
      console.warn('Failed to initialize playbooks (non-fatal):', error);
    }
  }

  /**
   * Get or create conversation state for a chat
   */
  private getConversationState(chatId: string): AgentState {
    let state = this.conversationStates.get(chatId);

    if (!state) {
      state = {
        chatId,
        messages: [],
        lastActivity: Date.now(),
      };
      this.conversationStates.set(chatId, state);
    }

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
    const state = this.getConversationState(chatId);

    // Get profile and memories from Orchestrator
    const profile = await this.orchestrator.getProfile(this.config.thinkerAgentId, trace);
    const memories = await this.orchestrator.retrieveMemories(
      this.config.thinkerAgentId,
      userMessage,
      5,
      trace
    );

    await this.logger.logContextLoaded(trace, memories.facts.length, !!profile);

    // Build system prompt (priority: custom file > profile override > built-in default)
    let systemPrompt = this.customSystemPrompt || DEFAULT_SYSTEM_PROMPT;

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

    // Add context to system prompt
    if (memories.facts.length > 0) {
      const factsText = memories.facts
        .map((f) => `- ${f.fact} (${f.category})`)
        .join('\n');
      systemPrompt += `\n\nRelevant memories about the user:\n${factsText}`;
    }

    return {
      systemPrompt,
      conversationHistory: state.messages.slice(-30), // Keep last 30 messages (~15 exchanges)
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

    const state = this.getConversationState(message.chatId);
    const providerInfo = this.modelFactory.getProviderInfo();

    try {
      // Circuit breaker check
      if (this.circuitBreakerTripped) {
        console.warn('Circuit breaker is tripped - skipping message processing');
        return {
          success: false,
          toolsUsed: [],
          totalSteps: 0,
          error: 'Circuit breaker tripped - too many consecutive errors',
        };
      }

      // Rate limiting - ensure minimum interval between API calls
      const now = Date.now();
      const timeSinceLastCall = now - this.lastApiCallTime;
      if (timeSinceLastCall < this.minApiCallIntervalMs) {
        await new Promise((r) => setTimeout(r, this.minApiCallIntervalMs - timeSinceLastCall));
      }
      this.lastApiCallTime = Date.now();

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
      let result;
      let usedTextOnlyFallback = false;
      try {
        result = await generateText({
          model: this.modelFactory.getModel(),
          system: context.systemPrompt,
          messages: [...context.conversationHistory, { role: 'user', content: message.text }],
          tools: this.tools,
          maxSteps: 8,
        });
      } catch (toolError) {
        // If function calling fails (malformed JSON from model), retry with tools once, then fallback
        const toolErrorMsg = toolError instanceof Error ? toolError.message : '';
        const isToolCallError =
          toolErrorMsg.includes('Failed to call a function') ||
          toolErrorMsg.includes('failed_generation') ||
          toolErrorMsg.includes('tool call validation failed');
        if (isToolCallError) {
          console.warn(`Tool call failed, retrying once with tools: ${toolErrorMsg}`);

          try {
            // First retry: try again with tools (sometimes it's just a flaky response)
            result = await generateText({
              model: this.modelFactory.getModel(),
              system: context.systemPrompt,
              messages: [...context.conversationHistory, { role: 'user', content: message.text }],
              tools: this.tools,
              maxSteps: 8,
            });
          } catch (retryError) {
            // Second attempt also failed - fall back to text-only with modified prompt
            const retryErrorMsg = retryError instanceof Error ? retryError.message : '';
            console.warn(`Tool retry also failed, falling back to text-only: ${retryErrorMsg}`);

            // Modify system prompt to make clear tools are unavailable
            const textOnlyPrompt = context.systemPrompt + `

IMPORTANT: Due to a technical issue, your tools (web search, memory, etc.) are temporarily unavailable.
- If the user asks about current weather, news, or real-time data, apologize and explain you cannot search right now.
- Answer only from your built-in knowledge.
- Do NOT pretend you can look something up or "check" something - be honest that tools are unavailable.`;

            result = await generateText({
              model: this.modelFactory.getModel(),
              system: textOnlyPrompt,
              messages: [...context.conversationHistory, { role: 'user', content: message.text }],
            });
            usedTextOnlyFallback = true;
          }
        } else {
          throw toolError;
        }
      }

      // Decrement error count on success (don't fully reset — prevents breaker bypass)
      if (this.consecutiveErrors > 0) this.consecutiveErrors--;

      // Log LLM call complete
      const llmDuration = Date.now() - llmStartTime;
      await this.logger.logLLMCallComplete(
        trace,
        providerInfo.provider,
        providerInfo.model,
        result.usage?.promptTokens || 0,
        result.usage?.completionTokens || 0,
        llmDuration
      );

      // Extract and sanitize response text (removes any leaked function call syntax)
      let responseText = sanitizeResponseText(result.text || '');

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
                system: 'You are a helpful assistant. The user asked a question and tools were called to get data. Summarize the tool results into a concise, natural response for the user. Do NOT mention tools or technical details — just answer naturally.',
                messages: [
                  { role: 'user', content: message.text },
                  { role: 'user', content: `Here are the results from the tools that were called:\n\n${resultsText}` },
                ],
              });
              if (summary.text) {
                responseText = sanitizeResponseText(summary.text);
              }
            } catch (summaryError) {
              // If summarization fails, fall back to raw formatted output
              console.warn('Tool result summarization failed, using raw output:', summaryError);
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
      state.messages.push({
        role: 'assistant',
        content: responseText,
      });
      state.lastActivity = Date.now();

      // Collect tools used
      const toolsUsed = usedTextOnlyFallback
        ? ['(text-only fallback)']
        : result.steps
          .flatMap((step) => step.toolCalls?.map((tc) => tc.toolName) || []);

      // Send response to Telegram and store conversation
      // (skip when Orchestrator handles delivery — sendResponseDirectly=false)
      if (this.config.sendResponseDirectly) {
        if (this.telegramDirect) {
          await this.telegramDirect.sendMessage(message.chatId, responseText, undefined, trace);
        } else {
          await this.orchestrator.sendTelegramMessage(message.chatId, responseText, undefined, trace);
        }
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error processing message:', errorMessage);

      await this.logger.logError(trace, errorMessage);

      // Circuit breaker: track consecutive errors
      this.consecutiveErrors++;
      if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
        console.error(`CIRCUIT BREAKER TRIPPED: ${this.consecutiveErrors} consecutive errors`);
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
    notifyChatId?: string
  ): Promise<ProcessingResult & { summary: string }> {
    const trace = createTrace('thinker-skill');
    this.currentTrace = trace;

    console.log(`Processing proactive task (maxSteps: ${maxSteps})`);

    const providerInfo = this.modelFactory.getProviderInfo();

    try {
      // Rate limiting
      const now = Date.now();
      const timeSinceLastCall = now - this.lastApiCallTime;
      if (timeSinceLastCall < this.minApiCallIntervalMs) {
        await new Promise((r) => setTimeout(r, this.minApiCallIntervalMs - timeSinceLastCall));
      }
      this.lastApiCallTime = Date.now();

      // Build system prompt for autonomous task
      const systemPrompt = `${DEFAULT_SYSTEM_PROMPT}

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
      const result = await generateText({
        model: this.modelFactory.getModel(),
        system: systemPromptWithContext,
        messages: [{ role: 'user', content: taskInstructions }],
        tools: this.tools,
        maxSteps,
      });

      const responseText = sanitizeResponseText(result.text || 'Task completed without summary.');
      const toolsUsed = result.steps
        .flatMap((step) => step.toolCalls?.map((tc) => tc.toolName) || []);

      console.log(`Proactive task completed (${result.steps.length} steps, tools: ${toolsUsed.join(', ') || 'none'})`);

      // Framework: store execution summary in memory as a pattern fact
      try {
        await this.orchestrator.storeFact(
          this.config.thinkerAgentId,
          `Skill execution summary: ${responseText.substring(0, 500)}`,
          'pattern',
          trace
        );
      } catch (memError) {
        console.error('Failed to store skill execution summary in memory:', memError);
      }

      // Optionally notify via Telegram
      if (notifyChatId) {
        try {
          const notificationText = `📋 Skill completed:\n\n${responseText}`;
          if (this.telegramDirect) {
            await this.telegramDirect.sendMessage(notifyChatId, notificationText, undefined, trace);
          } else {
            await this.orchestrator.sendTelegramMessage(notifyChatId, notificationText, undefined, trace);
          }
        } catch (notifyError) {
          console.error('Failed to send skill completion notification:', notifyError);
        }
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
      console.error('Error processing proactive task:', errorMessage);

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

  /**
   * Poll for new messages and process them
   * Uses direct message fetching instead of unreliable real-time queue
   */
  async pollAndProcess(): Promise<number> {
    try {
      if (!this.telegramDirect) {
        // Fall back to old queue-based method if no direct client
        const messages = await this.orchestrator.getNewTelegramMessages(false);
        for (const msg of messages) {
          if (!msg.isOutgoing) {
            await this.processAndLog(msg);
          }
        }
        return messages.length;
      }

      // Get list of chats to monitor (refresh every 5 minutes)
      if (this.monitoredChatIds.length === 0 || Date.now() - this.lastChatRefresh > 5 * 60 * 1000) {
        await this.refreshMonitoredChats();
        this.lastChatRefresh = Date.now();
      }

      let totalProcessed = 0;

      // Poll recent messages from each monitored chat
      for (const chatId of this.monitoredChatIds) {
        const messages = await this.telegramDirect.getRecentMessages(chatId, 5);

        // Filter to new, incoming, recent messages we haven't processed
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        const newMessages = messages.filter((msg) => {
          // Skip if already processed
          if (this.processedMessageIds.has(msg.id)) {
            return false;
          }
          // Skip our own messages (outgoing)
          if (msg.senderId === this.botUserId) {
            return false;
          }
          // Skip messages without text
          if (!msg.text || msg.text.trim() === '') {
            return false;
          }
          // Skip old messages — only process messages from the last 2 minutes
          if (msg.date && msg.date < twoMinutesAgo) {
            return false;
          }
          // CRITICAL: Skip messages that look like bot-generated responses
          // This prevents infinite feedback loops where the bot processes its own messages
          const textToCheck = msg.text.trim();
          if (this.botMessagePatterns.some((pattern) => textToCheck.startsWith(pattern))) {
            console.log(`Skipping bot-like message: "${textToCheck.substring(0, 50)}..."`);
            return false;
          }
          return true;
        });

        // Process new messages (oldest first), capped to prevent runaway costs
        const MAX_MESSAGES_PER_CYCLE = 3;
        const sortedMessages = newMessages
          .sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10))
          .slice(0, MAX_MESSAGES_PER_CYCLE);

        for (const msg of sortedMessages) {
          // Mark as processed BEFORE processing to avoid duplicates
          this.processedMessageIds.add(msg.id);
          await this.processAndLog(msg);
          totalProcessed++;
        }

        // Also mark recent bot messages as processed to avoid confusion
        for (const msg of messages) {
          if (msg.senderId === this.botUserId) {
            this.processedMessageIds.add(msg.id);
          }
        }
      }

      // Cleanup old processed IDs to prevent memory leak (keep last 1000)
      if (this.processedMessageIds.size > 1000) {
        const sorted = Array.from(this.processedMessageIds).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
        const toRemove = sorted.slice(0, sorted.length - 500);
        for (const id of toRemove) {
          this.processedMessageIds.delete(id);
        }
      }

      return totalProcessed;
    } catch (error) {
      console.error('Error polling messages:', error);
      return 0;
    }
  }

  /**
   * Refresh the list of monitored chats
   */
  private async refreshMonitoredChats(): Promise<void> {
    if (!this.telegramDirect) return;

    try {
      // For now, use a simple approach: get chats from subscriptions or recent activity
      // We'll start with the subscriptions list, or fall back to discovering from messages
      const subscriptions = await this.telegramDirect.listSubscriptions();

      if (subscriptions.length > 0) {
        this.monitoredChatIds = subscriptions.filter(id => id !== this.botUserId);
        console.log(`Monitoring ${this.monitoredChatIds.length} subscribed chat(s)`);
      } else {
        // No subscriptions - auto-discover private chats (excluding bot's own Saved Messages)
        const chats = await this.telegramDirect.listChats(20);
        const privateChatIds = chats
          .filter(chat => chat.type === 'user' && chat.id !== this.botUserId)
          .map(chat => chat.id);

        if (privateChatIds.length > 0) {
          this.monitoredChatIds = privateChatIds;
          console.log(`Auto-discovered ${privateChatIds.length} chat(s) to monitor`);
        } else {
          console.log('No chats found to monitor.');
          this.monitoredChatIds = [];
        }
      }
    } catch (error) {
      console.error('Error refreshing monitored chats:', error);
    }
  }

  /**
   * Process a message and log the result
   */
  private async processAndLog(msg: { id: string; chatId: string; senderId?: string; text: string; date?: string }): Promise<void> {
    console.log(`Processing message from chat ${msg.chatId}: "${msg.text.substring(0, 50)}..."`);

    const result = await this.processMessage({
      id: msg.id,
      chatId: msg.chatId,
      senderId: msg.senderId || 'unknown',
      text: msg.text,
      date: msg.date || new Date().toISOString(),
    });

    if (result.success) {
      console.log(`Response sent (${result.totalSteps} steps, tools: ${result.toolsUsed.join(', ') || 'none'})`);
    } else {
      console.error(`Failed to process message: ${result.error}`);
    }
  }

  /**
   * Start the polling loop
   */
  startPolling(): void {
    const intervalMs = this.config.telegramPollIntervalMs;
    console.log(`Starting message polling (interval: ${intervalMs}ms)`);

    // Initial poll
    this.pollAndProcess();

    // Set up interval
    setInterval(() => {
      this.pollAndProcess();
    }, intervalMs);
  }

  /**
   * Clean up old conversation states
   */
  cleanupOldConversations(maxAgeMs: number = 30 * 60 * 1000): void {
    const now = Date.now();

    for (const [chatId, state] of this.conversationStates) {
      if (now - state.lastActivity > maxAgeMs) {
        this.conversationStates.delete(chatId);
      }
    }
  }
}
