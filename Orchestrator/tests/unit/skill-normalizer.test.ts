/**
 * Unit tests for skill input normalization and cron expression validation.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeSkillInput,
  validateCronExpression,
} from '../../src/utils/skill-normalizer.js';

describe('normalizeSkillInput', () => {
  it('should re-nest flattened schedule into trigger_config', () => {
    const input = {
      name: 'hello-reminder',
      schedule: '*/1 * * * *',
      instructions: 'Send hello',
    };
    const result = normalizeSkillInput(input);
    expect(result.trigger_config).toEqual({ schedule: '*/1 * * * *' });
    expect(result.schedule).toBeUndefined();
  });

  it('should re-nest flattened interval_minutes into trigger_config', () => {
    const input = {
      name: 'check-news',
      interval_minutes: 180,
      instructions: 'Check news',
    };
    const result = normalizeSkillInput(input);
    expect(result.trigger_config).toEqual({ interval_minutes: 180 });
    expect(result.interval_minutes).toBeUndefined();
  });

  it('should re-nest flattened timezone along with schedule', () => {
    const input = {
      name: 'morning-check',
      schedule: '0 9 * * *',
      timezone: 'Europe/Warsaw',
      instructions: 'Morning check',
    };
    const result = normalizeSkillInput(input);
    expect(result.trigger_config).toEqual({
      schedule: '0 9 * * *',
      timezone: 'Europe/Warsaw',
    });
    expect(result.timezone).toBeUndefined();
  });

  it('should re-nest flattened at into trigger_config', () => {
    const input = {
      name: 'dentist-reminder',
      at: '2026-02-14T09:00:00',
      instructions: 'Remind about dentist',
    };
    const result = normalizeSkillInput(input);
    expect(result.trigger_config).toEqual({ at: '2026-02-14T09:00:00' });
    expect(result.at).toBeUndefined();
  });

  it('should not override existing trigger_config', () => {
    const input = {
      name: 'test',
      trigger_config: { schedule: '0 9 * * *' },
      schedule: '* * * * *', // this should be ignored
      instructions: 'Test',
    };
    const result = normalizeSkillInput(input);
    expect(result.trigger_config).toEqual({ schedule: '0 9 * * *' });
    // The flattened schedule stays since trigger_config already existed
    expect(result.schedule).toBe('* * * * *');
  });

  it('should infer trigger_type "cron" from trigger_config.schedule', () => {
    const input = {
      name: 'test',
      trigger_config: { schedule: '0 9 * * *' },
      instructions: 'Test',
    };
    const result = normalizeSkillInput(input);
    expect(result.trigger_type).toBe('cron');
  });

  it('should infer trigger_type "cron" from trigger_config.interval_minutes', () => {
    const input = {
      name: 'test',
      trigger_config: { interval_minutes: 60 },
      instructions: 'Test',
    };
    const result = normalizeSkillInput(input);
    expect(result.trigger_type).toBe('cron');
  });

  it('should infer trigger_type "cron" from trigger_config.at', () => {
    const input = {
      name: 'test',
      trigger_config: { at: '2026-02-14T09:00:00' },
      instructions: 'Test',
    };
    const result = normalizeSkillInput(input);
    expect(result.trigger_type).toBe('cron');
  });

  it('should not override existing trigger_type', () => {
    const input = {
      name: 'test',
      trigger_type: 'manual',
      trigger_config: { schedule: '0 9 * * *' },
      instructions: 'Test',
    };
    const result = normalizeSkillInput(input);
    expect(result.trigger_type).toBe('manual');
  });

  it('should parse required_tools from JSON string to array', () => {
    const input = {
      name: 'test',
      required_tools: '["telegram_send_message","searcher_web_search"]',
      instructions: 'Test',
    };
    const result = normalizeSkillInput(input);
    expect(result.required_tools).toEqual(['telegram_send_message', 'searcher_web_search']);
  });

  it('should wrap single string required_tools into array', () => {
    const input = {
      name: 'test',
      required_tools: 'telegram_send_message',
      instructions: 'Test',
    };
    const result = normalizeSkillInput(input);
    expect(result.required_tools).toEqual(['telegram_send_message']);
  });

  it('should leave array required_tools unchanged', () => {
    const input = {
      name: 'test',
      required_tools: ['telegram_send_message'],
      instructions: 'Test',
    };
    const result = normalizeSkillInput(input);
    expect(result.required_tools).toEqual(['telegram_send_message']);
  });

  it('should parse max_steps from string to number', () => {
    const input = {
      name: 'test',
      max_steps: '5',
      instructions: 'Test',
    };
    const result = normalizeSkillInput(input);
    expect(result.max_steps).toBe(5);
  });

  it('should leave numeric max_steps unchanged', () => {
    const input = {
      name: 'test',
      max_steps: 10,
      instructions: 'Test',
    };
    const result = normalizeSkillInput(input);
    expect(result.max_steps).toBe(10);
  });

  it('should parse notify_on_completion from string "true" to boolean', () => {
    const input = {
      name: 'test',
      notify_on_completion: 'true',
      instructions: 'Test',
    };
    const result = normalizeSkillInput(input);
    expect(result.notify_on_completion).toBe(true);
  });

  it('should parse notify_on_completion from string "false" to boolean', () => {
    const input = {
      name: 'test',
      notify_on_completion: 'false',
      instructions: 'Test',
    };
    const result = normalizeSkillInput(input);
    expect(result.notify_on_completion).toBe(false);
  });

  it('should pass through already-correct input unchanged', () => {
    const input = {
      agent_id: 'thinker',
      name: 'ai-news-monitor',
      trigger_type: 'cron',
      trigger_config: { schedule: '0 */3 * * *' },
      instructions: 'Search AI news',
      required_tools: ['searcher_news_search', 'telegram_send_message'],
      max_steps: 5,
      notify_on_completion: true,
    };
    const result = normalizeSkillInput(input);
    expect(result).toEqual(input);
  });

  it('should normalize cronExpression to schedule inside trigger_config', () => {
    const input = {
      name: 'test',
      trigger_config: { cronExpression: '*/1 * * * *' },
      instructions: 'Test',
    };
    const result = normalizeSkillInput(input);
    const tc = result.trigger_config as Record<string, unknown>;
    expect(tc.schedule).toBe('*/1 * * * *');
    expect(tc.cronExpression).toBeUndefined();
  });

  it('should normalize cron_expression to schedule inside trigger_config', () => {
    const input = {
      name: 'test',
      trigger_config: { cron_expression: '0 9 * * *' },
      instructions: 'Test',
    };
    const result = normalizeSkillInput(input);
    const tc = result.trigger_config as Record<string, unknown>;
    expect(tc.schedule).toBe('0 9 * * *');
    expect(tc.cron_expression).toBeUndefined();
  });

  it('should normalize intervalMinutes to interval_minutes inside trigger_config', () => {
    const input = {
      name: 'test',
      trigger_config: { intervalMinutes: 30 },
      instructions: 'Test',
    };
    const result = normalizeSkillInput(input);
    const tc = result.trigger_config as Record<string, unknown>;
    expect(tc.interval_minutes).toBe(30);
    expect(tc.intervalMinutes).toBeUndefined();
  });

  it('should not overwrite existing schedule with cronExpression alias', () => {
    const input = {
      name: 'test',
      trigger_config: { schedule: '0 9 * * *', cronExpression: '*/5 * * * *' },
      instructions: 'Test',
    };
    const result = normalizeSkillInput(input);
    const tc = result.trigger_config as Record<string, unknown>;
    expect(tc.schedule).toBe('0 9 * * *'); // original preserved
  });

  it('should convert in_minutes inside trigger_config to one-shot at', () => {
    const before = Date.now();
    const input = {
      name: 'water-reminder',
      trigger_config: { in_minutes: 5 },
      instructions: 'Drink water',
    };
    const result = normalizeSkillInput(input);
    const tc = result.trigger_config as Record<string, unknown>;
    const after = Date.now();

    expect(tc.in_minutes).toBeUndefined();
    expect(tc.at).toBeDefined();
    const atTime = new Date(tc.at as string).getTime();
    expect(atTime).toBeGreaterThanOrEqual(before + 5 * 60_000);
    expect(atTime).toBeLessThanOrEqual(after + 5 * 60_000);
  });

  it('should convert in_hours inside trigger_config to one-shot at', () => {
    const before = Date.now();
    const input = {
      name: 'meeting-reminder',
      trigger_config: { in_hours: 2 },
      instructions: 'Prep for meeting',
    };
    const result = normalizeSkillInput(input);
    const tc = result.trigger_config as Record<string, unknown>;
    const after = Date.now();

    expect(tc.in_hours).toBeUndefined();
    expect(tc.at).toBeDefined();
    const atTime = new Date(tc.at as string).getTime();
    expect(atTime).toBeGreaterThanOrEqual(before + 2 * 3_600_000);
    expect(atTime).toBeLessThanOrEqual(after + 2 * 3_600_000);
  });

  it('should re-nest flattened in_minutes from root and convert to at', () => {
    const before = Date.now();
    const input = {
      name: 'stretch-reminder',
      in_minutes: 10,
      instructions: 'Time to stretch',
    };
    const result = normalizeSkillInput(input);
    const tc = result.trigger_config as Record<string, unknown>;
    const after = Date.now();

    expect(result.in_minutes).toBeUndefined();
    expect(tc.at).toBeDefined();
    const atTime = new Date(tc.at as string).getTime();
    expect(atTime).toBeGreaterThanOrEqual(before + 10 * 60_000);
    expect(atTime).toBeLessThanOrEqual(after + 10 * 60_000);
  });

  it('should infer trigger_type "cron" from in_minutes (via at conversion)', () => {
    const input = {
      name: 'test',
      trigger_config: { in_minutes: 5 },
      instructions: 'Test',
    };
    const result = normalizeSkillInput(input);
    expect(result.trigger_type).toBe('cron');
  });

  it('should not overwrite existing at with in_minutes', () => {
    const input = {
      name: 'test',
      trigger_config: { at: '2026-02-14T15:00:00', in_minutes: 5 },
      instructions: 'Test',
    };
    const result = normalizeSkillInput(input);
    const tc = result.trigger_config as Record<string, unknown>;
    expect(tc.at).toBe('2026-02-14T15:00:00');
    expect(tc.in_minutes).toBeUndefined();
  });

  it('should handle empty required_tools string', () => {
    const input = {
      name: 'test',
      required_tools: '',
      instructions: 'Test',
    };
    const result = normalizeSkillInput(input);
    // Empty string stays as-is (no tools)
    expect(result.required_tools).toBe('');
  });

  it('should handle malformed JSON in required_tools gracefully', () => {
    const input = {
      name: 'test',
      required_tools: '[broken json',
      instructions: 'Test',
    };
    const result = normalizeSkillInput(input);
    // Falls back to wrapping as single string
    expect(result.required_tools).toEqual(['[broken json']);
  });
});

