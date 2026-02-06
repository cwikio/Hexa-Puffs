import { z } from 'zod';
import { getOrchestrator } from '../core/orchestrator.js';
import type { StandardResponse } from '@mcp/shared/Types/StandardResponse.js';

// Tool definitions - matching Filer's interface exactly

// File Operations (8 tools)

export const createFileToolDefinition = {
  name: 'create_file',
  description:
    'Create a file in AI workspace. Path must be relative (e.g., Documents/reports/analysis.md). Content is security-scanned before creation.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Relative path within workspace (e.g., Documents/reports/analysis.md)',
      },
      content: {
        type: 'string',
        description: 'File content to write',
      },
      overwrite: {
        type: 'boolean',
        description: 'Whether to overwrite if file exists',
        default: false,
      },
    },
    required: ['path', 'content'],
  },
};

export const readFileToolDefinition = {
  name: 'read_file',
  description: 'Read file contents from workspace or granted paths. Max 50MB file size.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Relative path (workspace) or absolute path (if granted)',
      },
    },
    required: ['path'],
  },
};

export const listFilesToolDefinition = {
  name: 'list_files',
  description: 'List directory contents from workspace or granted paths.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to list',
        default: '.',
      },
      recursive: {
        type: 'boolean',
        description: 'Whether to list recursively',
        default: false,
      },
    },
  },
};

export const updateFileToolDefinition = {
  name: 'update_file',
  description: 'Update existing file. Creates .bak backup by default. Content is security-scanned.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Relative path within workspace',
      },
      content: {
        type: 'string',
        description: 'New file content',
      },
      create_backup: {
        type: 'boolean',
        description: 'Whether to create .bak backup',
        default: true,
      },
    },
    required: ['path', 'content'],
  },
};

export const deleteFileToolDefinition = {
  name: 'delete_file',
  description: 'Delete a file from workspace. Workspace only.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Relative path within workspace',
      },
    },
    required: ['path'],
  },
};

export const moveFileToolDefinition = {
  name: 'move_file',
  description: 'Move or rename a file within workspace. Workspace only.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      source: {
        type: 'string',
        description: 'Source path (relative within workspace)',
      },
      destination: {
        type: 'string',
        description: 'Destination path (relative within workspace)',
      },
    },
    required: ['source', 'destination'],
  },
};

export const copyFileToolDefinition = {
  name: 'copy_file',
  description: 'Copy a file. Can copy from granted paths into workspace.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      source: {
        type: 'string',
        description: 'Source path (workspace or granted absolute path)',
      },
      destination: {
        type: 'string',
        description: 'Destination path (must be relative workspace path)',
      },
    },
    required: ['source', 'destination'],
  },
};

export const searchFilesToolDefinition = {
  name: 'search_files',
  description: 'Search for files by filename or content. Max 100 results.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search query (filename pattern or content text)',
      },
      search_in: {
        type: 'string',
        description: 'Where to search',
        enum: ['workspace', 'granted', 'all'],
        default: 'workspace',
      },
      search_type: {
        type: 'string',
        description: 'Search in filename or file content',
        enum: ['filename', 'content'],
        default: 'filename',
      },
      file_types: {
        type: 'array',
        description: 'Filter by file extensions (e.g., [".md", ".txt"])',
        items: {
          type: 'string',
        },
      },
    },
    required: ['query'],
  },
};

// Grant Operations (3 tools)

export const checkGrantToolDefinition = {
  name: 'check_grant',
  description: 'Check if access is granted to an external path.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Path to check access for',
      },
    },
    required: ['path'],
  },
};

export const requestGrantToolDefinition = {
  name: 'request_grant',
  description: 'Request access to an external path. Returns configuration instructions.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Path to request access for',
      },
      permission: {
        type: 'string',
        description: 'Permission level requested',
        enum: ['read', 'read-write', 'write'],
      },
      reason: {
        type: 'string',
        description: 'Reason for requesting access',
      },
    },
    required: ['path', 'permission', 'reason'],
  },
};

export const listGrantsToolDefinition = {
  name: 'list_grants',
  description: 'List all active grants and their permissions.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      include_expired: {
        type: 'boolean',
        description: 'Whether to include expired grants',
        default: false,
      },
    },
  },
};

// Info Operations (2 tools)

export const getWorkspaceInfoToolDefinition = {
  name: 'get_workspace_info',
  description: 'Get workspace location and statistics.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
};

export const getAuditLogToolDefinition = {
  name: 'get_audit_log',
  description: 'Get file operation audit log.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of entries to return',
        default: 50,
      },
      operation: {
        type: 'string',
        description: 'Filter by operation type',
      },
      start_date: {
        type: 'string',
        description: 'Filter entries after this date (ISO 8601)',
      },
      end_date: {
        type: 'string',
        description: 'Filter entries before this date (ISO 8601)',
      },
    },
  },
};

// Zod validation schemas

const CreateFileInputSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  overwrite: z.boolean().default(false),
});

const ReadFileInputSchema = z.object({
  path: z.string().min(1),
});

