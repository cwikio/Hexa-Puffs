import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mcp/shared/Utils/logger.js', () => ({
  Logger: class { info = vi.fn(); warn = vi.fn(); error = vi.fn(); debug = vi.fn(); },
}));

import {
  NotificationService,
  type NotificationDeps,
  type StartupContext,
} from '../../src/core/notification-service.js';
import type { MCPDiff } from '../../src/core/startup-diff.js';

function makeDeps(overrides: Partial<NotificationDeps> = {}): NotificationDeps {
  return {
    toolRouter: {
      routeToolCall: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{}' }] }),
      getAllRoutes: vi.fn().mockReturnValue([]),
      getBlockedTools: vi.fn().mockReturnValue([]),
    } as any,
    getAgentDefinition: vi.fn().mockReturnValue({
      costControls: { notifyChatId: 'chat-123' },
    }),
    ...overrides,
  };
}

function makeStartupContext(overrides: Partial<StartupContext> = {}): StartupContext {
  return {
    stdioClients: new Map([
      ['guardian', { isAvailable: true } as any],
      ['memorizer', { isAvailable: true } as any],
    ]),
    httpClients: new Map(),
    externalMCPNames: new Set(),
    config: {} as any,
    ...overrides,
  };
}

const emptyDiff: MCPDiff = { added: [], removed: [], unchanged: [] };

