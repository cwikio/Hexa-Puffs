/**
 * Unit tests for AgentManager.
 *
 * Tests lazy-spawn / idle-kill (P10) and subagent spawning (P7).
 * Mocks child_process.spawn, fs/promises, and ThinkerClient to test
 * state management without actually spawning processes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ─── Mocks ──────────────────────────────────────────────────────

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

// Mock ThinkerClient
const mockHealthCheck = vi.fn<() => Promise<boolean>>();
const mockProcessMessage = vi.fn();
const mockResumeCostPause = vi.fn();

vi.mock('../../src/agents/thinker-client.js', () => {
  return {
    ThinkerClient: class MockThinkerClient {
      healthCheck = mockHealthCheck;
      processMessage = mockProcessMessage;
      resumeCostPause = mockResumeCostPause;
    },
  };
});

// Mock fs/promises
vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

// Mock child_process.spawn
function createMockChild(): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid: number;
  kill: ReturnType<typeof vi.fn>;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    pid: number;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = Math.floor(Math.random() * 99999);
  child.kill = vi.fn();
  return child;
}

let mockChild: ReturnType<typeof createMockChild>;

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    mockChild = createMockChild();
    // Emit LISTENING_PORT for dynamic port tests
    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('LISTENING_PORT=9876\n'));
    }, 10);
    return mockChild;
  }),
}));

import { AgentManager } from '../../src/agents/agent-manager.js';
import type { AgentDefinition } from '../../src/config/agents.js';

// ─── Helpers ────────────────────────────────────────────────────

function makeAgentDef(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    agentId: 'test-agent',
    enabled: true,
    port: 8006,
    llmProvider: 'groq',
    model: 'test-model',
    systemPrompt: '',
    allowedTools: [],
    deniedTools: [],
    maxSteps: 8,
    idleTimeoutMinutes: 30,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('AgentManager', () => {
  let manager: AgentManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    manager = new AgentManager();
    // Default: health check succeeds
    mockHealthCheck.mockResolvedValue(true);
  });

  afterEach(async () => {
    await manager.shutdownAll();
    vi.useRealTimers();
  });

  // ─── P10: Lazy-Spawn ──────────────────────────────────────────

  describe('initializeAll (lazy-spawn)', () => {
    it('should register agents with state "stopped" without spawning', async () => {
      const def = makeAgentDef();
      await manager.initializeAll([def]);

      const status = manager.getStatus();
      expect(status).toHaveLength(1);
      expect(status[0].state).toBe('stopped');
      expect(status[0].pid).toBeNull();
      expect(status[0].available).toBe(false);
    });

    it('should skip disabled agents', async () => {
      const def = makeAgentDef({ enabled: false });
      await manager.initializeAll([def]);

      expect(manager.getStatus()).toHaveLength(0);
    });

    it('should register multiple agents', async () => {
      const defs = [
        makeAgentDef({ agentId: 'agent-a', port: 8006 }),
        makeAgentDef({ agentId: 'agent-b', port: 8007 }),
      ];
      await manager.initializeAll(defs);

      expect(manager.getStatus()).toHaveLength(2);
      expect(manager.hasAgent('agent-a')).toBe(true);
      expect(manager.hasAgent('agent-b')).toBe(true);
    });
  });

  describe('ensureRunning', () => {
    it('should spawn agent on first call and set state to "running"', async () => {
      await manager.initializeAll([makeAgentDef()]);
      expect(manager.getAgentState('test-agent')).toBe('stopped');

      const ready = await manager.ensureRunning('test-agent');
      expect(ready).toBe(true);
      expect(manager.getAgentState('test-agent')).toBe('running');
    });

    it('should return true immediately if already running', async () => {
      await manager.initializeAll([makeAgentDef()]);
      await manager.ensureRunning('test-agent');

      // Second call should be fast
      const ready = await manager.ensureRunning('test-agent');
      expect(ready).toBe(true);
    });

    it('should deduplicate concurrent spawn calls', async () => {
      await manager.initializeAll([makeAgentDef()]);

      // Call ensureRunning twice concurrently
      const [r1, r2] = await Promise.all([
        manager.ensureRunning('test-agent'),
        manager.ensureRunning('test-agent'),
      ]);

      expect(r1).toBe(true);
      expect(r2).toBe(true);

      // spawn should have been called only once
      const { spawn } = await import('child_process');
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    it('should return false for unknown agent', async () => {
      const ready = await manager.ensureRunning('nonexistent');
      expect(ready).toBe(false);
    });

    it('should set state to "stopped" if health check fails', async () => {
      mockHealthCheck.mockResolvedValue(false);
      await manager.initializeAll([makeAgentDef()]);

      const ready = await manager.ensureRunning('test-agent');
      expect(ready).toBe(false);
      expect(manager.getAgentState('test-agent')).toBe('stopped');
    });
  });

  describe('getDefaultAgentId', () => {
    it('should return first registered agent even if stopped', async () => {
      await manager.initializeAll([makeAgentDef({ agentId: 'lazy-agent' })]);

      // Agent is stopped (not yet spawned)
      expect(manager.getAgentState('lazy-agent')).toBe('stopped');
      // But getDefaultAgentId should still return it
      expect(manager.getDefaultAgentId()).toBe('lazy-agent');
    });

    it('should prefer running agent over stopped', async () => {
      await manager.initializeAll([
        makeAgentDef({ agentId: 'stopped-agent', port: 8006 }),
        makeAgentDef({ agentId: 'running-agent', port: 8007 }),
      ]);
      await manager.ensureRunning('running-agent');

      expect(manager.getDefaultAgentId()).toBe('running-agent');
    });
  });

  describe('updateActivity', () => {
    it('should update lastActivityAt timestamp', async () => {
      await manager.initializeAll([makeAgentDef()]);
      await manager.ensureRunning('test-agent');

      const before = manager.getStatus()[0].lastActivityAt;
      // Advance time a bit
      vi.advanceTimersByTime(1000);
      manager.updateActivity('test-agent');
      const after = manager.getStatus()[0].lastActivityAt;

      expect(after).toBeGreaterThan(before);
    });
  });

  // ─── P10: Stop / Idle-Kill ────────────────────────────────────

  describe('stopAgent', () => {
    it('should kill process and set state to "stopped"', async () => {
      await manager.initializeAll([makeAgentDef()]);
      await manager.ensureRunning('test-agent');
      expect(manager.getAgentState('test-agent')).toBe('running');

      await manager.stopAgent('test-agent');
      expect(manager.getAgentState('test-agent')).toBe('stopped');
      expect(manager.getStatus()[0].pid).toBeNull();
      expect(manager.getStatus()[0].available).toBe(false);
    });

    it('should reset restartCount on stop', async () => {
      await manager.initializeAll([makeAgentDef()]);
      await manager.ensureRunning('test-agent');
      await manager.stopAgent('test-agent');

      expect(manager.getStatus()[0].restartCount).toBe(0);
    });

    it('should be a no-op for already stopped agent', async () => {
      await manager.initializeAll([makeAgentDef()]);
      // Agent is already stopped (never spawned)
      await manager.stopAgent('test-agent');
      expect(manager.getAgentState('test-agent')).toBe('stopped');
    });
  });

  describe('idle checks', () => {
    it('should not kill agent within idle timeout', async () => {
      const def = makeAgentDef({ idleTimeoutMinutes: 10 });
      await manager.initializeAll([def]);
      await manager.ensureRunning('test-agent');
      manager.updateActivity('test-agent');

      // Advance 5 min (within 10 min timeout)
      vi.advanceTimersByTime(5 * 60 * 1000);
      // Trigger idle scan manually
      // @ts-expect-error - accessing private method for testing
      await manager.runIdleChecks();

      expect(manager.getAgentState('test-agent')).toBe('running');
    });

    it('should kill agent after idle timeout', async () => {
      const def = makeAgentDef({ idleTimeoutMinutes: 10 });
      await manager.initializeAll([def]);
      await manager.ensureRunning('test-agent');
      manager.updateActivity('test-agent');

      // Advance past 10 min timeout
      vi.advanceTimersByTime(11 * 60 * 1000);
      // @ts-expect-error - accessing private method for testing
      await manager.runIdleChecks();

      expect(manager.getAgentState('test-agent')).toBe('stopped');
    });

    it('should skip stopped agents in idle checks', async () => {
      await manager.initializeAll([makeAgentDef()]);
      // Agent is stopped, should not error
      // @ts-expect-error - accessing private method for testing
      await manager.runIdleChecks();
      expect(manager.getAgentState('test-agent')).toBe('stopped');
    });
  });

  describe('health checks', () => {
    it('should skip non-running agents', async () => {
      await manager.initializeAll([makeAgentDef()]);
      // Agent is stopped — health check should not be called
      mockHealthCheck.mockClear();
      // @ts-expect-error - accessing private method for testing
      await manager.runHealthChecks();
      expect(mockHealthCheck).not.toHaveBeenCalled();
    });
  });

  // ─── P10: Shutdown ────────────────────────────────────────────

  describe('shutdownAll', () => {
    it('should stop all agents and clear the map', async () => {
      await manager.initializeAll([
        makeAgentDef({ agentId: 'a', port: 8006 }),
        makeAgentDef({ agentId: 'b', port: 8007 }),
      ]);
      await manager.ensureRunning('a');
      await manager.ensureRunning('b');

      await manager.shutdownAll();
      expect(manager.getStatus()).toHaveLength(0);
    });
  });

  // ─── P7: Subagent Spawning ────────────────────────────────────

  describe('spawnSubagent', () => {
    it('should spawn a subagent with dynamic port', async () => {
      await manager.initializeAll([makeAgentDef({ agentId: 'parent', port: 8006 })]);
      await manager.ensureRunning('parent');

      const { agentId, client } = await manager.spawnSubagent({
        parentAgentId: 'parent',
        task: 'Do something',
      });

      expect(agentId).toMatch(/^parent-sub-/);
      expect(client).toBeDefined();

      const status = manager.getStatus().find(s => s.agentId === agentId);
      expect(status).toBeDefined();
      expect(status!.isSubagent).toBe(true);
      expect(status!.parentAgentId).toBe('parent');
      expect(status!.state).toBe('running');
    });

    it('should reject if parent is a subagent (single-level)', async () => {
      await manager.initializeAll([makeAgentDef({ agentId: 'parent', port: 8006 })]);
      await manager.ensureRunning('parent');

      const { agentId: subId } = await manager.spawnSubagent({
        parentAgentId: 'parent',
        task: 'First level',
      });

      await expect(
        manager.spawnSubagent({
          parentAgentId: subId,
          task: 'Second level — should fail',
        })
      ).rejects.toThrow('single-level');
    });

    it('should reject if parent not found', async () => {
      await expect(
        manager.spawnSubagent({
          parentAgentId: 'nonexistent',
          task: 'test',
        })
      ).rejects.toThrow('not found');
    });

    it('should reject if parent is not running', async () => {
      await manager.initializeAll([makeAgentDef({ agentId: 'parent', port: 8006 })]);
      // Parent is stopped (not yet spawned)

      await expect(
        manager.spawnSubagent({
          parentAgentId: 'parent',
          task: 'test',
        })
      ).rejects.toThrow('not running');
    });

    it('should enforce max subagents per parent', async () => {
      await manager.initializeAll([makeAgentDef({ agentId: 'parent', port: 8006 })]);
      await manager.ensureRunning('parent');

      // Spawn MAX_SUBAGENTS_PER_PARENT (5)
      for (let i = 0; i < 5; i++) {
        await manager.spawnSubagent({
          parentAgentId: 'parent',
          task: `Task ${i}`,
        });
      }

      expect(manager.getSubagentCount('parent')).toBe(5);

      // 6th should fail
      await expect(
        manager.spawnSubagent({
          parentAgentId: 'parent',
          task: 'Too many',
        })
      ).rejects.toThrow('Max 5');
    });

    it('should merge tool policies — deny spawn_subagent for subagent', async () => {
      const parentDef = makeAgentDef({
        agentId: 'parent',
        port: 8006,
        deniedTools: ['dangerous_tool'],
      });
      await manager.initializeAll([parentDef]);
      await manager.ensureRunning('parent');

      const { agentId: subId } = await manager.spawnSubagent({
        parentAgentId: 'parent',
        task: 'test',
        deniedTools: ['another_tool'],
      });

      const subDef = manager.getAgentDefinition(subId);
      expect(subDef).not.toBeNull();
      expect(subDef!.deniedTools).toContain('dangerous_tool');
      expect(subDef!.deniedTools).toContain('another_tool');
      expect(subDef!.deniedTools).toContain('spawn_subagent');
    });
  });

  describe('killSubagent', () => {
    it('should remove subagent from agents map and parent tracking', async () => {
      await manager.initializeAll([makeAgentDef({ agentId: 'parent', port: 8006 })]);
      await manager.ensureRunning('parent');

      const { agentId: subId } = await manager.spawnSubagent({
        parentAgentId: 'parent',
        task: 'temp task',
      });

      expect(manager.hasAgent(subId)).toBe(true);
      expect(manager.getSubagentCount('parent')).toBe(1);

      await manager.killSubagent(subId);

      expect(manager.hasAgent(subId)).toBe(false);
      expect(manager.getSubagentCount('parent')).toBe(0);
    });
  });

  describe('cascade kill', () => {
    it('should kill all child subagents when parent is stopped', async () => {
      await manager.initializeAll([makeAgentDef({ agentId: 'parent', port: 8006 })]);
      await manager.ensureRunning('parent');

      const { agentId: sub1 } = await manager.spawnSubagent({
        parentAgentId: 'parent',
        task: 'Task 1',
      });
      const { agentId: sub2 } = await manager.spawnSubagent({
        parentAgentId: 'parent',
        task: 'Task 2',
      });

      expect(manager.hasAgent(sub1)).toBe(true);
      expect(manager.hasAgent(sub2)).toBe(true);

      // Stop parent — should cascade kill both subagents
      await manager.stopAgent('parent');

      expect(manager.hasAgent(sub1)).toBe(false);
      expect(manager.hasAgent(sub2)).toBe(false);
      expect(manager.getSubagentCount('parent')).toBe(0);
    });
  });

  describe('dynamic port (waitForPortAnnouncement)', () => {
    it('should parse LISTENING_PORT from stdout for port=0 agents', async () => {
      await manager.initializeAll([makeAgentDef({ agentId: 'parent', port: 8006 })]);
      await manager.ensureRunning('parent');

      // spawnSubagent uses port=0 which triggers waitForPortAnnouncement
      // The mock child emits LISTENING_PORT=9876 after 10ms
      const { agentId: subId } = await manager.spawnSubagent({
        parentAgentId: 'parent',
        task: 'dynamic port test',
      });

      const status = manager.getStatus().find(s => s.agentId === subId);
      expect(status).toBeDefined();
      // Port should have been updated from 0 to the announced port
      expect(status!.port).toBe(9876);
    });
  });
});
