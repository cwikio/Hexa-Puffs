import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@mcp/shared/Utils/logger.js', () => {
  const child = vi.fn().mockReturnValue({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  });
  return {
    logger: { child },
    Logger: class { info = vi.fn(); warn = vi.fn(); error = vi.fn(); debug = vi.fn(); },
  };
});

const mockExistsSync = vi.fn().mockReturnValue(false);
const mockReadFileSync = vi.fn().mockReturnValue('');
const mockWriteFileSync = vi.fn();
const mockUnlinkSync = vi.fn();
const mockMkdirSync = vi.fn();

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
}));

import { HaltManager } from '../../src/core/halt-manager.js';

describe('HaltManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  describe('initial state', () => {
    it('starts not halted when no halt file exists', () => {
      const hm = new HaltManager();
      expect(hm.isHalted()).toBe(false);
      expect(hm.getState().halted).toBe(false);
      expect(hm.getState().targets).toEqual([]);
      expect(hm.getState().reason).toBe('');
    });

    it('restores halted state from disk', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        halted: true,
        reason: 'Cost spike',
        timestamp: '2026-01-01T00:00:00Z',
        targets: ['thinker'],
      }));

      const hm = new HaltManager();
      expect(hm.isHalted()).toBe(true);
      expect(hm.getState().reason).toBe('Cost spike');
      expect(hm.getState().targets).toEqual(['thinker']);
    });

    it('treats corrupt halt file as not halted', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('not valid json');

      const hm = new HaltManager();
      expect(hm.isHalted()).toBe(false);
    });

    it('treats halt file with missing halted field as not halted', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ reason: 'test' }));

      const hm = new HaltManager();
      expect(hm.isHalted()).toBe(false);
    });
  });

  describe('halt', () => {
    it('sets halted state with reason and targets', () => {
      const hm = new HaltManager();
      hm.halt('Cost anomaly detected', ['thinker', 'telegram']);

      expect(hm.isHalted()).toBe(true);
      expect(hm.getState().reason).toBe('Cost anomaly detected');
      expect(hm.getState().targets).toEqual(['thinker', 'telegram']);
      expect(hm.getState().timestamp).toBeTruthy();
    });

    it('persists halt state to disk', () => {
      // Mock existsSync for DATA_DIR check during persist
      mockExistsSync.mockReturnValue(true);
      const hm = new HaltManager();
      hm.halt('Over budget', ['thinker']);

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('halt.json'),
        expect.stringContaining('"halted": true'),
      );
    });

    it('creates data directory if it does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      const hm = new HaltManager();
      hm.halt('Test', ['thinker']);

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true },
      );
    });
  });

  describe('isTargetHalted', () => {
    it('returns true for halted target', () => {
      const hm = new HaltManager();
      hm.halt('Test', ['thinker', 'telegram']);

      expect(hm.isTargetHalted('thinker')).toBe(true);
      expect(hm.isTargetHalted('telegram')).toBe(true);
    });

    it('returns false for non-halted target', () => {
      const hm = new HaltManager();
      hm.halt('Test', ['thinker']);

      expect(hm.isTargetHalted('telegram')).toBe(false);
    });
  });

  describe('addTarget', () => {
    it('adds a new target to an existing halt', () => {
      mockExistsSync.mockReturnValue(true);
      const hm = new HaltManager();
      hm.halt('Initial halt', ['thinker']);
      hm.addTarget('telegram', 'Also telegram');

      expect(hm.getState().targets).toEqual(['thinker', 'telegram']);
      expect(hm.getState().reason).toBe('Also telegram');
    });

    it('does not duplicate existing target', () => {
      mockExistsSync.mockReturnValue(true);
      const hm = new HaltManager();
      hm.halt('Test', ['thinker']);
      hm.addTarget('thinker', 'Again');

      expect(hm.getState().targets).toEqual(['thinker']);
    });

    it('sets halted to true even if not previously halted', () => {
      mockExistsSync.mockReturnValue(true);
      const hm = new HaltManager();
      hm.addTarget('inngest', 'Cost spike');

      expect(hm.isHalted()).toBe(true);
      expect(hm.getState().targets).toContain('inngest');
    });
  });

  describe('removeTarget', () => {
    it('removes a specific target', () => {
      mockExistsSync.mockReturnValue(true);
      const hm = new HaltManager();
      hm.halt('Test', ['thinker', 'telegram']);
      hm.removeTarget('thinker');

      expect(hm.getState().targets).toEqual(['telegram']);
      expect(hm.isHalted()).toBe(true);
    });

    it('fully resumes when last target is removed', () => {
      mockExistsSync.mockReturnValue(true);
      const hm = new HaltManager();
      hm.halt('Test', ['thinker']);
      hm.removeTarget('thinker');

      expect(hm.isHalted()).toBe(false);
      expect(hm.getState().targets).toEqual([]);
      expect(hm.getState().reason).toBe('');
    });

    it('removes halt file from disk when last target removed', () => {
      mockExistsSync.mockReturnValue(true);
      const hm = new HaltManager();
      hm.halt('Test', ['thinker']);
      mockUnlinkSync.mockClear();
      hm.removeTarget('thinker');

      expect(mockUnlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('halt.json'),
      );
    });

    it('is a no-op for non-existent target', () => {
      mockExistsSync.mockReturnValue(true);
      const hm = new HaltManager();
      hm.halt('Test', ['thinker']);
      hm.removeTarget('unknown');

      expect(hm.getState().targets).toEqual(['thinker']);
    });
  });

  describe('resumeAll', () => {
    it('clears all halt state', () => {
      const hm = new HaltManager();
      hm.halt('Emergency', ['thinker', 'telegram', 'inngest']);
      hm.resumeAll();

      expect(hm.isHalted()).toBe(false);
      expect(hm.getState().targets).toEqual([]);
      expect(hm.getState().reason).toBe('');
      expect(hm.getState().timestamp).toBe('');
    });

    it('removes halt file from disk', () => {
      mockExistsSync.mockReturnValue(true);
      const hm = new HaltManager();
      hm.halt('Test', ['thinker']);
      mockUnlinkSync.mockClear();
      hm.resumeAll();

      expect(mockUnlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('halt.json'),
      );
    });
  });

  describe('getState', () => {
    it('returns readonly state snapshot', () => {
      const hm = new HaltManager();
      hm.halt('Test', ['thinker']);

      const state = hm.getState();
      expect(state.halted).toBe(true);
      expect(state.reason).toBe('Test');
      expect(state.targets).toEqual(['thinker']);
      expect(state.timestamp).toBeTruthy();
    });
  });

  describe('disk error resilience', () => {
    it('handles writeFileSync error gracefully', () => {
      mockExistsSync.mockReturnValue(true);
      mockWriteFileSync.mockImplementation(() => {
        throw new Error('Disk full');
      });

      const hm = new HaltManager();
      // Should not throw
      expect(() => hm.halt('Test', ['thinker'])).not.toThrow();
      // State is still updated in memory
      expect(hm.isHalted()).toBe(true);
    });

    it('handles unlinkSync error gracefully in resumeAll', () => {
      mockExistsSync.mockReturnValue(true);
      mockUnlinkSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const hm = new HaltManager();
      hm.halt('Test', ['thinker']);
      // Should not throw
      expect(() => hm.resumeAll()).not.toThrow();
      expect(hm.isHalted()).toBe(false);
    });
  });
});
