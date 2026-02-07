/**
 * Shared types for Orchestrator ↔ Thinker communication.
 */

import { z } from 'zod';

/**
 * Message pushed from Orchestrator to a Thinker instance
 */
export const IncomingAgentMessageSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  senderId: z.string(),
  text: z.string(),
  date: z.string(),
  channel: z.string().default('telegram'),
  agentId: z.string().default('main'),
});

export type IncomingAgentMessage = z.infer<typeof IncomingAgentMessageSchema>;

/**
 * Response returned by a Thinker instance after processing
 */
export const ProcessingResponseSchema = z.object({
  success: z.boolean(),
  response: z.string().optional(),
  toolsUsed: z.array(z.string()),
  totalSteps: z.number(),
  error: z.string().optional(),
});

export type ProcessingResponse = z.infer<typeof ProcessingResponseSchema>;