describe('NotificationService', () => {
  let deps: NotificationDeps;
  let service: NotificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = makeDeps();
    service = new NotificationService(deps);
  });

  describe('sendStartupNotification', () => {
    it('sends notification via telegram_send_message', async () => {
      await service.sendStartupNotification(emptyDiff, makeStartupContext());

      expect(deps.toolRouter.routeToolCall).toHaveBeenCalledWith(
        'telegram_send_message',
        expect.objectContaining({
          chat_id: 'chat-123',
          message: expect.stringContaining('Orchestrator started'),
        }),
      );
    });

    it('includes MCP count in message', async () => {
      await service.sendStartupNotification(emptyDiff, makeStartupContext());

      const callArgs = vi.mocked(deps.toolRouter.routeToolCall).mock.calls[0];
      expect(callArgs[1].message).toContain('MCPs: 2 total');
    });

    it('includes diff changes when MCPs added or removed', async () => {
      const diff: MCPDiff = {
        added: ['new-mcp'],
        removed: ['old-mcp'],
        unchanged: ['guardian'],
      };

      await service.sendStartupNotification(diff, makeStartupContext());

      const message = vi.mocked(deps.toolRouter.routeToolCall).mock.calls[0][1].message;
      expect(message).toContain('+ new-mcp');
      expect(message).toContain('- old-mcp');
    });

    it('includes failed MCPs in notification', async () => {
      const ctx = makeStartupContext({
        stdioClients: new Map([
          ['guardian', { isAvailable: true } as any],
          ['broken', { isAvailable: false, initError: 'Connection refused' } as any],
        ]),
      });

      await service.sendStartupNotification(emptyDiff, ctx);

      const message = vi.mocked(deps.toolRouter.routeToolCall).mock.calls[0][1].message;
      expect(message).toContain('Failed:');
      expect(message).toContain('broken: Connection refused');
    });

    it('includes blocked tools when present', async () => {
      deps = makeDeps({
        toolRouter: {
          ...makeDeps().toolRouter,
          getBlockedTools: vi.fn().mockReturnValue(['dangerous_delete_all']),
        } as any,
      });
      service = new NotificationService(deps);

      await service.sendStartupNotification(emptyDiff, makeStartupContext());

      const message = vi.mocked(deps.toolRouter.routeToolCall).mock.calls[0][1].message;
      expect(message).toContain('dangerous_delete_all');
    });

    it('skips notification when no chat ID is available', async () => {
      deps = makeDeps({
        getAgentDefinition: vi.fn().mockReturnValue(undefined),
      });
      // Clear NOTIFY_CHAT_ID env
      const origEnv = process.env.NOTIFY_CHAT_ID;
      delete process.env.NOTIFY_CHAT_ID;

      service = new NotificationService(deps);
      await service.sendStartupNotification(emptyDiff, makeStartupContext());

      expect(deps.toolRouter.routeToolCall).not.toHaveBeenCalled();
      process.env.NOTIFY_CHAT_ID = origEnv;
    });

    it('swallows errors from toolRouter', async () => {
      deps = makeDeps({
        toolRouter: {
          ...makeDeps().toolRouter,
          routeToolCall: vi.fn().mockRejectedValue(new Error('Telegram down')),
        } as any,
      });
      service = new NotificationService(deps);

      // Should not throw
      await expect(
        service.sendStartupNotification(emptyDiff, makeStartupContext()),
      ).resolves.toBeUndefined();
    });
  });

  describe('sendHotReloadNotification', () => {
    it('sends notification with added and removed MCPs', async () => {
      const added = new Map([
        ['new-mcp', { name: 'new-mcp', type: 'stdio' as const, command: 'node', args: [] }],
      ]);

      await service.sendHotReloadNotification(added, ['old-mcp'], []);

      expect(deps.toolRouter.routeToolCall).toHaveBeenCalledWith(
        'telegram_send_message',
        expect.objectContaining({
          chat_id: 'chat-123',
          message: expect.stringContaining('External MCPs changed'),
        }),
      );
      const message = vi.mocked(deps.toolRouter.routeToolCall).mock.calls[0][1].message;
      expect(message).toContain('+ new-mcp');
      expect(message).toContain('- old-mcp');
    });

    it('includes failed connections', async () => {
      await service.sendHotReloadNotification(
        new Map(),
        [],
        [{ name: 'bad-mcp', error: 'Connection refused' }],
      );

      const message = vi.mocked(deps.toolRouter.routeToolCall).mock.calls[0][1].message;
      expect(message).toContain('Failed to connect');
      expect(message).toContain('bad-mcp: Connection refused');
    });

    it('skips when no chat ID', async () => {
      deps = makeDeps({ getAgentDefinition: vi.fn().mockReturnValue(undefined) });
      const origEnv = process.env.NOTIFY_CHAT_ID;
      delete process.env.NOTIFY_CHAT_ID;
      service = new NotificationService(deps);

      await service.sendHotReloadNotification(new Map(), ['removed'], []);

      expect(deps.toolRouter.routeToolCall).not.toHaveBeenCalled();
      process.env.NOTIFY_CHAT_ID = origEnv;
    });
  });

  describe('sendValidationErrorNotification', () => {
    it('sends notification with file error and entry errors', async () => {
      await service.sendValidationErrorNotification(
        'YAML parse failed',
        [{ name: 'bad-entry', message: 'missing command' }],
      );

      const message = vi.mocked(deps.toolRouter.routeToolCall).mock.calls[0][1].message;
      expect(message).toContain('validation error');
      expect(message).toContain('YAML parse failed');
      expect(message).toContain('"bad-entry": missing command');
      expect(message).toContain('Fix the errors');
    });

    it('works without file error', async () => {
      await service.sendValidationErrorNotification(
        undefined,
        [{ name: 'entry', message: 'bad type' }],
      );

      const message = vi.mocked(deps.toolRouter.routeToolCall).mock.calls[0][1].message;
      expect(message).not.toContain('File:');
      expect(message).toContain('"entry": bad type');
    });

    it('swallows errors from toolRouter', async () => {
      deps = makeDeps({
        toolRouter: {
          ...makeDeps().toolRouter,
          routeToolCall: vi.fn().mockRejectedValue(new Error('Network error')),
        } as any,
      });
      service = new NotificationService(deps);

      await expect(
        service.sendValidationErrorNotification('parse error', []),
      ).resolves.toBeUndefined();
    });
  });

  describe('getNotifyChatId', () => {
    it('uses agent definition costControls.notifyChatId', async () => {
      await service.sendStartupNotification(emptyDiff, makeStartupContext());

      const callArgs = vi.mocked(deps.toolRouter.routeToolCall).mock.calls[0];
      expect(callArgs[1].chat_id).toBe('chat-123');
    });

    it('falls back to NOTIFY_CHAT_ID env var', async () => {
      deps = makeDeps({ getAgentDefinition: vi.fn().mockReturnValue(undefined) });
      process.env.NOTIFY_CHAT_ID = 'env-chat-456';
      service = new NotificationService(deps);

      await service.sendStartupNotification(emptyDiff, makeStartupContext());

      const callArgs = vi.mocked(deps.toolRouter.routeToolCall).mock.calls[0];
      expect(callArgs[1].chat_id).toBe('env-chat-456');
      delete process.env.NOTIFY_CHAT_ID;
    });
  });
});
