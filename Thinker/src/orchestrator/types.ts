/**
 * MCP metadata from manifest — used for dynamic tool selection and grouping.
 * Matches the MCPMetadata interface from Shared/Discovery/types.ts.
 */
export interface MCPMetadata {
  label?: string;
  toolGroup?: string;
  keywords?: string[];
  guardianScan?: { input?: boolean; output?: boolean };
}

/**
 * Tool definition from Orchestrator
 */
export interface OrchestratorTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Tool execution request
 */
export interface ToolExecutionRequest {
  tool: string;
  arguments: Record<string, unknown>;
}

/**
 * Tool execution response
 */
export interface ToolExecutionResponse {
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * MCP tool call response format (from Orchestrator)
 */
export interface MCPToolCallResponse {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/**
 * MCP tools list response format (from Orchestrator)
 */
export interface MCPToolsListResponse {
  tools: OrchestratorTool[];
  mcpMetadata?: Record<string, MCPMetadata>;
}

/**
 * Telegram message from queue
 */
export interface TelegramMessage {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  date: string;
  isOutgoing: boolean;
  receivedAt: string;
}

/**
 * Memory fact
 */
export interface MemoryFact {
  id: number;
  fact: string;
  category: string;
  createdAt: string;
}

/**
 * Agent profile from Memory MCP
 */
export interface AgentProfile {
  agent_id: string;
  profile_data: {
    persona?: {
      name?: string;
      style?: string;
      tone?: string;
      system_prompt?: string;
    };
    capabilities?: Record<string, boolean>;
    proactive_behaviors?: Record<string, boolean>;
  };
  updated_at: string;
}

/**
 * Conversation entry
 */
export interface ConversationEntry {
  id: string;
  agent_id: string;
  session_id?: string;
  user_message: string;
  agent_response: string;
  created_at: string;
}
