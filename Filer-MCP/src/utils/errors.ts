import { BaseError } from '@mcp/shared/Types/errors.js';

/**
 * Base error for all Filer MCP errors
 */
export class FilerError extends BaseError {
  constructor(message: string, code: string, details?: unknown) {
    super(message, code, details);
    this.name = 'FilerError';
  }
}

/**
 * Security errors — path traversal, forbidden paths, symlink escapes
 */
export class PathSecurityError extends FilerError {
  constructor(message: string, details?: unknown) {
    super(message, 'PATH_SECURITY_ERROR', details);
    this.name = 'PathSecurityError';
  }
}

/**
 * Grant errors — permission denied, missing grant
 */
export class GrantError extends FilerError {
  constructor(message: string, details?: unknown) {
    super(message, 'GRANT_ERROR', details);
    this.name = 'GrantError';
  }
}

/**
 * Workspace errors — file not found, path is directory, file too large, etc.
 */
export class WorkspaceError extends FilerError {
  constructor(message: string, details?: unknown) {
    super(message, 'WORKSPACE_ERROR', details);
    this.name = 'WorkspaceError';
  }
}
