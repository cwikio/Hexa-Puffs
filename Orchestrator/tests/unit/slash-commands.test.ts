import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger before imports (standard pattern)
vi.mock('@mcp/shared/Utils/logger.js', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { SlashCommandHandler } from '../../src/core/slash-commands.js';
import type { ToolRouter } from '../../src/core/tool-router.js';
import type { Orchestrator, OrchestratorStatus } from '../../src/core/orchestrator.js';
import type { IncomingAgentMessage } from '../../src/core/agent-types.js';

// --- Helpers ---

function makeMsg(text: string, chatId = 'chat123'): IncomingAgentMessage {
  return {
    id: 'msg-1',
    chatId,
    senderId: 'user1',
    text,
    date: new Date().toISOString(),
    channel: 'telegram',
    agentId: 'annabelle',
  };
}

function makeMcpResult(data: unknown) {
  return {
    success: true,
    content: {
      content: [{ type: 'text', text: JSON.stringify(data) }],
    },
  };
}

function makeStatus(overrides?: Partial<OrchestratorStatus>): OrchestratorStatus {
  return {
    ready: true,
    uptime: 7260000, // 2h 1m
    mcpServers: {
      guardian: { available: true, required: false, type: 'stdio' },
      telegram: { available: true, required: false, type: 'http', port: 8002 },
      memory: { available: true, required: false, type: 'stdio' },
    },
    agents: [
      {
        agentId: 'annabelle',
        available: true,
        port: 8006,
        restartCount: 0,
        pid: 1234,
        paused: false,
        pauseReason: null,
      },
    ],
    sessions: { activeSessions: 2, totalTurns: 50 },
    security: { blockedCount: 0 },
    ...overrides,
  };
}

function makeTelegramMessage(id: number, date: Date, text = 'hello') {
  return { id, chatId: 'chat123', senderId: 'user1', text, date: date.toISOString() };
}

function createMocks(statusOverrides?: Partial<OrchestratorStatus>) {
  const mockToolRouter = {
    routeToolCall: vi.fn().mockResolvedValue({ success: true }),
  } as unknown as ToolRouter;

  const mockOrchestrator = {
    getStatus: vi.fn().mockReturnValue(makeStatus(statusOverrides)),
    getAvailableTools: vi.fn().mockReturnValue([
      'telegram_send_message',
      'telegram_get_messages',
      'memory_store_fact',
    ]),
  } as unknown as Orchestrator;

  const handler = new SlashCommandHandler(mockToolRouter, mockOrchestrator);

  return { handler, mockToolRouter, mockOrchestrator };
}

// --- Tests ---

describe('SlashCommandHandler', () => {
  describe('/status', () => {
    it('should return formatted system status', async () => {
      const { handler, mockOrchestrator } = createMocks();

      const result = await handler.tryHandle(makeMsg('/status'));

      expect(result.handled).toBe(true);
      expect(mockOrchestrator.getStatus).toHaveBeenCalled();
      expect(result.response).toContain('System Status');
      expect(result.response).toContain('2h 1m');
      expect(result.response).toContain('Ready');
    });

    it('should include MCP service names and status', async () => {
      const { handler } = createMocks();

      const result = await handler.tryHandle(makeMsg('/status'));

      expect(result.response).toContain('guardian: up (stdio)');
      expect(result.response).toContain('telegram: up (http:8002)');
      expect(result.response).toContain('memory: up (stdio)');
    });

    it('should show DOWN for unavailable MCPs', async () => {
      const { handler } = createMocks({
        mcpServers: {
          guardian: { available: true, required: false, type: 'stdio' },
          memory: { available: false, required: false, type: 'stdio' },
        },
      });

      const result = await handler.tryHandle(makeMsg('/status'));

      expect(result.response).toContain('guardian: up');
      expect(result.response).toContain('memory: DOWN');
    });

    it('should include agent status', async () => {
      const { handler } = createMocks();

      const result = await handler.tryHandle(makeMsg('/status'));

      expect(result.response).toContain('annabelle: up (port 8006, 0 restarts)');
    });

    it('should show PAUSED for cost-paused agents', async () => {
      const { handler } = createMocks({
        agents: [
          {
            agentId: 'annabelle',
            available: true,
            port: 8006,
            restartCount: 1,
            pid: 1234,
            paused: true,
            pauseReason: 'Token spike detected',
          },
        ],
      });

      const result = await handler.tryHandle(makeMsg('/status'));

      expect(result.response).toContain('PAUSED');
      expect(result.response).toContain('Token spike detected');
    });

    it('should include tool count and sessions', async () => {
      const { handler } = createMocks();

      const result = await handler.tryHandle(makeMsg('/status'));

      expect(result.response).toContain('Tools: 3');
      expect(result.response).toContain('Sessions: 2 active');
    });

    it('should include blocked count when non-zero', async () => {
      const { handler } = createMocks({
        security: { blockedCount: 5 },
      });

      const result = await handler.tryHandle(makeMsg('/status'));

      expect(result.response).toContain('Blocked: 5');
    });
  });

  describe('/help', () => {
    it('should return list of commands', async () => {
      const { handler } = createMocks();

      const result = await handler.tryHandle(makeMsg('/help'));

      expect(result.handled).toBe(true);
      expect(result.response).toContain('/status');
      expect(result.response).toContain('/delete');
      expect(result.response).toContain('/help');
    });
  });

  describe('/delete', () => {
    describe('argument parsing', () => {
      it('should return usage hint for missing args', async () => {
        const { handler } = createMocks();

        const result = await handler.tryHandle(makeMsg('/delete'));

        expect(result.handled).toBe(true);
        expect(result.response).toContain('Usage:');
      });

      it('should return usage hint for invalid args', async () => {
        const { handler } = createMocks();

        const result = await handler.tryHandle(makeMsg('/delete foo'));

        expect(result.handled).toBe(true);
        expect(result.response).toContain('Usage:');
      });

      it('should reject hours out of range', async () => {
        const { handler } = createMocks();

        const result = await handler.tryHandle(makeMsg('/delete 999h'));

        expect(result.handled).toBe(true);
        expect(result.response).toContain('Hours must be between');
      });

      it('should reject count out of range', async () => {
        const { handler } = createMocks();

        const result = await handler.tryHandle(makeMsg('/delete 999'));

        expect(result.handled).toBe(true);
        expect(result.response).toContain('Count must be between');
      });
    });

    describe('/delete today', () => {
      it('should delete only messages from today', async () => {
        const { handler, mockToolRouter } = createMocks();

        const now = new Date();
        const todayMsg1 = makeTelegramMessage(101, new Date(now.getTime() - 60_000));
        const todayMsg2 = makeTelegramMessage(102, new Date(now.getTime() - 120_000));
        const yesterdayMsg = makeTelegramMessage(99, new Date(now.getTime() - 86_400_000));

        (mockToolRouter.routeToolCall as ReturnType<typeof vi.fn>).mockImplementation(
          async (toolName: string) => {
            if (toolName === 'telegram_get_messages') {
              return makeMcpResult({
                messages: [todayMsg1, todayMsg2, yesterdayMsg],
                count: 3,
                chat_id: 'chat123',
              });
            }
            if (toolName === 'telegram_delete_messages') {
              return { success: true };
            }
            return { success: true };
          }
        );

        const result = await handler.tryHandle(makeMsg('/delete today'));

        expect(result.handled).toBe(true);

        // Find the delete call
        const deleteCalls = (mockToolRouter.routeToolCall as ReturnType<typeof vi.fn>).mock.calls.filter(
          (c: unknown[]) => c[0] === 'telegram_delete_messages'
        );
        expect(deleteCalls.length).toBe(1);

        const deletedIds = (deleteCalls[0][1] as { message_ids: number[] }).message_ids;
        expect(deletedIds).toContain(101);
        expect(deletedIds).toContain(102);
        expect(deletedIds).not.toContain(99);
        expect(result.response).toContain('Deleted 2 message(s)');
      });

      it('should report no messages when none found', async () => {
        const { handler, mockToolRouter } = createMocks();

        (mockToolRouter.routeToolCall as ReturnType<typeof vi.fn>).mockResolvedValue(
          makeMcpResult({ messages: [], count: 0, chat_id: 'chat123' })
        );

        const result = await handler.tryHandle(makeMsg('/delete today'));

        expect(result.response).toContain('No messages found');
      });
    });

    describe('/delete Nh', () => {
      it('should delete messages within the time window', async () => {
        const { handler, mockToolRouter } = createMocks();

        const now = Date.now();
        const recentMsg = makeTelegramMessage(201, new Date(now - 30 * 60_000)); // 30 min ago
        const oldMsg = makeTelegramMessage(200, new Date(now - 3 * 3_600_000)); // 3h ago

        (mockToolRouter.routeToolCall as ReturnType<typeof vi.fn>).mockImplementation(
          async (toolName: string) => {
            if (toolName === 'telegram_get_messages') {
              return makeMcpResult({
                messages: [recentMsg, oldMsg],
                count: 2,
                chat_id: 'chat123',
              });
            }
            return { success: true };
          }
        );

        const result = await handler.tryHandle(makeMsg('/delete 2h'));

        expect(result.handled).toBe(true);

        const deleteCalls = (mockToolRouter.routeToolCall as ReturnType<typeof vi.fn>).mock.calls.filter(
          (c: unknown[]) => c[0] === 'telegram_delete_messages'
        );
        expect(deleteCalls.length).toBe(1);

        const deletedIds = (deleteCalls[0][1] as { message_ids: number[] }).message_ids;
        expect(deletedIds).toContain(201);
        expect(deletedIds).not.toContain(200);
        expect(result.response).toContain('Deleted 1 message(s)');
      });
    });

    describe('/delete N', () => {
      it('should delete last N messages', async () => {
        const { handler, mockToolRouter } = createMocks();

        const messages = Array.from({ length: 5 }, (_, i) =>
          makeTelegramMessage(300 + i, new Date())
        );

        (mockToolRouter.routeToolCall as ReturnType<typeof vi.fn>).mockImplementation(
          async (toolName: string) => {
            if (toolName === 'telegram_get_messages') {
              return makeMcpResult({
                messages,
                count: 5,
                chat_id: 'chat123',
              });
            }
            return { success: true };
          }
        );

        const result = await handler.tryHandle(makeMsg('/delete 5'));

        expect(result.handled).toBe(true);

        const deleteCalls = (mockToolRouter.routeToolCall as ReturnType<typeof vi.fn>).mock.calls.filter(
          (c: unknown[]) => c[0] === 'telegram_delete_messages'
        );
        expect(deleteCalls.length).toBe(1);

        const deletedIds = (deleteCalls[0][1] as { message_ids: number[] }).message_ids;
        expect(deletedIds).toHaveLength(5);
        expect(result.response).toContain('Deleted 5 message(s)');
      });

      it('should paginate when N > 100', async () => {
        const { handler, mockToolRouter } = createMocks();

        let callCount = 0;
        (mockToolRouter.routeToolCall as ReturnType<typeof vi.fn>).mockImplementation(
          async (toolName: string) => {
            if (toolName === 'telegram_get_messages') {
              callCount++;
              const batchSize = callCount <= 2 ? 100 : 50;
              const startId = callCount === 1 ? 1000 : callCount === 2 ? 900 : 800;
              const messages = Array.from({ length: batchSize }, (_, i) =>
                makeTelegramMessage(startId - i, new Date())
              );
              return makeMcpResult({
                messages,
                count: batchSize,
                chat_id: 'chat123',
              });
            }
            return { success: true };
          }
        );

        const result = await handler.tryHandle(makeMsg('/delete 250'));

        expect(result.handled).toBe(true);

        // Should have fetched 3 pages (100 + 100 + 50)
        const getCalls = (mockToolRouter.routeToolCall as ReturnType<typeof vi.fn>).mock.calls.filter(
          (c: unknown[]) => c[0] === 'telegram_get_messages'
        );
        expect(getCalls.length).toBe(3);

        // Should have deleted in 3 batches (100 + 100 + 50)
        const deleteCalls = (mockToolRouter.routeToolCall as ReturnType<typeof vi.fn>).mock.calls.filter(
          (c: unknown[]) => c[0] === 'telegram_delete_messages'
        );
        expect(deleteCalls.length).toBe(3);
        expect(result.response).toContain('Deleted 250 message(s)');
      });
    });

    describe('error handling', () => {
      it('should handle get_messages failure gracefully', async () => {
        const { handler, mockToolRouter } = createMocks();

        (mockToolRouter.routeToolCall as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: false,
          error: 'Telegram MCP unavailable',
        });

        const result = await handler.tryHandle(makeMsg('/delete 5'));

        expect(result.handled).toBe(true);
        expect(result.response).toContain('No messages found');
      });

      it('should handle delete_messages failure and report partial count', async () => {
        const { handler, mockToolRouter } = createMocks();

        const messages = Array.from({ length: 3 }, (_, i) =>
          makeTelegramMessage(400 + i, new Date())
        );

        let deleteCallCount = 0;
        (mockToolRouter.routeToolCall as ReturnType<typeof vi.fn>).mockImplementation(
          async (toolName: string) => {
            if (toolName === 'telegram_get_messages') {
              return makeMcpResult({
                messages,
                count: 3,
                chat_id: 'chat123',
              });
            }
            if (toolName === 'telegram_delete_messages') {
              deleteCallCount++;
              if (deleteCallCount === 1) return { success: false, error: 'Permission denied' };
              return { success: true };
            }
            return { success: true };
          }
        );

        const result = await handler.tryHandle(makeMsg('/delete 3'));

        expect(result.handled).toBe(true);
        expect(result.response).toContain('Deleted 0 message(s)');
      });
    });
  });

  describe('non-slash messages', () => {
    it('should not handle regular messages', async () => {
      const { handler } = createMocks();

      const result = await handler.tryHandle(makeMsg('hello'));

      expect(result.handled).toBe(false);
    });

    it('should not handle natural language status queries', async () => {
      const { handler } = createMocks();

      const result = await handler.tryHandle(makeMsg("what's the status?"));

      expect(result.handled).toBe(false);
    });
  });

  describe('unknown commands', () => {
    it('should not handle unknown slash commands', async () => {
      const { handler } = createMocks();

      const result = await handler.tryHandle(makeMsg('/unknown'));

      expect(result.handled).toBe(false);
    });
  });
});
