import { BaseMCPClient, type ToolCallResult } from '../mcp-clients/base.js';
import { TelegramMCPClient } from '../mcp-clients/telegram.js';
import { OnePasswordMCPClient } from '../mcp-clients/onepassword.js';
import { FilerMCPClient } from '../mcp-clients/filer.js';
import { SecurityCoordinator } from './security.js';
import { ToolExecutionError } from '../utils/errors.js';
import { logger, Logger } from '../../../Shared/Utils/logger.js';

export interface ToolRegistry {
  telegram: TelegramMCPClient;
  onepassword: OnePasswordMCPClient;
  filer: FilerMCPClient;
}

export interface ToolExecution {
  tool: string;
  params: Record<string, unknown>;
  result: ToolCallResult;
  executedAt: Date;
}

export class ToolExecutor {
  private registry: ToolRegistry;
  private security: SecurityCoordinator;
  private sensitiveTools: Set<string>;
  private logger: Logger;
  private executions: ToolExecution[] = [];

  constructor(
    registry: ToolRegistry,
    security: SecurityCoordinator,
    sensitiveTools: string[] = []
  ) {
    this.registry = registry;
    this.security = security;
    this.sensitiveTools = new Set(sensitiveTools);
    this.logger = logger.child('tools');
  }

  async executeTelegram(
    message: string,
    chatId?: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const tool = 'telegram_send';
    this.logger.debug('Executing telegram send', { hasMessage: !!message, hasChatId: !!chatId });

    if (!this.registry.telegram.isAvailable) {
      return { success: false, error: 'Telegram MCP is unavailable' };
    }

    // Security scan for sensitive output
    if (this.sensitiveTools.has(tool)) {
      const scanResult = await this.security.scanOutput(message, tool);
      if (!scanResult.allowed) {
        return { success: false, error: `Blocked by security: ${scanResult.reason}` };
      }
    }

    const result = await this.registry.telegram.sendMessage(message, chatId);

    this.logExecution(tool, { message: message.substring(0, 50), chatId }, {
      success: result.success,
      content: result,
    });

    return result;
  }

