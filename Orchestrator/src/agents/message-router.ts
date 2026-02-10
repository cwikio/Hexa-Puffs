/**
 * MessageRouter - Routes incoming messages to the correct agent based on channel bindings.
 *
 * Binding rules:
 *  1. Exact (channel + chatId) match takes priority.
 *  2. Wildcard (channel + "*") is the fallback for that channel.
 *  3. If no binding matches at all, returns the default agent ID.
 */

import type { ChannelBinding } from '../config/agents.js';
import { logger, Logger } from '@mcp/shared/Utils/logger.js';

export class MessageRouter {
  private bindings: ChannelBinding[];
  private defaultAgentId: string;
  private logger: Logger;

  constructor(bindings: ChannelBinding[], defaultAgentId: string) {
    this.bindings = bindings;
    this.defaultAgentId = defaultAgentId;
    this.logger = logger.child('message-router');

    this.logger.info(`MessageRouter initialized with ${bindings.length} binding(s), default agent: ${defaultAgentId}`);
  }

  /**
   * Resolve which agent(s) should handle a message from the given channel/chatId.
   * Returns an array to support future broadcast scenarios (multiple agents per chat).
   * Currently returns at most one agent ID.
   */
  resolveAgents(channel: string, chatId: string): string[] {
    // Pass 1: exact match
    for (const binding of this.bindings) {
      if (binding.channel === channel && binding.chatId === chatId) {
        this.logger.debug(`Exact match: ${channel}/${chatId} → ${binding.agentId}`);
        return [binding.agentId];
      }
    }

    // Pass 2: wildcard match
    for (const binding of this.bindings) {
      if (binding.channel === channel && binding.chatId === '*') {
        this.logger.debug(`Wildcard match: ${channel}/${chatId} → ${binding.agentId}`);
        return [binding.agentId];
      }
    }

    // Pass 3: fall back to default agent
    this.logger.debug(`No binding for ${channel}/${chatId} — using default agent: ${this.defaultAgentId}`);
    return [this.defaultAgentId];
  }

  /**
   * Update bindings at runtime (e.g. after config reload).
   */
  updateBindings(bindings: ChannelBinding[]): void {
    this.bindings = bindings;
    this.logger.info(`Bindings updated: ${bindings.length} binding(s)`);
  }

  /**
   * Get all current bindings (for status/debugging).
   */
  getBindings(): ChannelBinding[] {
    return [...this.bindings];
  }
}