/**
 * Tests for the multi-step execution_plan safety net.
 *
 * This mirrors the logic in ToolRouter.routeToolCall() that strips
 * execution_plan when it has >1 step, forcing Agent tier execution.
 */
describe('Multi-step execution_plan safety net', () => {
  /** Mirrors the safety net logic from tool-router.ts:routeToolCall */
  function applyMultiStepSafetyNet(args: Record<string, unknown>): Record<string, unknown> {
    const plan = args.execution_plan;
    if (Array.isArray(plan) && plan.length > 1) {
      if (!args.required_tools || (Array.isArray(args.required_tools) && args.required_tools.length === 0)) {
        args.required_tools = [...new Set(
          plan
            .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
            .map(s => s.toolName)
            .filter((t): t is string => typeof t === 'string')
        )];
      }
      delete args.execution_plan;
    }
    return args;
  }

  it('should strip 2-step execution_plan and populate required_tools', () => {
    const args = {
      name: 'news-and-send',
      instructions: 'Search AI news and send via Telegram',
      execution_plan: [
        { id: 'step1', toolName: 'searcher_web_search', parameters: { query: 'AI news' } },
        { id: 'step2', toolName: 'telegram_send_message', parameters: { message: '{{step1.result}}' } },
      ],
    };
    const result = applyMultiStepSafetyNet(args);
    expect(result.execution_plan).toBeUndefined();
    expect(result.required_tools).toEqual(['searcher_web_search', 'telegram_send_message']);
  });

  it('should preserve single-step execution_plan', () => {
    const plan = [
      { id: 'step1', toolName: 'telegram_send_message', parameters: { message: 'hello' } },
    ];
    const args = {
      name: 'hello-reminder',
      instructions: 'Send hello',
      execution_plan: plan,
    };
    const result = applyMultiStepSafetyNet(args);
    expect(result.execution_plan).toEqual(plan);
  });

  it('should not overwrite existing required_tools when stripping multi-step plan', () => {
    const args = {
      name: 'news-and-send',
      instructions: 'Search and send',
      required_tools: ['searcher_news_search', 'telegram_send_message'],
      execution_plan: [
        { id: 'step1', toolName: 'searcher_web_search', parameters: { query: 'AI' } },
        { id: 'step2', toolName: 'telegram_send_message', parameters: { message: 'done' } },
      ],
    };
    const result = applyMultiStepSafetyNet(args);
    expect(result.execution_plan).toBeUndefined();
    expect(result.required_tools).toEqual(['searcher_news_search', 'telegram_send_message']);
  });

  it('should deduplicate tool names extracted from plan', () => {
    const args = {
      name: 'double-send',
      instructions: 'Send two messages',
      execution_plan: [
        { id: 'step1', toolName: 'telegram_send_message', parameters: { message: 'first' } },
        { id: 'step2', toolName: 'telegram_send_message', parameters: { message: 'second' } },
      ],
    };
    const result = applyMultiStepSafetyNet(args);
    expect(result.execution_plan).toBeUndefined();
    expect(result.required_tools).toEqual(['telegram_send_message']);
  });

  it('should not touch args without execution_plan', () => {
    const args = {
      name: 'agent-skill',
      instructions: 'Check emails and summarize',
      required_tools: ['gmail_list_messages'],
    };
    const result = applyMultiStepSafetyNet(args);
    expect(result).toEqual(args);
  });
});

