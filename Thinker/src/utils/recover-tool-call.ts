/**
 * Recovery for leaked tool calls.
 *
 * Groq/Llama sometimes returns tool calls as JSON text instead of using
 * structured function calling. This module detects that pattern and
 * executes the tool directly so the user's action still happens.
 */

import type { CoreTool } from 'ai';
import { Logger } from '@mcp/shared/Utils/logger.js';

const logger = new Logger('thinker:tool-recovery');

interface LeakDetection {
  detected: boolean;
  toolName: string;
  parameters: Record<string, unknown>;
  /** Conversational text before the JSON blob (e.g. "I'll set a reminder for you.") */
  preamble: string;
}

const NO_LEAK: LeakDetection = { detected: false, toolName: '', parameters: {}, preamble: '' };

/**
 * Regex that matches JSON tool-call objects Groq tends to leak.
 * Captures: (1) tool name, (2) parameters JSON block.
 * Uses [\s\S] so it spans newlines inside the parameters object.
 */
const LEAKED_TOOL_RE = /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"parameters"\s*:\s*(\{[\s\S]*\})\s*\}/;

/**
 * Detect whether `text` contains a tool call leaked as JSON.
 * Only reports a match when the extracted tool name exists in `availableTools`
 * to avoid false positives on arbitrary user JSON.
 */
export function detectLeakedToolCall(
  text: string,
  availableTools: Record<string, CoreTool>,
): LeakDetection {
  const match = LEAKED_TOOL_RE.exec(text);
  if (!match) return NO_LEAK;

  const toolName = match[1];
  if (!(toolName in availableTools)) return NO_LEAK;

  let parameters: Record<string, unknown>;
  try {
    parameters = JSON.parse(match[2]);
  } catch {
    return NO_LEAK;
  }

  const preamble = text.substring(0, match.index).trim();

  return { detected: true, toolName, parameters, preamble };
}

interface RecoveryResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Execute a leaked tool call using the Vercel AI SDK tool's own `execute` fn.
 * This follows the exact same code path as a normal tool call.
 */
export async function recoverLeakedToolCall(
  toolName: string,
  parameters: Record<string, unknown>,
  tools: Record<string, CoreTool>,
): Promise<RecoveryResult> {
  const tool = tools[toolName];
  if (!tool || !('execute' in tool) || typeof tool.execute !== 'function') {
    return { success: false, error: `Tool "${toolName}" has no execute function` };
  }

  try {
    const result = await tool.execute(parameters, {
      toolCallId: `recovery-${Date.now()}`,
      messages: [],
    });
    logger.info(`Tool "${toolName}" executed successfully`);
    return { success: true, result };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Tool "${toolName}" execution failed: ${msg}`);
    return { success: false, error: msg };
  }
}
