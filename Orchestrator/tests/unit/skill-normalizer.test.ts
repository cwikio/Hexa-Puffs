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
