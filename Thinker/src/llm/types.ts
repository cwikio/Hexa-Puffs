import type { CoreMessage, ToolResultPart } from 'ai';

/**
 * Supported LLM provider names
 */
export type ProviderName = 'groq' | 'lmstudio' | 'ollama';

/**
 * Message format for conversations
 */
export type Message = CoreMessage;

/**
 * Tool call result from LLM
 */
export interface ToolCallResult {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
}

/**
 * Response from agent processing
 */
export interface AgentResponse {
  text: string;
  toolCalls: ToolCallResult[];
  totalSteps: number;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  name: ProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
}
