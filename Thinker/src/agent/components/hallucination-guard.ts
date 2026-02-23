/**
 * HallucinationGuard — detects and retries when the LLM claims actions without tool calls.
 *
 * Two guards:
 * 1. Action Hallucination: model says "I've sent the email" but called no tools
 * 2. Tool Refusal: model says "I can't access real-time data" despite having search tools
 *
 * Extracted from Agent (loop.ts) for testability and separation of concerns.
 */

import { generateText, type CoreMessage, type CoreTool } from 'ai';
import type { AgentContext } from '../types.js';
import type { ModelFactory } from '../../llm/factory.js';
import type { CostMonitor } from '../../cost/index.js';
import { sanitizeResponseText } from '../../utils/sanitize.js';
import { Logger } from '@mcp/shared/Utils/logger.js';

const logger = new Logger('thinker:hallucination-guard');

// ─── Pattern Matchers (exported for unit testing) ──────────────────

export const ACTION_CLAIMED_PATTERN =
  /I('ve| have) (created|sent|scheduled|deleted|updated|added|removed|set up|stored|saved|found|searched|looked up|checked|gone ahead)|has been (created|sent|scheduled|deleted|updated|added|removed|stored|saved)|Event details:|Email sent|event .* (created|scheduled)|calendar .* (updated|created)|Here's the email I sent|I've gone ahead and|I searched for|I looked up|I checked your|The results show|I found the following/i;

export const TOOL_REFUSAL_PATTERN =
  /(?:I (?:don't|do not|can't|cannot|am unable to|'m unable to|won't be able to|currently (?:don't|can't|cannot)) (?:have |)(?:access to |access |provide |get |fetch |retrieve )?(?:real[- ]time|current|live|up[- ]to[- ]date|today's) (?:information|data|weather|news|updates|results))|(?:(?:tools|search|internet|web|real-time (?:data|info)) (?:is|are) (?:temporarily |currently )?(?:unavailable|not available|inaccessible|down))/i;

export function detectActionHallucination(responseText: string): boolean {
  return ACTION_CLAIMED_PATTERN.test(responseText);
}

export function detectToolRefusal(responseText: string, hasSearchTools: boolean): boolean {
  return hasSearchTools && TOOL_REFUSAL_PATTERN.test(responseText);
}

// ─── Guard Result ──────────────────────────────────────────────────

export interface GuardResult {
  /** Whether the guard was applied (retry was attempted) */
  applied: boolean;
  /** The new generateText result (if retry succeeded) */
  result?: Awaited<ReturnType<typeof generateText>>;
  /** Sanitized response text from the retry */
  responseText?: string;
  /** Tool names recovered via forced calls */
  recoveredTools?: string[];
}

// ─── Retry Parameters ──────────────────────────────────────────────

export interface GuardParams {
  context: AgentContext;
  userMessage: string;
  selectedTools: Record<string, CoreTool>;
  temperature: number;
  abortSignal: AbortSignal;
  onStepFinish: (event: unknown) => void | Promise<void>;
}

// ─── HallucinationGuard Class ──────────────────────────────────────

export class HallucinationGuard {
  constructor(
    private modelFactory: ModelFactory,
    private costMonitor: CostMonitor | null,
  ) {}

  /**
   * Retry with toolChoice: 'required' when the model hallucinated an action.
   */
  async retryActionHallucination(params: GuardParams): Promise<GuardResult> {
    logger.warn('[hallucination-guard] Model claimed action without tool calls, retrying with toolChoice: required');

    try {
      const retryResult = await generateText({
        model: this.modelFactory.getModel(),
        system: params.context.systemPrompt,
        messages: [
          ...params.context.conversationHistory,
          { role: 'user', content: params.userMessage },
        ],
        tools: params.selectedTools,
        toolChoice: 'required' as const,
        maxSteps: 8,
        temperature: Math.min(params.temperature, 0.3),
        abortSignal: params.abortSignal,
        onStepFinish: params.onStepFinish,
      });

      this.costMonitor?.recordUsage(
        retryResult.usage?.promptTokens || 0,
        retryResult.usage?.completionTokens || 0,
      );

      const retryUsedTools = retryResult.steps.some(
        (step: { toolCalls?: unknown[] }) => step.toolCalls && step.toolCalls.length > 0,
      );

      if (retryUsedTools) {
        logger.info('[hallucination-guard] Retry successful — tools were called');
        return {
          applied: true,
          result: retryResult,
          responseText: sanitizeResponseText(retryResult.text || ''),
        };
      }

      logger.warn('[hallucination-guard] Retry still did not call tools, using disclaimer');
      return {
        applied: true,
        responseText: "I wasn't able to complete this action. Please try again.",
      };
    } catch (retryError) {
      logger.warn('[hallucination-guard] Retry failed:', retryError);
      return {
        applied: true,
        responseText: "I wasn't able to complete this action. Please try again.",
      };
    }
  }

  /**
   * Two-phase forced tool call when the model refuses to use available tools.
   *
   * Phase 1: Force a single tool call (maxSteps: 1 to avoid Groq crash)
   * Phase 2: Continue with 'auto' so the model can summarize the tool results
   */
  async retryToolRefusal(params: GuardParams): Promise<GuardResult> {
    logger.warn('[tool-refusal-guard] Model refused to use tools despite having search tools — forcing tool call');

    try {
      // Phase 1: Force a single tool call
      const forcedResult = await generateText({
        model: this.modelFactory.getModel(),
        system: params.context.systemPrompt,
        messages: [
          ...params.context.conversationHistory,
          { role: 'user', content: params.userMessage },
        ],
        tools: params.selectedTools,
        toolChoice: 'required' as const,
        maxSteps: 1,
        temperature: Math.min(params.temperature, 0.2),
        abortSignal: params.abortSignal,
        onStepFinish: params.onStepFinish,
      });

      this.costMonitor?.recordUsage(
        forcedResult.usage?.promptTokens || 0,
        forcedResult.usage?.completionTokens || 0,
      );

      const forcedUsedTools = forcedResult.steps.some(
        (step: { toolCalls?: unknown[] }) => step.toolCalls && step.toolCalls.length > 0,
      );

      if (!forcedUsedTools) {
        logger.warn('[tool-refusal-guard] Forced call still did not produce tool calls');
        return { applied: false };
      }

      // Phase 2: Continue with 'auto' to summarize
      const toolResultMessages: CoreMessage[] = [
        ...params.context.conversationHistory,
        { role: 'user' as const, content: params.userMessage },
        ...forcedResult.response.messages,
      ];

      const followUpResult = await generateText({
        model: this.modelFactory.getModel(),
        system: params.context.systemPrompt,
        messages: toolResultMessages,
        tools: params.selectedTools,
        toolChoice: 'auto' as const,
        maxSteps: 4,
        temperature: params.temperature,
        abortSignal: params.abortSignal,
        onStepFinish: params.onStepFinish,
      });

      this.costMonitor?.recordUsage(
        followUpResult.usage?.promptTokens || 0,
        followUpResult.usage?.completionTokens || 0,
      );

      const forcedToolNames = forcedResult.steps.flatMap(
        (step: { toolCalls?: Array<{ toolName: string }> }) =>
          step.toolCalls?.map((tc) => tc.toolName) || [],
      );

      logger.info('[tool-refusal-guard] Forced tool call + follow-up successful');
      return {
        applied: true,
        result: followUpResult,
        responseText: sanitizeResponseText(followUpResult.text || ''),
        recoveredTools: forcedToolNames,
      };
    } catch (refusalRetryError) {
      logger.warn('[tool-refusal-guard] Forced retry failed:', refusalRetryError);
      return { applied: false };
    }
  }
}
