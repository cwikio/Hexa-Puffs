import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted ensures this variable is available when vi.mock factory runs (hoisted)
const mockCheckMCPHealth = vi.hoisted(() => vi.fn());

vi.mock('../../src/core/orchestrator.js', () => ({
  getOrchestrator: vi.fn().mockResolvedValue({
    checkMCPHealth: mockCheckMCPHealth,
  }),
}));

import { handleHealthCheck } from '../../src/tools/health-check.js';

interface HealthData {
  scope: string;
  summary: { total: number; healthy: number; unhealthy: number };
  mcps: Array<{ name: string; available: boolean; healthy: boolean; type: string }>;
}

describe('handleHealthCheck', () => {
  beforeEach(() => {
    mockCheckMCPHealth.mockReset();
  });

  it('should return health status for all MCPs by default', async () => {
    mockCheckMCPHealth.mockResolvedValue([
      { name: 'guardian', available: true, healthy: true, type: 'internal' },
      { name: 'searcher', available: true, healthy: true, type: 'internal' },
      { name: 'posthog', available: true, healthy: false, type: 'external' },
    ]);

    const result = await handleHealthCheck({});

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      scope: 'all',
      summary: { total: 3, healthy: 2, unhealthy: 1 },
      mcps: [
        { name: 'guardian', available: true, healthy: true, type: 'internal' },
        { name: 'searcher', available: true, healthy: true, type: 'internal' },
        { name: 'posthog', available: true, healthy: false, type: 'external' },
      ],
    });
    expect(mockCheckMCPHealth).toHaveBeenCalledWith('all');
  });

  it('should pass scope parameter to orchestrator', async () => {
    mockCheckMCPHealth.mockResolvedValue([]);

    await handleHealthCheck({ scope: 'external' });
    expect(mockCheckMCPHealth).toHaveBeenCalledWith('external');

    await handleHealthCheck({ scope: 'internal' });
    expect(mockCheckMCPHealth).toHaveBeenCalledWith('internal');
  });

  it('should default to "all" scope when no args', async () => {
    mockCheckMCPHealth.mockResolvedValue([]);

    await handleHealthCheck(undefined);
    expect(mockCheckMCPHealth).toHaveBeenCalledWith('all');
  });

  it('should count healthy and unhealthy correctly', async () => {
    mockCheckMCPHealth.mockResolvedValue([
      { name: 'a', available: true, healthy: true, type: 'internal' },
      { name: 'b', available: false, healthy: false, type: 'internal' },
      { name: 'c', available: true, healthy: false, type: 'external' },
      { name: 'd', available: true, healthy: true, type: 'external' },
    ]);

    const result = await handleHealthCheck({});
    const data = result.data as HealthData;

    expect(data.summary).toEqual({
      total: 4,
      healthy: 2,
      unhealthy: 2,
    });
  });

  it('should handle empty result', async () => {
    mockCheckMCPHealth.mockResolvedValue([]);

    const result = await handleHealthCheck({ scope: 'external' });

    expect(result.success).toBe(true);
    const data = result.data as HealthData;
    expect(data.summary).toEqual({
      total: 0,
      healthy: 0,
      unhealthy: 0,
    });
    expect(data.mcps).toEqual([]);
  });

  it('should return error on failure', async () => {
    mockCheckMCPHealth.mockRejectedValue(new Error('Connection failed'));

    const result = await handleHealthCheck({});

    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection failed');
  });
});