  async listTelegramChats(limit: number = 20): Promise<{ success: boolean; chats?: unknown; error?: string }> {
    const tool = 'telegram_list_chats';
    this.logger.debug('Listing telegram chats', { limit });

    if (!this.registry.telegram.isAvailable) {
      return { success: false, error: 'Telegram MCP is unavailable' };
    }

    try {
      const result = await this.registry.telegram.listChats(limit);

      this.logExecution(tool, { limit }, { success: true, content: result });

      return {
        success: true,
        chats: result,
      };
    } catch (error) {
      this.logger.error('List chats failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getTelegramMessages(
    chatId: string,
    limit: number = 10
  ): Promise<{ success: boolean; messages?: unknown; error?: string }> {
    const tool = 'telegram_get_messages';
    this.logger.debug('Getting telegram messages', { chatId, limit });

    if (!this.registry.telegram.isAvailable) {
      return { success: false, error: 'Telegram MCP is unavailable' };
    }

    try {
      const result = await this.registry.telegram.getMessages(chatId, limit);

      this.logExecution(tool, { chatId, limit }, { success: true, content: result });

      return {
        success: true,
        messages: result,
      };
    } catch (error) {
      this.logger.error('Get messages failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async executePassword(
    itemName: string,
    vault?: string
  ): Promise<{ found: boolean; item?: unknown; error?: string }> {
    const tool = 'onepassword_get';
    this.logger.debug('Executing 1password get', { itemName, vault });

    if (!this.registry.onepassword.isAvailable) {
      return { found: false, error: '1Password MCP is unavailable' };
    }

    const result = await this.registry.onepassword.getItem(itemName, vault);

    // Note: We don't log the actual credentials for security
    this.logExecution(tool, { itemName, vault }, {
      success: result.found,
      content: { found: result.found },
    });

    if (result.found && result.item) {
      // Security scan the output to prevent credential leakage
      if (this.sensitiveTools.has(tool)) {
        const itemStr = JSON.stringify(result.item);
        const scanResult = await this.security.scanOutput(itemStr, tool);
        if (!scanResult.allowed) {
          return { found: false, error: `Blocked by security: ${scanResult.reason}` };
        }
      }
    }

    return result;
  }

  async executeFiler(operation: string, params: Record<string, unknown>): Promise<unknown> {
    const tool = `filer_${operation}`;
    this.logger.debug('Executing filer operation', { operation, params });

    if (!this.registry.filer.isAvailable) {
      return { success: false, error: 'Filer MCP is unavailable' };
    }

    // Security scan for file content operations
    if (this.sensitiveTools.has(tool) && (params.content || params.query)) {
      const contentToScan = (params.content || params.query) as string;
      const scanResult = await this.security.scanOutput(contentToScan, tool);
      if (!scanResult.allowed) {
        return { success: false, error: `Blocked by security: ${scanResult.reason}` };
      }
    }

    let result: unknown;
    switch (operation) {
      case 'create_file':
        result = await this.registry.filer.createFile(
          params.path as string,
          params.content as string,
          params.overwrite as boolean
        );
        break;
      case 'read_file':
        result = await this.registry.filer.readFile(params.path as string);
        break;
      case 'list_files':
        result = await this.registry.filer.listFiles(
          params.path as string,
          params.recursive as boolean
        );
        break;
      case 'update_file':
        result = await this.registry.filer.updateFile(
          params.path as string,
          params.content as string,
          params.create_backup as boolean
        );
        break;
      case 'delete_file':
        result = await this.registry.filer.deleteFile(params.path as string);
        break;
      case 'move_file':
        result = await this.registry.filer.moveFile(
          params.source as string,
          params.destination as string
        );
        break;
      case 'copy_file':
        result = await this.registry.filer.copyFile(
          params.source as string,
          params.destination as string
        );
        break;
      case 'search_files':
        result = await this.registry.filer.searchFiles(
          params.query as string,
          params.search_in as 'workspace' | 'granted' | 'all',
          params.search_type as 'filename' | 'content',
          params.file_types as string[] | undefined
        );
        break;
      case 'check_grant':
        result = await this.registry.filer.checkGrant(params.path as string);
        break;
      case 'request_grant':
        result = await this.registry.filer.requestGrant(
          params.path as string,
          params.permission as 'read' | 'read-write',
          params.reason as string
        );
        break;
      case 'list_grants':
        result = await this.registry.filer.listGrants(params.include_expired as boolean);
        break;
      case 'get_workspace_info':
        result = await this.registry.filer.getWorkspaceInfo();
        break;
      case 'get_audit_log':
        result = await this.registry.filer.getAuditLog(
          params.limit as number,
          params.operation as string | undefined,
          params.start_date as string | undefined,
          params.end_date as string | undefined
        );
        break;
      default:
        throw new ToolExecutionError(`Unknown filer operation: ${operation}`, tool);
    }

    this.logExecution(tool, params, {
      success: true,
      content: result,
    });

    return result;
  }

  private logExecution(
    tool: string,
    params: Record<string, unknown>,
    result: ToolCallResult
  ): void {
    const execution: ToolExecution = {
      tool,
      params,
      result,
      executedAt: new Date(),
    };
    this.executions.push(execution);

    // Keep only last 100 executions
    if (this.executions.length > 100) {
      this.executions = this.executions.slice(-100);
    }
  }

  getRecentExecutions(limit: number = 10): ToolExecution[] {
    return this.executions.slice(-limit);
  }

  getAvailableTools(): string[] {
    const tools: string[] = [];

    if (this.registry.telegram.isAvailable) {
      tools.push('telegram_send', 'telegram_get_messages');
    }

    if (this.registry.onepassword.isAvailable) {
      tools.push('onepassword_get', 'onepassword_list_vaults');
    }

    if (this.registry.filer.isAvailable) {
      tools.push(
        'filer_create_file',
        'filer_read_file',
        'filer_list_files',
        'filer_update_file',
        'filer_delete_file',
        'filer_move_file',
        'filer_copy_file',
        'filer_search_files',
        'filer_check_grant',
        'filer_request_grant',
        'filer_list_grants',
        'filer_get_workspace_info',
        'filer_get_audit_log'
      );
    }

    return tools;
  }

  getToolStatus(): Record<string, { available: boolean; required: boolean }> {
    return {
      telegram: {
        available: this.registry.telegram.isAvailable,
        required: this.registry.telegram.isRequired,
      },
      onepassword: {
        available: this.registry.onepassword.isAvailable,
        required: this.registry.onepassword.isRequired,
      },
      filer: {
        available: this.registry.filer.isAvailable,
        required: this.registry.filer.isRequired,
      },
    };
  }
}
