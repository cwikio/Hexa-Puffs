
import { Logger } from '@mcp/shared/Utils/logger.js';
import { CoreMessage } from 'ai';
import { detectLeakedToolCall, recoverLeakedToolCall } from '../../utils/recover-tool-call.js';

const logger = new Logger('thinker:component:tool-recovery');

export class ToolRecovery {
  /**
   * Check if the model output contains a "leaked" tool call (JSON that wasn't properly structured as a tool call).
   * If detected, attempts to repair it and execute the tool call.
   */
  async handleLeakedToolCall(
    text: string,
    history: CoreMessage[],
    availableTools: Record<string, any>
  ): Promise<{ recovered: boolean; messages?: CoreMessage[] }> {
    const leak = detectLeakedToolCall(text, availableTools);
    if (!leak) {
      return { recovered: false };
    }

    logger.warn('Detected leaked tool call in text content', { leak });

    if (!availableTools[leak.toolName]) {
      logger.warn(`Leaked tool '${leak.toolName}' is not available/selected - cannot recover`);
      return { recovered: false };
    }

    // Attempt recovery
    const recovered = await recoverLeakedToolCall(leak.toolName, leak.parameters, availableTools);
    if (recovered) {
      logger.info(`Successfully recovered leaked tool call '${leak.toolName}'`, { result: recovered.result });

      // Add the implicit tool call and result to history so the model sees it happened
      const newMessages: CoreMessage[] = [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: "I'll run that tool for you." },
            {
              type: 'tool-call',
              toolCallId: recovered.toolCallId || 'unknown-id',
              toolName: leak.toolName,
              args: leak.parameters,
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: recovered.toolCallId || 'unknown-id',
              toolName: leak.toolName,
              result: recovered.result,
            },
          ],
        },
      ];

      return { recovered: true, messages: newMessages };
    }

    return { recovered: false };
  }
}
