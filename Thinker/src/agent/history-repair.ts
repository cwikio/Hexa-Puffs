import type { CoreMessage } from 'ai';
import { Logger } from '@mcp/shared/Utils/logger.js';

const logger = new Logger('thinker:history-repair');

/**
 * Truncates old tool results in conversation history to reduce token usage.
 *
 * Keeps the most recent `preserveLastN` tool-result messages intact,
 * and replaces older tool results with a one-line summary.
 * Does not mutate the input array.
 */
export function truncateHistoryToolResults(
  messages: CoreMessage[],
  preserveLastN: number = 2,
): CoreMessage[] {
  if (messages.length === 0) return [];

  // Find all indices with tool-result messages
  const toolIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'tool') toolIndices.push(i);
  }

  // If we have fewer tool messages than the preserve count, nothing to truncate
  if (toolIndices.length <= preserveLastN) return messages;

  // Indices to preserve (the last N tool messages)
  const preserveSet = new Set(
    preserveLastN > 0 ? toolIndices.slice(-preserveLastN) : [],
  );

  const result: CoreMessage[] = [];
  let truncatedCount = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === 'tool' && !preserveSet.has(i) && Array.isArray(msg.content)) {
      // Truncate this tool message's results
      const truncatedContent = msg.content.map((part) => {
        if (
          typeof part === 'object' &&
          part !== null &&
          'type' in part &&
          part.type === 'tool-result' &&
          'toolName' in part &&
          'result' in part
        ) {
          const resultJson = JSON.stringify(part.result);
          truncatedCount++;
          return {
            ...part,
            result: `[${(part as { toolName: string }).toolName}: truncated, was ${resultJson.length} chars]`,
          };
        }
        return part;
      });
      result.push({ role: 'tool', content: truncatedContent });
    } else {
      result.push(msg);
    }
  }

  if (truncatedCount > 0) {
    logger.info(`Truncated ${truncatedCount} old tool result(s) in history (preserved last ${preserveLastN})`);
  }

  return result;
}

/**
 * Extracts tool-call parts from an assistant message's content.
 * Returns an empty array if the message is not an assistant message
 * or has string content (no tool calls).
 */
function getToolCallParts(
  msg: CoreMessage
): Array<{ type: 'tool-call'; toolCallId: string; toolName: string; args: unknown }> {
  if (msg.role !== 'assistant' || typeof msg.content === 'string') return [];
  if (!Array.isArray(msg.content)) return [];
  return msg.content.filter(
    (part): part is { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown } =>
      typeof part === 'object' && part !== null && 'type' in part && part.type === 'tool-call'
  );
}

/**
 * Extracts tool-result parts from a tool message's content.
 */
function getToolResultParts(
  msg: CoreMessage
): Array<{ type: 'tool-result'; toolCallId: string; toolName: string; result: unknown }> {
  if (msg.role !== 'tool' || !Array.isArray(msg.content)) return [];
  return msg.content.filter(
    (part): part is { type: 'tool-result'; toolCallId: string; toolName: string; result: unknown } =>
      typeof part === 'object' && part !== null && 'type' in part && part.type === 'tool-result'
  );
}

/**
 * Repairs conversation history to ensure valid tool-call/tool-result pairing.
 *
 * Fixes three categories of damage:
 * 1. Leading orphan tool results (no preceding assistant tool-call) — removed
 * 2. Missing tool results (assistant has tool-calls, no tool result follows) — synthetic result inserted
 * 3. Orphaned tool results (tool-result with no matching preceding call) — removed
 *
 * Does not mutate the input array.
 */
export function repairConversationHistory(messages: CoreMessage[]): CoreMessage[] {
  if (messages.length === 0) return [];

  const repaired: CoreMessage[] = [];
  let repairs = 0;

  // Track all tool-call IDs we've seen from assistant messages
  const seenToolCallIds = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // --- Rule 1: Drop leading orphan tool results ---
    if (msg.role === 'tool' && repaired.length === 0) {
      repairs++;
      continue;
    }
    if (msg.role === 'tool' && repaired.length > 0) {
      // --- Rule 3: Drop orphaned tool results (no matching call) ---
      const resultParts = getToolResultParts(msg);
      const matchedParts = resultParts.filter((p) => seenToolCallIds.has(p.toolCallId));
      if (matchedParts.length === 0 && resultParts.length > 0) {
        repairs++;
        continue;
      }
      // If some parts match but others don't, keep only the matched ones
      if (matchedParts.length < resultParts.length && matchedParts.length > 0) {
        repairs++;
        repaired.push({ role: 'tool', content: matchedParts });
        // Clear matched IDs so they aren't matched again
        for (const p of matchedParts) seenToolCallIds.delete(p.toolCallId);
        continue;
      }
      // All parts match — keep as-is
      repaired.push(msg);
      for (const p of resultParts) seenToolCallIds.delete(p.toolCallId);
      continue;
    }

    // --- Rule 2: Check if an assistant tool-call has a matching tool result ---
    const toolCalls = getToolCallParts(msg);
    if (toolCalls.length > 0) {
      // Register these tool-call IDs
      for (const tc of toolCalls) seenToolCallIds.add(tc.toolCallId);
      repaired.push(msg);

      // Check if the next message is a matching tool result
      const next = messages[i + 1];
      if (!next || next.role !== 'tool') {
        // Missing tool result — insert synthetic one
        repairs++;
        repaired.push({
          role: 'tool',
          content: toolCalls.map((tc) => ({
            type: 'tool-result' as const,
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            result: { error: 'Tool result unavailable (recovered from broken history)' },
          })),
        });
        // Clear these IDs since we just synthesized results for them
        for (const tc of toolCalls) seenToolCallIds.delete(tc.toolCallId);
      }
      continue;
    }

    // Non-tool message (user or assistant with text content) — pass through
    repaired.push(msg);
  }

  if (repairs > 0) {
    logger.warn(`Repaired conversation history: ${repairs} fix(es) applied`);
  }

  return repaired;
}