describe('validateCronExpression', () => {
  it('should accept valid 5-field cron expression', () => {
    expect(validateCronExpression('* * * * *')).toEqual({ valid: true });
    expect(validateCronExpression('0 9 * * *')).toEqual({ valid: true });
    expect(validateCronExpression('*/5 * * * *')).toEqual({ valid: true });
    expect(validateCronExpression('0 */3 * * *')).toEqual({ valid: true });
    expect(validateCronExpression('0 9,18 * * 1-5')).toEqual({ valid: true });
  });

  it('should accept 6-field cron expression (with seconds)', () => {
    expect(validateCronExpression('0 * * * * *')).toEqual({ valid: true });
    expect(validateCronExpression('30 0 9 * * *')).toEqual({ valid: true });
  });

  it('should reject 4-field cron expression', () => {
    const result = validateCronExpression('* * * *');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should reject invalid characters', () => {
    const result = validateCronExpression('not-a-cron');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should reject out-of-range values', () => {
    expect(validateCronExpression('60 * * * *').valid).toBe(false);
    expect(validateCronExpression('* 25 * * *').valid).toBe(false);
    expect(validateCronExpression('* * 32 * *').valid).toBe(false);
  });

  it('should reject empty string', () => {
    expect(validateCronExpression('').valid).toBe(false);
  });
});