const ListFilesInputSchema = z.object({
  path: z.string().default('.'),
  recursive: z.boolean().default(false),
});

const UpdateFileInputSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  create_backup: z.boolean().default(true),
});

const DeleteFileInputSchema = z.object({
  path: z.string().min(1),
});

const MoveFileInputSchema = z.object({
  source: z.string().min(1),
  destination: z.string().min(1),
});

const CopyFileInputSchema = z.object({
  source: z.string().min(1),
  destination: z.string().min(1),
});

const SearchFilesInputSchema = z.object({
  query: z.string().min(1),
  search_in: z.enum(['workspace', 'granted', 'all']).default('workspace'),
  search_type: z.enum(['filename', 'content']).default('filename'),
  file_types: z.array(z.string()).optional(),
});

const CheckGrantInputSchema = z.object({
  path: z.string().min(1),
});

const RequestGrantInputSchema = z.object({
  path: z.string().min(1),
  permission: z.enum(['read', 'read-write', 'write']),
  reason: z.string().min(1),
});

const ListGrantsInputSchema = z.object({
  include_expired: z.boolean().default(false),
});

const GetWorkspaceInfoInputSchema = z.object({});

const GetAuditLogInputSchema = z.object({
  limit: z.number().default(50),
  operation: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

// Handler functions

export async function handleCreateFile(args: unknown): Promise<StandardResponse> {
  const parseResult = CreateFileInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { path, content, overwrite } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.createFile(path, content, overwrite);
    // Result is already in StandardResponse format from MCP client
    return result as StandardResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleReadFile(args: unknown): Promise<StandardResponse> {
  const parseResult = ReadFileInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { path } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.readFile(path);
    // Result is already in StandardResponse format from MCP client
    return result as StandardResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleListFiles(args: unknown): Promise<StandardResponse> {
  const parseResult = ListFilesInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { path, recursive } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.listFiles(path, recursive);
    // Result is already in StandardResponse format from MCP client
    return result as StandardResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleUpdateFile(args: unknown): Promise<StandardResponse> {
  const parseResult = UpdateFileInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { path, content, create_backup } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.updateFile(path, content, create_backup);
    // Result is already in StandardResponse format from MCP client
    return result as StandardResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleDeleteFile(args: unknown): Promise<StandardResponse> {
  const parseResult = DeleteFileInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { path } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.deleteFile(path);
    // Result is already in StandardResponse format from MCP client
    return result as StandardResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleMoveFile(args: unknown): Promise<StandardResponse> {
  const parseResult = MoveFileInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { source, destination } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.moveFile(source, destination);
    // Result is already in StandardResponse format from MCP client
    return result as StandardResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleCopyFile(args: unknown): Promise<StandardResponse> {
  const parseResult = CopyFileInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { source, destination } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.copyFile(source, destination);
    // Result is already in StandardResponse format from MCP client
    return result as StandardResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleSearchFiles(args: unknown): Promise<StandardResponse> {
  const parseResult = SearchFilesInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { query, search_in, search_type, file_types } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.searchFiles(query, search_in, search_type, file_types);
    // Result is already in StandardResponse format from MCP client
    return result as StandardResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleCheckGrant(args: unknown): Promise<StandardResponse> {
  const parseResult = CheckGrantInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { path } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.checkGrant(path);
    // Result is already in StandardResponse format from MCP client
    return result as StandardResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleRequestGrant(args: unknown): Promise<StandardResponse> {
  const parseResult = RequestGrantInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { path, permission, reason } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.requestGrant(path, permission, reason);
    // Result is already in StandardResponse format from MCP client
    return result as StandardResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleListGrants(args: unknown): Promise<StandardResponse> {
  const parseResult = ListGrantsInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { include_expired } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.listGrants(include_expired);
    // Result is already in StandardResponse format from MCP client
    return result as StandardResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleGetWorkspaceInfo(args: unknown): Promise<StandardResponse> {
  const parseResult = GetWorkspaceInfoInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.getWorkspaceInfo();
    // Result is already in StandardResponse format from MCP client
    return result as StandardResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleGetAuditLog(args: unknown): Promise<StandardResponse> {
  const parseResult = GetAuditLogInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { limit, operation, start_date, end_date } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.getAuditLog(limit, operation, start_date, end_date);
    // Result is already in StandardResponse format from MCP client
    return result as StandardResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Export all tool definitions as an array
export const filerToolDefinitions = [
  createFileToolDefinition,
  readFileToolDefinition,
  listFilesToolDefinition,
  updateFileToolDefinition,
  deleteFileToolDefinition,
  moveFileToolDefinition,
  copyFileToolDefinition,
  searchFilesToolDefinition,
  checkGrantToolDefinition,
  requestGrantToolDefinition,
  listGrantsToolDefinition,
  getWorkspaceInfoToolDefinition,
  getAuditLogToolDefinition,
];
