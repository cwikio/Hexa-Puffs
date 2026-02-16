import { Logger } from '@mcp/shared/Utils/logger.js';
import { CoreMessage, generateText, type CoreTool } from 'ai';
import { createErrorFromException } from '@mcp/shared/Types/StandardResponse.js';

import { ToolRecovery } from './tool-recovery.js';
const logger = new Logger('thinker:component:response-generator');

export class ResponseGenerator {
  constructor(
    private modelFactory: any, // Type specific to Thinker
    private toolRecovery: ToolRecovery,
    private config: any
  ) {}

  /**
   * Generate text response from the LLM, handling proactive tool forcing and hallucination guards.
   */
  async generateResponse(
    messages: CoreMessage[],
    selectedTools: Record<string, CoreTool>,
    context: {
      systemPrompt: string;
      activeChatId: string;
    },
    options: {
      temperature: number;
      signal: AbortSignal;
      onStepFinish?: (step: any) => void;
    }
  ): Promise<any> {
    const model = this.modelFactory.getModel();
    const effectiveTemperature = options.temperature; 
    let result: any;

    // ─── Proactive Tool Forcing ─────────────────────────────────────
    const hasSearchTools = !!selectedTools['searcher_web_search'] || !!selectedTools['searcher_news_search'];

    if (hasSearchTools) {
      logger.info(`[tool-enforcement] Phase 1: Forcing tool execution`);
      
      try {
        const phase1Result = await generateText({
          model,
          system: context.systemPrompt,
          messages: messages,
          tools: selectedTools,
          toolChoice: 'required', 
          maxSteps: 1, 
          temperature: Math.min(options.temperature, 0.2),
          abortSignal: options.signal,
          onStepFinish: options.onStepFinish,
        });

        const phase1UsedTools = phase1Result.steps.some((step) => step.toolCalls?.length > 0);

        if (phase1UsedTools && phase1Result.response?.messages?.length > 0) {
          // Phase 2: Continue with 'auto'
          const phase2Messages: CoreMessage[] = [
            ...messages,
            ...phase1Result.response.messages,
          ];

          result = await generateText({
            model,
            system: context.systemPrompt,
            messages: phase2Messages,
            tools: selectedTools,
            toolChoice: 'auto',
            maxSteps: 7,
            temperature: this.config.temperature,
            abortSignal: options.signal,
            onStepFinish: options.onStepFinish,
          });
        } else {
           logger.warn('[tool-enforcement] Phase 1 did not produce tool calls, falling back to auto');
           result = await generateText({
              model,
              system: context.systemPrompt,
              messages: messages,
              tools: selectedTools,
              toolChoice: 'auto',
              maxSteps: 8,
              temperature: effectiveTemperature,
              abortSignal: options.signal,
              onStepFinish: options.onStepFinish,
           });
        }
      } catch (err) {
        logger.warn('[tool-enforcement] Phase 1 failed, falling back to auto', err);
        result = await generateText({
          model,
          system: context.systemPrompt,
          messages: messages,
          tools: selectedTools,
          toolChoice: 'auto',
          maxSteps: 8,
          temperature: effectiveTemperature,
          abortSignal: options.signal,
          onStepFinish: options.onStepFinish,
        });
      }
    } else {
      // Standard single-phase
      result = await generateText({
        model,
        system: context.systemPrompt,
        messages: messages,
        tools: selectedTools,
        toolChoice: 'auto',
        maxSteps: 8,
        temperature: effectiveTemperature,
        abortSignal: options.signal,
        onStepFinish: options.onStepFinish,
      });
    }

    // ─── Post-Generation Guards & Recovery ─────────────────────────
    
    // 1. Tool Call Recovery (Leak Detection)
    const shouldCheckForLeaks = 
      result.finishReason === 'stop' &&
      (!result.toolCalls || result.toolCalls.length === 0) &&
      result.text;
      
    if (shouldCheckForLeaks) {
      const recovery = await this.toolRecovery.handleLeakedToolCall(result.text, messages, selectedTools);
      if (recovery.recovered && recovery.messages) {
        logger.info('[tool-recovery] Recovered leaked tool call, summarizing...');
        
        // Call generateText again to get the summary using the recovered messages
        // We append the recovered messages (assistant tool call + tool result) to the history
        const summaryMessages = [...messages, ...recovery.messages];
        
        const summaryResult = await generateText({
          model,
          system: context.systemPrompt,
          messages: summaryMessages,
          tools: selectedTools, // Provide tools just in case, or maybe not needed for summary?
          toolChoice: 'auto',
          maxSteps: 2,
          temperature: this.config.temperature,
          abortSignal: options.signal,
          onStepFinish: options.onStepFinish,
        });

        // We return the summary result, but we might want to expose that tools were used.
        // The loop inspects `result.steps`, so if we return summaryResult, it will see the tool calls 
        // from the summary generation (if any) but NOT the recovered ones because they are in `messages`.
        // However, `loop.ts` logic also looks at `recoveredTools` variable which I removed.
        // I need to ensure `loop.ts` can see the recovered tools.
        // `summaryResult` steps won't contain the leaked tool call (it's in history).
        
        // Workaround: Modify the result to "include" the leaked tool usage?
        // Or better: `loop.ts` should rely on what `ResponseGenerator` tells it.
        // But `loop.ts` relies on `result.steps`.
        
        // I'll return the summaryResult, but I'll patch it?
        // Actually, `loop.ts` computes `toolsUsed` from `result.steps` AND `capturedSteps`.
        // Since `recoverLeakedToolCall` (the component) *returns* the result, it doesn't add to `capturedSteps` via `onStepFinish`.
        
        // We can manually call `onStepFinish` here with the recovered step!
        if (options.onStepFinish && recovery.messages.length === 2) {
             const toolCallMsg = recovery.messages[0];
             const toolResultMsg = recovery.messages[1];
             if (Array.isArray(toolCallMsg.content) && Array.isArray(toolResultMsg.content)) {
                 // Reconstruct a step-like object
                 const toolCalls = toolCallMsg.content
                    .filter(c => c.type === 'tool-call')
                    .map(c => ({ toolCallId: (c as any).toolCallId, toolName: (c as any).toolName, args: (c as any).args }));
                 const toolResults = toolResultMsg.content
                    .filter(c => c.type === 'tool-result')
                    .map(c => ({ toolCallId: (c as any).toolCallId, toolName: (c as any).toolName, result: (c as any).result }));
                 
                 options.onStepFinish({
                     text: result.text, // The leaked text
                     toolCalls,
                     toolResults,
                     finishReason: 'stop',
                     usage: { promptTokens: 0, completionTokens: 0 }, // approximation
                     isContinued: false
                 });
             }
        }
        
        result = summaryResult;
      }
    }

    // 2. Hallucination Guard (Action claimed, no tools)
    // (Simplification: relying on retry if needed, similar to Phase 1 check or separate check)
    // For now, I'll port the basic check.
    const responseText = result.text || '';
    const noToolsUsed = result.steps?.every((step: any) => !step.toolCalls?.length);
    
    if (noToolsUsed && responseText) {
         const actionClaimedPattern = /I('ve| have) (created|sent|scheduled|deleted|updated|added|removed|set up|stored|saved|found|searched|looked up|checked|gone ahead)|has been (created|sent|scheduled|deleted|updated|added|removed|stored|saved)|Event details:|Email sent|event .* (created|scheduled)|calendar .* (updated|created)|Here's the email I sent|I've gone ahead and|I searched for|I looked up|I checked your|The results show|I found the following/i;
         
         if (actionClaimedPattern.test(responseText)) {
             logger.warn(`[hallucination-guard] Model claimed action without tool calls, retrying with toolChoice: required`);
             try {
                 const retryResult = await generateText({
                   model,
                   system: context.systemPrompt,
                   messages: messages,
                   tools: selectedTools,
                   toolChoice: 'required',
                   maxSteps: 8,
                   temperature: Math.min(this.config.temperature, 0.3),
                   abortSignal: options.signal,
                   onStepFinish: options.onStepFinish,
                 });
                 if (retryResult.steps.some((step) => step.toolCalls?.length > 0)) {
                     result = retryResult;
                 }
             } catch (e) {
                 logger.warn('[hallucination-guard] Retry failed', e);
             }
         }
    }

    // 3. Tool Refusal Guard ("I can't do that...")
    if (hasSearchTools) {
       const toolRefusalPattern = /(?:I (?:don't|do not|can't|cannot|am unable to|'m unable to|won't be able to|currently (?:don't|can't|cannot)) (?:have |)(?:access to |access |provide |get |fetch |retrieve )?(?:real[- ]time|current|live|up[- ]to[- ]date|today's) (?:information|data|weather|news|updates|results))|(?:(?:tools|search|internet|web|real-time (?:data|info)) (?:is|are) (?:temporarily |currently )?(?:unavailable|not available|inaccessible|down))/i;
       if (toolRefusalPattern.test(result.text || '')) {
           logger.warn(`[tool-refusal-guard] Refusal detected, forcing tool call`);
             try {
                 const retryResult = await generateText({
                   model,
                   system: context.systemPrompt,
                   messages: messages,
                   tools: selectedTools,
                   toolChoice: 'required',
                   maxSteps: 8,
                   temperature: Math.min(this.config.temperature, 0.2),
                   abortSignal: options.signal,
                   onStepFinish: options.onStepFinish,
                 });
                 if (retryResult.steps.some((step) => step.toolCalls?.length > 0)) {
                     result = retryResult;
                 }
             } catch (e) {
                 logger.warn('[tool-refusal-guard] Retry failed', e);
             }
       }
    }

    return result;
  }
}
