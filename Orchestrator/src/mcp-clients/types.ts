/**
 * Common types and interfaces for MCP clients.
 * Both HTTP and stdio clients implement these interfaces.
 */

export interface ToolCallResult {
  success: boolean;
  content?: unknown;
  error?: string;
}

export interface MCPToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

/**
 * Common interface for MCP clients (both HTTP and stdio).
 * This allows the ToolRouter to work with either client type.
 */
export interface IMCPClient {
  readonly name: string;
  readonly isAvailable: boolean;
  readonly isRequired: boolean;
  readonly isSensitive: boolean;

  initialize(): Promise<void>;
  listTools(): Promise<MCPToolDefinition[]>;
  callTool(toolCall: MCPToolCall): Promise<ToolCallResult>;
}
