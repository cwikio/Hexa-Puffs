import { JobAction, WorkflowStep } from './types.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import type { ToolCallResult } from '../mcp-clients/types.js';

interface StandardResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Backward-compatible tool name mapping.
 * Old names (used by existing saved jobs) → current ToolRouter names.
 */
const BACKWARD_COMPAT_MAP: Record<string, string> = {
  'send_telegram': 'telegram_send_message',
  'list_telegram_chats': 'telegram_list_chats',
  'get_telegram_messages': 'telegram_get_messages',
  'get_credential': 'onepassword_get_item',
  'store_fact': 'memory_store_fact',
  'list_facts': 'memory_list_facts',
  'delete_fact': 'memory_delete_fact',
  'store_conversation': 'memory_store_conversation',
  'search_conversations': 'memory_search_conversations',
  'get_profile': 'memory_get_profile',
  'update_profile': 'memory_update_profile',
  'retrieve_memories': 'memory_retrieve_memories',
  'get_memory_stats': 'memory_get_memory_stats',
  'export_memory': 'memory_export_memory',
  'import_memory': 'memory_import_memory',
  'create_file': 'filer_create_file',
  'read_file': 'filer_read_file',
  'list_files': 'filer_list_files',
  'update_file': 'filer_update_file',
  'delete_file': 'filer_delete_file',
  'move_file': 'filer_move_file',
  'copy_file': 'filer_copy_file',
  'search_files': 'filer_search_files',
  'check_grant': 'filer_check_grant',
  'request_grant': 'filer_request_grant',
  'list_grants': 'filer_list_grants',
  'get_workspace_info': 'filer_get_workspace_info',
  'get_audit_log': 'filer_get_audit_log',
  'backfill_extract_facts': 'memory_backfill_extract_facts',
  'synthesize_facts': 'memory_synthesize_facts',
};

/**
 * Parse a ToolCallResult from the ToolRouter into a StandardResponse.
 * MCP responses come wrapped as { success, content: { content: [{ type, text }] } }.
 */
function parseToolCallResult(result: ToolCallResult): StandardResponse {
  if (!result.success) {
    return { success: false, error: result.error || 'Tool call failed' };
  }

  const mcpResponse = result.content as { content?: Array<{ type: string; text?: string }> } | undefined;
  const innerText = mcpResponse?.content?.[0]?.text;

  if (innerText) {
    try {
      return JSON.parse(innerText) as StandardResponse;
    } catch {
      return { success: true, data: innerText };
    }
  }

  return { success: true, data: result.content };
}

export async function executeToolCall(
  toolName: string,
  parameters?: Record<string, unknown>
): Promise<StandardResponse> {
  // Strip namespace prefix if present (e.g., "annabelle:send_telegram" -> "send_telegram")
  let normalized = toolName.includes(':') ? toolName.split(':').pop()! : toolName;

  // Map backward-compatible names to current ToolRouter names
  normalized = BACKWARD_COMPAT_MAP[normalized] || normalized;

  logger.info('Executing tool call via ToolRouter', { toolName, normalized, parameters });

  const { getOrchestrator } = await import('../core/orchestrator.js');
  const orchestrator = await getOrchestrator();
  const toolRouter = orchestrator.getToolRouter();

  // Safety net: auto-inject chat_id for telegram_send_message when missing
  if (normalized === 'telegram_send_message' && parameters && !parameters.chat_id) {
    const chatIds = orchestrator.getChannelManager()?.getAdapter('telegram')?.getMonitoredChatIds() ?? [];
    if (chatIds.length > 0) {
      parameters.chat_id = chatIds[0];
      logger.info('Auto-injected chat_id for telegram_send_message', { chat_id: chatIds[0] });
    }
  }

  if (!toolRouter.hasRoute(normalized)) {
    throw new Error(`Unknown tool: ${normalized} (original: ${toolName}). Available tools: ${toolRouter.getToolDefinitions().map(t => t.name).join(', ')}`);
  }

  const result = await toolRouter.routeToolCall(normalized, parameters || {});
  return parseToolCallResult(result);
}

export async function executeWorkflow(
  steps: WorkflowStep[]
): Promise<Record<string, StandardResponse>> {
  logger.info('Executing workflow', { stepCount: steps.length });

  const results: Record<string, StandardResponse> = {};
  const completed = new Set<string>();

  // Simple sequential execution (can be improved with parallel execution later)
  for (const step of steps) {
    // Wait for dependencies
    if (step.dependsOn) {
      for (const depId of step.dependsOn) {
        if (!completed.has(depId)) {
          throw new Error(`Step ${step.id} depends on ${depId} which hasn't completed`);
        }
      }
    }

    // Execute step
    try {
      results[step.id] = await executeToolCall(step.toolName, step.parameters);
      completed.add(step.id);
      logger.debug('Workflow step completed', { stepId: step.id });
    } catch (error) {
      logger.error('Workflow step failed', { stepId: step.id, error });
      throw error;
    }
  }

  return results;
}

export async function executeAction(action: JobAction): Promise<StandardResponse | Record<string, StandardResponse>> {
  if (action.type === 'tool_call') {
    return await executeToolCall(action.toolName!, action.parameters);
  } else {
    return await executeWorkflow(action.workflowSteps!);
  }
}
