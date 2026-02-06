import { JobAction, WorkflowStep } from './types.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import {
  handleTelegram,
  handleStoreFact,
  handleListFacts,
  handleDeleteFact,
  handleStoreConversation,
  handleSearchConversations,
  handleGetProfile,
  handleUpdateProfile,
  handleRetrieveMemories,
  handleGetMemoryStats,
  handleExportMemory,
  handleImportMemory,
  handleCreateFile,
  handleReadFile,
  handleListFiles,
  handleUpdateFile,
  handleDeleteFile,
  handleMoveFile,
  handleCopyFile,
  handleSearchFiles,
  handleCheckGrant,
  handleRequestGrant,
  handleListGrants,
  handleGetWorkspaceInfo,
  handleGetAuditLog,
  handlePassword,
  handleListChats,
  handleGetMessages,
  type StandardResponse,
} from '../tools/index.js';

export async function executeToolCall(
  toolName: string,
  parameters?: Record<string, unknown>
): Promise<StandardResponse> {
  // Strip namespace prefix if present (e.g., "annabelle:send_telegram" -> "send_telegram")
  const normalizedToolName = toolName.includes(':') ? toolName.split(':').pop()! : toolName;

  logger.info('Executing tool call', { toolName, normalizedToolName, parameters });

  const args = parameters || {};

  switch (normalizedToolName) {
    // Telegram tools
    case 'telegram_send_message':
    case 'send_telegram': // backward compat
      return await handleTelegram(args);

    case 'telegram_list_chats':
    case 'list_telegram_chats': // backward compat
      return await handleListChats(args);

    case 'telegram_get_messages':
    case 'get_telegram_messages': // backward compat
      return await handleGetMessages(args);

    // 1Password tools
    case 'onepassword_get_item':
    case 'get_credential': // backward compat
      return await handlePassword(args);

    // Memory tools
    case 'memory_store_fact':
    case 'store_fact': // backward compat
      return await handleStoreFact(args);

    case 'memory_list_facts':
    case 'list_facts': // backward compat
      return await handleListFacts(args);

    case 'memory_delete_fact':
    case 'delete_fact': // backward compat
      return await handleDeleteFact(args);

    case 'memory_store_conversation':
    case 'store_conversation': // backward compat
      return await handleStoreConversation(args);

    case 'memory_search_conversations':
    case 'search_conversations': // backward compat
      return await handleSearchConversations(args);

    case 'memory_get_profile':
    case 'get_profile': // backward compat
      return await handleGetProfile(args);

    case 'memory_update_profile':
    case 'update_profile': // backward compat
      return await handleUpdateProfile(args);

    case 'memory_retrieve_memories':
    case 'retrieve_memories': // backward compat
      return await handleRetrieveMemories(args);

    case 'memory_get_memory_stats':
    case 'get_memory_stats': // backward compat
      return await handleGetMemoryStats(args);

    case 'memory_export_memory':
    case 'export_memory': // backward compat
      return await handleExportMemory(args);

    case 'memory_import_memory':
    case 'import_memory': // backward compat
      return await handleImportMemory(args);

    // Filer tools
    case 'filer_create_file':
    case 'create_file': // backward compat
      return await handleCreateFile(args);

    case 'filer_read_file':
    case 'read_file': // backward compat
      return await handleReadFile(args);

    case 'filer_list_files':
    case 'list_files': // backward compat
      return await handleListFiles(args);

    case 'filer_update_file':
    case 'update_file': // backward compat
      return await handleUpdateFile(args);

    case 'filer_delete_file':
    case 'delete_file': // backward compat
      return await handleDeleteFile(args);

    case 'filer_move_file':
    case 'move_file': // backward compat
      return await handleMoveFile(args);

    case 'filer_copy_file':
    case 'copy_file': // backward compat
      return await handleCopyFile(args);

    case 'filer_search_files':
    case 'search_files': // backward compat
      return await handleSearchFiles(args);

    case 'filer_check_grant':
    case 'check_grant': // backward compat
      return await handleCheckGrant(args);

    case 'filer_request_grant':
    case 'request_grant': // backward compat
      return await handleRequestGrant(args);

    case 'filer_list_grants':
    case 'list_grants': // backward compat
      return await handleListGrants(args);

    case 'filer_get_workspace_info':
    case 'get_workspace_info': // backward compat
      return await handleGetWorkspaceInfo(args);

    case 'filer_get_audit_log':
    case 'get_audit_log': // backward compat
      return await handleGetAuditLog(args);

    default:
      throw new Error(`Unknown tool: ${normalizedToolName} (original: ${toolName})`);
  }
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
