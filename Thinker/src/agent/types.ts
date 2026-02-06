import type { CoreMessage } from 'ai';

/**
 * Agent state for a conversation
 */
export interface AgentState {
  chatId: string;
  messages: CoreMessage[];
  lastActivity: number;
}

/**
 * Result of processing a message
 */
export interface ProcessingResult {
  success: boolean;
  response?: string;
  toolsUsed: string[];
  totalSteps: number;
  error?: string;
}

/**
 * Context for agent processing
 */
export interface AgentContext {
  systemPrompt: string;
  conversationHistory: CoreMessage[];
  facts: Array<{ fact: string; category: string }>;
  profile: {
    name?: string;
    style?: string;
    tone?: string;
  } | null;
}

/**
 * Incoming message to process
 */
export interface IncomingMessage {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  date: string;
}
