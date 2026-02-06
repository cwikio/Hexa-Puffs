import { BaseError } from '@mcp/shared/Types/errors.js';

/**
 * Base error for all Orchestrator errors
 * Extends shared BaseError for consistent error handling
 */
export class OrchestratorError extends BaseError {
  constructor(
    message: string,
    code: string,
    details?: unknown
  ) {
    super(message, code, details);
    this.name = 'OrchestratorError';
  }
}

export class SecurityError extends OrchestratorError {
  constructor(message: string, details?: unknown) {
    super(message, 'SECURITY_ERROR', details);
    this.name = 'SecurityError';
  }
}

export class MCPClientError extends OrchestratorError {
  constructor(
    message: string,
    public mcpName: string,
    details?: unknown
  ) {
    super(message, 'MCP_CLIENT_ERROR', details);
    this.name = 'MCPClientError';
  }
}

export class MCPUnavailableError extends MCPClientError {
  constructor(mcpName: string, details?: unknown) {
    super(`MCP server '${mcpName}' is unavailable`, mcpName, details);
    this.name = 'MCPUnavailableError';
  }
}

export class ToolExecutionError extends OrchestratorError {
  constructor(
    message: string,
    public toolName: string,
    details?: unknown
  ) {
    super(message, 'TOOL_EXECUTION_ERROR', details);
    this.name = 'ToolExecutionError';
  }
}

export class ConfigurationError extends OrchestratorError {
  constructor(message: string, details?: unknown) {
    super(message, 'CONFIGURATION_ERROR', details);
    this.name = 'ConfigurationError';
  }
}

export class ValidationError extends OrchestratorError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}
