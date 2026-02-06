/**
 * ChannelManager — generic multi-adapter poller that dispatches messages
 * from any number of channel adapters to the Orchestrator.
 *
 * Replaces the original Telegram-only ChannelPoller. Each channel MCP
 * is represented by a ChannelAdapter (created automatically from
 * auto-discovered MCPs with role: "channel").
 */

import { logger, type Logger } from '@mcp/shared/Utils/logger.js';
import type { IncomingAgentMessage } from '../agents/agent-types.js';
import type { ChannelAdapter } from './channel-adapter.js';

export interface ChannelManagerConfig {
  intervalMs: number;
  maxMessagesPerCycle: number;
}

export class ChannelManager {
  private adapters: Map<string, ChannelAdapter> = new Map();
  private config: ChannelManagerConfig;
  private log: Logger;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  /** Callback for dispatching discovered messages to the Orchestrator. */
  onMessage: ((msg: IncomingAgentMessage) => Promise<void>) | null = null;

  constructor(config: ChannelManagerConfig) {
    this.config = config;
    this.log = logger.child('channel-manager');
  }

  /** Register a channel adapter. */
  registerAdapter(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.channel, adapter);
    this.log.info(`Adapter registered: ${adapter.channel}`);
  }

  /** Get an adapter by channel name (used for response delivery). */
  getAdapter(channel: string): ChannelAdapter | undefined {
    return this.adapters.get(channel);
  }

  /** Get all registered channel names. */
  getChannels(): string[] {
    return Array.from(this.adapters.keys());
  }

  /** Initialize all registered adapters. */
  async initialize(): Promise<void> {
    for (const [channel, adapter] of this.adapters) {
      try {
        await adapter.initialize();
        this.log.info(`Adapter initialized: ${channel}`);
      } catch (error) {
        this.log.error(`Failed to initialize adapter: ${channel}`, { error });
      }
    }
  }

  /** Start the polling loop. */
  start(): void {
    if (this.pollTimer) return;

    const channels = this.getChannels();
    this.log.info(`Starting channel polling (interval: ${this.config.intervalMs}ms, channels: ${channels.join(', ') || 'none'})`);

    // Initial poll
    this.pollCycle();

    this.pollTimer = setInterval(() => {
      this.pollCycle();
    }, this.config.intervalMs);

    // Don't keep the process alive just for polling
    if (this.pollTimer.unref) {
      this.pollTimer.unref();
    }
  }

  /** Stop the polling loop and shut down all adapters. */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    for (const [channel, adapter] of this.adapters) {
      adapter.shutdown().catch((error) => {
        this.log.error(`Error shutting down adapter: ${channel}`, { error });
      });
    }

    this.log.info('Channel polling stopped');
  }

  /** Single poll cycle: poll all adapters, dispatch messages. */
  private async pollCycle(): Promise<void> {
    if (this.polling) return;
    this.polling = true;

    try {
      let totalDispatched = 0;

      for (const [channel, adapter] of this.adapters) {
        try {
          const messages = await adapter.poll();

          // Cap per cycle
          const capped = messages.slice(0, this.config.maxMessagesPerCycle);

          for (const msg of capped) {
            if (this.onMessage) {
              this.log.info(`Dispatching [${channel}] from chat ${msg.chatId}: "${msg.text.substring(0, 50)}..."`);
              await this.onMessage(msg);
              totalDispatched++;
            }
          }
        } catch (error) {
          // One adapter failing does not block others
          this.log.error(`Poll error on adapter "${channel}":`, error);
        }
      }

      if (totalDispatched > 0) {
        this.log.info(`Poll cycle: dispatched ${totalDispatched} message(s)`);
      }
    } catch (error) {
      this.log.error('Error in poll cycle:', error);
    } finally {
      this.polling = false;
    }
  }
}
