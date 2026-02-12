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

// Mock fs for /logs tests
const mockReaddir = vi.fn();
const mockStat = vi.fn();
const mockReadFile = vi.fn();
vi.mock('node:fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

import { SlashCommandHandler } from '../../src/commands/slash-commands.js';
import type { ToolRouter } from '../../src/routing/tool-router.js';
import type { Orchestrator, OrchestratorStatus } from '../../src/core/orchestrator.js';
import type { IncomingAgentMessage } from '../../src/agents/agent-types.js';

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
      telegram: { available: true, required: false, type: 'stdio' },
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
        state: 'running' as const,
        lastActivityAt: Date.now(),
        parentAgentId: null,
        isSubagent: false,
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

  const mockHaltManager = {
    isTargetHalted: vi.fn().mockReturnValue(false),
    isHalted: vi.fn().mockReturnValue(false),
  };

  const mockOrchestrator = {
    getStatus: vi.fn().mockReturnValue(makeStatus(statusOverrides)),
    getAvailableTools: vi.fn().mockReturnValue([
      'telegram_send_message',
      'telegram_get_messages',
      'memory_store_fact',
    ]),
    callGuardianTool: vi.fn().mockResolvedValue(null),
    getHaltManager: vi.fn().mockReturnValue(mockHaltManager),
    getChannelManager: vi.fn().mockReturnValue({}),
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

      expect(result.response).toContain('Guardian: up (stdio)');
      expect(result.response).toContain('Telegram: up (stdio)');
      expect(result.response).toContain('Memory: up (stdio)');
    });

    it('should show DOWN for unavailable MCPs', async () => {
      const { handler } = createMocks({
        mcpServers: {
          guardian: { available: true, required: false, type: 'stdio' },
          memory: { available: false, required: false, type: 'stdio' },
        },
      });

      const result = await handler.tryHandle(makeMsg('/status'));

      expect(result.response).toContain('Guardian: up');
      expect(result.response).toContain('Memory: DOWN');
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
            state: 'running' as const,
            lastActivityAt: Date.now(),
            parentAgentId: null,
            isSubagent: false,
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

  describe('/security', () => {
    function makeScanLogResult(scans: Array<Record<string, unknown>>) {
      return {
        success: true,
        content: {
          content: [{ type: 'text', text: JSON.stringify({ success: true, data: { scans, total: scans.length } }) }],
        },
      };
    }

    describe('status (no args)', () => {
      it('should show Guardian config and availability', async () => {
        const { handler, mockOrchestrator } = createMocks();
        (mockOrchestrator.callGuardianTool as ReturnType<typeof vi.fn>).mockResolvedValue(
          makeScanLogResult([])
        );

        const result = await handler.tryHandle(makeMsg('/security'));

        expect(result.handled).toBe(true);
        expect(result.response).toContain('Guardian Security');
        expect(result.response).toContain('enabled');
        expect(result.response).toContain('closed');
        expect(result.response).toContain('available');
        expect(result.response).toContain('Input scanning');
        expect(result.response).toContain('Output scanning');
      });

      it('should show 24h stats when scans exist', async () => {
        const now = new Date();
        const recentScan = { timestamp: now.toISOString(), safe: true, threats: [] };
        const threatScan = { timestamp: now.toISOString(), safe: false, threats: ['prompt_injection'] };

        const { handler, mockOrchestrator } = createMocks();
        (mockOrchestrator.callGuardianTool as ReturnType<typeof vi.fn>).mockResolvedValue(
          makeScanLogResult([recentScan, threatScan])
        );

        const result = await handler.tryHandle(makeMsg('/security'));

        expect(result.response).toContain('Last 24h: 2 scans, 1 threats');
      });

      it('should handle Guardian unavailable', async () => {
        const { handler } = createMocks({
          mcpServers: {
            guardian: { available: false, required: false, type: 'stdio' },
          },
        });

        const result = await handler.tryHandle(makeMsg('/security'));

        expect(result.response).toContain('unavailable');
        expect(result.response).not.toContain('Last 24h');
      });
    });

    describe('entries (/security N)', () => {
      it('should show recent threats with default count', async () => {
        const scan = {
          scan_id: 'test-1',
          timestamp: new Date().toISOString(),
          source: 'gmail',
          safe: false,
          confidence: 0.95,
          threats: [{ type: 'prompt_injection', snippet: 'Ignore all previous instructions' }],
          content_hash: 'abc123',
        };

        const { handler, mockOrchestrator } = createMocks();
        (mockOrchestrator.callGuardianTool as ReturnType<typeof vi.fn>).mockResolvedValue(
          makeScanLogResult([scan])
        );

        const result = await handler.tryHandle(makeMsg('/security 10'));

        expect(result.handled).toBe(true);
        expect(result.response).toContain('Security Threats');
        expect(result.response).toContain('gmail');
        expect(result.response).toContain('prompt_injection');
        expect(result.response).toContain('0.95');
        expect(result.response).toContain('Ignore all previous');
        expect(mockOrchestrator.callGuardianTool).toHaveBeenCalledWith('get_scan_log', {
          limit: 10,
          threats_only: true,
        });
      });

      it('should return message when no threats found', async () => {
        const { handler, mockOrchestrator } = createMocks();
        (mockOrchestrator.callGuardianTool as ReturnType<typeof vi.fn>).mockResolvedValue(
          makeScanLogResult([])
        );

        const result = await handler.tryHandle(makeMsg('/security 5'));

        expect(result.response).toContain('No security threats found');
      });

      it('should return error when Guardian unavailable', async () => {
        const { handler, mockOrchestrator } = createMocks();
        (mockOrchestrator.callGuardianTool as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        const result = await handler.tryHandle(makeMsg('/security 5'));

        expect(result.response).toContain('unavailable');
      });

      it('should reject count out of range', async () => {
        const { handler } = createMocks();

        const result = await handler.tryHandle(makeMsg('/security 999'));

        expect(result.handled).toBe(true);
        expect(result.error).toContain('Count must be between');
      });

      it('should handle string-only threat types', async () => {
        const scan = {
          scan_id: 'test-2',
          timestamp: new Date().toISOString(),
          source: 'filer',
          safe: false,
          confidence: 0.8,
          threats: ['data_exfiltration'],
          content_hash: 'def456',
        };

        const { handler, mockOrchestrator } = createMocks();
        (mockOrchestrator.callGuardianTool as ReturnType<typeof vi.fn>).mockResolvedValue(
          makeScanLogResult([scan])
        );

        const result = await handler.tryHandle(makeMsg('/security 10'));

        expect(result.response).toContain('data_exfiltration');
        expect(result.response).toContain('0.80');
      });
    });
  });

  describe('/logs', () => {
    beforeEach(() => {
      mockReaddir.mockReset();
      mockStat.mockReset();
      mockReadFile.mockReset();
    });

    describe('status (no args)', () => {
      it('should list log files with sizes and age', async () => {
        mockReaddir.mockResolvedValue(['orchestrator.log', 'gmail.log', 'build-Shared.log']);
        mockStat.mockImplementation(async (path: string) => {
          if (path.includes('orchestrator')) {
            return { size: 75_000, mtime: new Date(Date.now() - 60_000) };
          }
          return { size: 26_000, mtime: new Date(Date.now() - 3_600_000) };
        });

        const { handler } = createMocks();
        const result = await handler.tryHandle(makeMsg('/logs'));

        expect(result.handled).toBe(true);
        expect(result.response).toContain('System Logs');
        expect(result.response).toContain('orchestrator.log');
        expect(result.response).toContain('gmail.log');
        // build logs should be filtered out
        expect(result.response).not.toContain('build-Shared');
        expect(result.response).toContain('Total:');
      });

      it('should handle missing log directory', async () => {
        mockReaddir.mockRejectedValue(new Error('ENOENT'));

        const { handler } = createMocks();
        const result = await handler.tryHandle(makeMsg('/logs'));

        expect(result.response).toContain('Cannot read log directory: ~/.annabelle/logs/');
      });
    });

    describe('entries (/logs N)', () => {
      it('should show recent WARN and ERROR entries', async () => {
        const logContent = [
          '[2026-02-07T20:00:00.000Z] [INFO] [mcp] Normal operation',
          '[2026-02-07T21:00:00.000Z] [WARN] [mcp:tool-router] MCP filer health check failed',
          '[2026-02-07T22:00:00.000Z] [ERROR] [mcp] MCP memory restart failed',
          '[2026-02-07T23:00:00.000Z] [INFO] [mcp] Recovery complete',
        ].join('\n');

        mockReadFile.mockResolvedValue(logContent);

        const { handler } = createMocks();
        const result = await handler.tryHandle(makeMsg('/logs 15'));

        expect(result.handled).toBe(true);
        expect(result.response).toContain('Recent Issues');
        expect(result.response).toContain('MCP filer health check failed');
        expect(result.response).toContain('MCP memory restart failed');
        // INFO lines should not appear
        expect(result.response).not.toContain('Normal operation');
        expect(result.response).not.toContain('Recovery complete');
      });

      it('should sort entries by timestamp descending', async () => {
        const logContent = [
          '[2026-02-07T10:00:00.000Z] [ERROR] [mcp] Early error',
          '[2026-02-07T22:00:00.000Z] [WARN] [mcp] Late warning',
        ].join('\n');

        mockReadFile.mockResolvedValue(logContent);

        const { handler } = createMocks();
        const result = await handler.tryHandle(makeMsg('/logs 10'));

        const response = result.response!;
        const lateIdx = response.indexOf('Late warning');
        const earlyIdx = response.indexOf('Early error');
        expect(lateIdx).toBeLessThan(earlyIdx);
      });

      it('should handle no warnings or errors found', async () => {
        mockReadFile.mockResolvedValue('[2026-02-07T22:00:00.000Z] [INFO] [mcp] All good');

        const { handler } = createMocks();
        const result = await handler.tryHandle(makeMsg('/logs 5'));

        expect(result.response).toContain('No recent warnings or errors');
      });

      it('should handle missing log files gracefully', async () => {
        mockReadFile.mockRejectedValue(new Error('ENOENT'));

        const { handler } = createMocks();
        const result = await handler.tryHandle(makeMsg('/logs 5'));

        expect(result.response).toContain('No recent warnings or errors');
      });

      it('should reject count out of range', async () => {
        const { handler } = createMocks();

        const result = await handler.tryHandle(makeMsg('/logs 999'));

        expect(result.handled).toBe(true);
        expect(result.error).toContain('Count must be between');
      });

      it('should truncate long messages', async () => {
        const longMsg = 'A'.repeat(200);
        const logContent = `[2026-02-07T22:00:00.000Z] [ERROR] [mcp] ${longMsg}`;

        mockReadFile.mockResolvedValue(logContent);

        const { handler } = createMocks();
        const result = await handler.tryHandle(makeMsg('/logs 5'));

        // Message should be truncated (80 chars + "..."), not contain full 200-char string
        expect(result.response).toContain('...');
        expect(result.response).not.toContain('A'.repeat(200));
      });
    });
  });

  describe('/browser', () => {
    it('should show browser status when MCP is available', async () => {
      const { handler, mockToolRouter } = createMocks({
        mcpServers: {
          guardian: { available: true, required: false, type: 'stdio' },
          web: { available: true, required: false, type: 'stdio' },
        },
      });

      (mockToolRouter.routeToolCall as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        content: {
          content: [{ type: 'text', text: 'Tab 1: https://example.com\nTab 2: about:blank' }],
        },
      });

      const result = await handler.tryHandle(makeMsg('/browser'));

      expect(result.handled).toBe(true);
      expect(result.response).toContain('Browser Status');
      expect(result.response).toContain('MCP: up (stdio)');
      expect(result.response).toContain('Tabs (2)');
      expect(result.response).toContain('https://example.com');
      expect(mockToolRouter.routeToolCall).toHaveBeenCalledWith('web_browser_tabs', { action: 'list' });
    });

    it('should show offline when MCP is unavailable', async () => {
      const { handler } = createMocks({
        mcpServers: {
          guardian: { available: true, required: false, type: 'stdio' },
          web: { available: false, required: false, type: 'stdio' },
        },
      });

      const result = await handler.tryHandle(makeMsg('/browser'));

      expect(result.handled).toBe(true);
      expect(result.response).toContain('MCP: DOWN');
      expect(result.response).toContain('offline');
    });

    it('should show not installed when web MCP is absent', async () => {
      const { handler } = createMocks();

      const result = await handler.tryHandle(makeMsg('/browser'));

      expect(result.handled).toBe(true);
      expect(result.response).toContain('not installed');
    });

    it('should handle tab call failure gracefully', async () => {
      const { handler, mockToolRouter } = createMocks({
        mcpServers: {
          guardian: { available: true, required: false, type: 'stdio' },
          web: { available: true, required: false, type: 'stdio' },
        },
      });

      (mockToolRouter.routeToolCall as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no session'));

      const result = await handler.tryHandle(makeMsg('/browser'));

      expect(result.handled).toBe(true);
      expect(result.response).toContain('Browser Status');
      expect(result.response).toContain('No active browser session');
      expect(mockToolRouter.routeToolCall).toHaveBeenCalledWith('web_browser_tabs', { action: 'list' });
    });

    it('should show proxy config when enabled', async () => {
      const original = { ...process.env };
      process.env.BROWSER_PROXY_ENABLED = 'true';
      process.env.BROWSER_PROXY_SERVER = 'http://proxy.example.com:8080';

      const { handler, mockToolRouter } = createMocks({
        mcpServers: {
          guardian: { available: true, required: false, type: 'stdio' },
          web: { available: true, required: false, type: 'stdio' },
        },
      });

      (mockToolRouter.routeToolCall as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no session'));

      const result = await handler.tryHandle(makeMsg('/browser'));

      expect(result.response).toContain('http://proxy.example.com:8080');
      expect(mockToolRouter.routeToolCall).toHaveBeenCalledWith('web_browser_tabs', { action: 'list' });

      process.env.BROWSER_PROXY_ENABLED = original.BROWSER_PROXY_ENABLED;
      process.env.BROWSER_PROXY_SERVER = original.BROWSER_PROXY_SERVER;
    });
  });

  describe('/status browser line', () => {
    it('should include browser instance info when web MCP is available', async () => {
      const { handler, mockToolRouter } = createMocks({
        mcpServers: {
          guardian: { available: true, required: false, type: 'stdio' },
          web: { available: true, required: false, type: 'stdio' },
        },
      });

      (mockToolRouter.routeToolCall as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        content: {
          content: [{ type: 'text', text: 'Tab 1: https://example.com' }],
        },
      });

      const result = await handler.tryHandle(makeMsg('/status'));

      expect(result.response).toContain('Browser: 1 instance, 1 tab');
      expect(mockToolRouter.routeToolCall).toHaveBeenCalledWith('web_browser_tabs', { action: 'list' });
    });

    it('should show browser offline when web MCP is down', async () => {
      const { handler } = createMocks({
        mcpServers: {
          guardian: { available: true, required: false, type: 'stdio' },
          web: { available: false, required: false, type: 'stdio' },
        },
      });

      const result = await handler.tryHandle(makeMsg('/status'));

      expect(result.response).toContain('Browser: offline');
    });

    it('should omit browser line when web MCP is not present', async () => {
      const { handler } = createMocks();

      const result = await handler.tryHandle(makeMsg('/status'));

      expect(result.response).not.toContain('Browser:');
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
