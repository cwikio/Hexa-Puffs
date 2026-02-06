import { BaseMCPClient } from './base.js';
import { type MCPServerConfig } from '../config/index.js';

export class FilerMCPClient extends BaseMCPClient {
  constructor(config: MCPServerConfig) {
    super('filer', config);
  }

  // File operations
  async createFile(path: string, content: string, overwrite: boolean = false): Promise<unknown> {
    const result = await this.callTool({
      name: 'create_file',
      arguments: { path, content, overwrite },
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const parsed = this.parseTextResponse(result);
    return parsed || { success: false, error: 'Failed to parse response' };
  }

  async readFile(path: string): Promise<unknown> {
    const result = await this.callTool({
      name: 'read_file',
      arguments: { path },
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return this.parseTextResponse(result);
  }

  async listFiles(path: string = '.', recursive: boolean = false, pattern?: string): Promise<unknown> {
    const args: Record<string, unknown> = { path, recursive };
    if (pattern) {
      args.pattern = pattern;
    }

    const result = await this.callTool({
      name: 'list_files',
      arguments: args,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return this.parseTextResponse(result);
  }

  async updateFile(
    path: string,
    content: string,
    createBackup: boolean = true,
    append: boolean = false
  ): Promise<unknown> {
    const result = await this.callTool({
      name: 'update_file',
      arguments: { path, content, create_backup: createBackup, append },
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return this.parseTextResponse(result);
  }

  async deleteFile(path: string): Promise<unknown> {
    const result = await this.callTool({
      name: 'delete_file',
      arguments: { path },
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return this.parseTextResponse(result);
  }

  async moveFile(sourcePath: string, destPath: string): Promise<unknown> {
    const result = await this.callTool({
      name: 'move_file',
      arguments: { source: sourcePath, destination: destPath },
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return this.parseTextResponse(result);
  }

  async copyFile(sourcePath: string, destPath: string): Promise<unknown> {
    const result = await this.callTool({
      name: 'copy_file',
      arguments: { source: sourcePath, destination: destPath },
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return this.parseTextResponse(result);
  }

  async searchFiles(
    query: string,
    searchIn: 'workspace' | 'granted' | 'all' = 'workspace',
    searchType: 'filename' | 'content' = 'filename',
    fileTypes?: string[]
  ): Promise<unknown> {
    const result = await this.callTool({
      name: 'search_files',
      arguments: {
        query,
        search_in: searchIn,
        search_type: searchType,
        file_types: fileTypes,
      },
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return this.parseTextResponse(result);
  }

  // Grant operations
  async checkGrant(path: string): Promise<unknown> {
    const result = await this.callTool({
      name: 'check_grant',
      arguments: { path },
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return this.parseTextResponse(result);
  }

  async requestGrant(
    path: string,
    permission: 'read' | 'read-write' | 'write',
    reason: string
  ): Promise<unknown> {
    const result = await this.callTool({
      name: 'request_grant',
      arguments: { path, permission, reason },
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return this.parseTextResponse(result);
  }

  async listGrants(includeExpired: boolean = false): Promise<unknown> {
    const result = await this.callTool({
      name: 'list_grants',
      arguments: { include_expired: includeExpired },
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return this.parseTextResponse(result);
  }

  // Info operations
  async getWorkspaceInfo(): Promise<unknown> {
    const result = await this.callTool({
      name: 'get_workspace_info',
      arguments: {},
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return this.parseTextResponse(result);
  }

  async getAuditLog(
    limit: number = 50,
    operation?: string,
    startDate?: string,
    endDate?: string
  ): Promise<unknown> {
    const args: Record<string, unknown> = { limit };
    if (operation) {
      args.operation = operation;
    }
    if (startDate) {
      args.start_date = startDate;
    }
    if (endDate) {
      args.end_date = endDate;
    }

    const result = await this.callTool({
      name: 'get_audit_log',
      arguments: args,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return this.parseTextResponse(result);
  }
}
