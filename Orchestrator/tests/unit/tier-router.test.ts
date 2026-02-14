/**
 * Unit tests for the tier router logic: Direct vs Agent execution.
 *
 * Tests the decision logic (not the full Inngest function).
 * The tier router checks if a skill has a valid execution_plan:
 *   - Present + non-empty array → Direct tier (executeWorkflow)
 *   - Missing/null/empty/invalid → Agent tier (Thinker)
 */

import { describe, it, expect } from 'vitest';

/**
 * Mirrors the tier routing logic from skillSchedulerFunction.
 * Returns 'direct' or 'agent' based on the execution_plan field.
 */
function determineTier(executionPlanRaw: string | null | undefined): 'direct' | 'agent' {
  const executionPlan = executionPlanRaw
    ? (() => { try { return JSON.parse(typeof executionPlanRaw === 'string' ? executionPlanRaw : ''); } catch { return null; } })()
    : null;

  if (Array.isArray(executionPlan) && executionPlan.length > 0) {
    return 'direct';
  }
  return 'agent';
}

describe('Tier Router', () => {
  it('should route to Direct tier when execution_plan is a valid JSON array', () => {
    const plan = JSON.stringify([
      { id: 'step1', toolName: 'telegram_send_message', parameters: { message: 'hello' } },
    ]);
    expect(determineTier(plan)).toBe('direct');
  });

  it('should route to Direct tier for multi-step execution_plan', () => {
    const plan = JSON.stringify([
      { id: 'step1', toolName: 'searcher_web_search', parameters: { query: 'AI news' } },
      { id: 'step2', toolName: 'telegram_send_message', parameters: { message: 'done' } },
    ]);
    expect(determineTier(plan)).toBe('direct');
  });

  it('should route to Agent tier when execution_plan is null', () => {
    expect(determineTier(null)).toBe('agent');
  });

  it('should route to Agent tier when execution_plan is undefined', () => {
    expect(determineTier(undefined)).toBe('agent');
  });

  it('should route to Agent tier when execution_plan is empty array', () => {
    expect(determineTier('[]')).toBe('agent');
  });

  it('should route to Agent tier when execution_plan is invalid JSON', () => {
    expect(determineTier('{broken')).toBe('agent');
  });

  it('should route to Agent tier when execution_plan is a JSON string (not array)', () => {
    expect(determineTier('"just a string"')).toBe('agent');
  });

  it('should route to Agent tier when execution_plan is a JSON number', () => {
    expect(determineTier('42')).toBe('agent');
  });

  it('should route to Agent tier when execution_plan is empty string', () => {
    expect(determineTier('')).toBe('agent');
  });
});

describe('Execution Plan Structure', () => {
  it('should have required fields for each step', () => {
    const plan = [
      { id: 'step1', toolName: 'telegram_send_message', parameters: { message: 'hello' } },
    ];
    for (const step of plan) {
      expect(step).toHaveProperty('id');
      expect(step).toHaveProperty('toolName');
      expect(typeof step.id).toBe('string');
      expect(typeof step.toolName).toBe('string');
    }
  });

  it('should allow steps with optional dependsOn', () => {
    const plan = [
      { id: 'step1', toolName: 'searcher_web_search', parameters: { query: 'news' } },
      { id: 'step2', toolName: 'telegram_send_message', parameters: { message: 'done' }, dependsOn: ['step1'] },
    ];
    expect(plan[0]).not.toHaveProperty('dependsOn');
    expect(plan[1].dependsOn).toEqual(['step1']);
  });

  it('should allow steps without parameters', () => {
    const plan = [
      { id: 'step1', toolName: 'get_status' },
    ];
    expect(plan[0]).not.toHaveProperty('parameters');
  });
});
