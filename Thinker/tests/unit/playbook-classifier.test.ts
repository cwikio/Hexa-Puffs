import { describe, it, expect } from 'vitest';
import {
  classifyMessage,
  parseSkillToPlaybook,
  type CachedPlaybook,
} from '../../src/agent/playbook-classifier.js';

const makePlaybook = (
  overrides: Partial<CachedPlaybook> & Pick<CachedPlaybook, 'name' | 'keywords'>
): CachedPlaybook => ({
  id: 1,
  description: null,
  instructions: 'test instructions',
  priority: 0,
  requiredTools: [],
  ...overrides,
});

describe('classifyMessage', () => {
  const playbooks: CachedPlaybook[] = [
    makePlaybook({ id: 1, name: 'email-triage', keywords: ['email', 'inbox', 'unread', 'mail', 'gmail'], priority: 10 }),
    makePlaybook({ id: 2, name: 'research-and-share', keywords: ['search for', 'look up', 'research', 'what is'], priority: 5 }),
    makePlaybook({ id: 3, name: 'schedule-meeting', keywords: ['meeting', 'calendar', 'schedule', 'appointment'], priority: 10 }),
    makePlaybook({ id: 4, name: 'memory-recall', keywords: ['remember', 'what do you know', 'memory', 'recall'], priority: 15 }),
    makePlaybook({ id: 5, name: 'daily-briefing', keywords: ['daily briefing', 'morning briefing', 'overview'], priority: 15 }),
  ];

  it('should match a single playbook by keyword', () => {
    const result = classifyMessage('check my email please', playbooks);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('email-triage');
  });

  it('should match multiple playbooks on a multi-domain message', () => {
    const result = classifyMessage('search for AI news and email it to me', playbooks);
    expect(result.length).toBeGreaterThanOrEqual(2);
    const names = result.map((r) => r.name);
    expect(names).toContain('email-triage');
    expect(names).toContain('research-and-share');
  });

  it('should return matches sorted by priority descending', () => {
    const result = classifyMessage('what do you remember about my email?', playbooks);
    expect(result.length).toBeGreaterThanOrEqual(2);
    // memory-recall (priority 15) should come before email-triage (priority 10)
    expect(result[0].name).toBe('memory-recall');
  });

  it('should be case insensitive', () => {
    const result = classifyMessage('CHECK MY INBOX', playbooks);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('email-triage');
  });

  it('should return empty array when no keywords match', () => {
    const result = classifyMessage('hello, how are you?', playbooks);
    expect(result).toHaveLength(0);
  });

  it('should return empty array for empty message', () => {
    const result = classifyMessage('', playbooks);
    expect(result).toHaveLength(0);
  });

  it('should return empty array for empty playbooks list', () => {
    const result = classifyMessage('check my email', []);
    expect(result).toHaveLength(0);
  });

  it('should match multi-word keywords', () => {
    const result = classifyMessage('give me a daily briefing', playbooks);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('daily-briefing');
  });

  it('should match substring keywords within longer words', () => {
    const result = classifyMessage('I need to schedule something', playbooks);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('schedule-meeting');
  });
});

describe('parseSkillToPlaybook', () => {
  it('should parse a valid skill record', () => {
    const skill = {
      id: 42,
      name: 'email-triage',
      description: 'Handle emails',
      instructions: 'Step 1: list emails',
      trigger_config: {
        keywords: ['email', 'INBOX'],
        priority: 10,
      },
      required_tools: ['list_emails', 'get_email'],
    };

    const result = parseSkillToPlaybook(skill);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(42);
    expect(result!.name).toBe('email-triage');
    expect(result!.keywords).toEqual(['email', 'inbox']); // lowercased
    expect(result!.priority).toBe(10);
    expect(result!.requiredTools).toEqual(['list_emails', 'get_email']);
  });

  it('should return null if keywords are missing', () => {
    const skill = {
      id: 1,
      name: 'test',
      instructions: 'test',
      trigger_config: {},
    };
    expect(parseSkillToPlaybook(skill)).toBeNull();
  });

  it('should return null if trigger_config is null', () => {
    const skill = {
      id: 1,
      name: 'test',
      instructions: 'test',
      trigger_config: null,
    };
    expect(parseSkillToPlaybook(skill)).toBeNull();
  });

  it('should return null if required fields are missing', () => {
    expect(parseSkillToPlaybook({ name: 'test' })).toBeNull();
    expect(parseSkillToPlaybook({ id: 1, instructions: 'test' })).toBeNull();
  });

  it('should default priority to 0 if not specified', () => {
    const skill = {
      id: 1,
      name: 'test',
      instructions: 'test',
      trigger_config: { keywords: ['hello'] },
    };
    const result = parseSkillToPlaybook(skill);
    expect(result!.priority).toBe(0);
  });
});
