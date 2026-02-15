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
  source: 'database',
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

  it('should match keywords that appear as whole words in the message', () => {
    const result = classifyMessage('I need to schedule something', playbooks);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('schedule-meeting');
  });

  it('should NOT match keyword as substring of another word', () => {
    const pbWithFile: CachedPlaybook[] = [
      makePlaybook({ id: 10, name: 'file-ops', keywords: ['file'], priority: 5 }),
    ];
    expect(classifyMessage('update my profile settings', pbWithFile)).toHaveLength(0);
    expect(classifyMessage('meanwhile I was busy', pbWithFile)).toHaveLength(0);
  });

  it('should handle keywords with non-word-boundary characters via includes() fallback', () => {
    const pbSpecial: CachedPlaybook[] = [
      makePlaybook({ id: 20, name: 'special', keywords: ['c++', '.net'], priority: 5 }),
    ];
    // These keywords start/end with non-word chars — matchesKeyword falls back to includes()
    expect(classifyMessage('I am learning c++ today', pbSpecial)).toHaveLength(1);
    expect(classifyMessage('deploy to .net framework', pbSpecial)).toHaveLength(1);
  });
});

describe('classifyMessage — new playbooks (system-health-check, message-cleanup)', () => {
  const allPlaybooks: CachedPlaybook[] = [
    makePlaybook({ id: 1, name: 'email-triage', keywords: ['email', 'inbox'], priority: 10 }),
    makePlaybook({
      id: 11,
      name: 'system-health-check',
      keywords: [
        "what's broken", 'what is broken', 'system status', 'health check',
        'are you ok', 'are you working', 'is everything running',
        "what's running", 'what is running', 'service status',
        'any issues', 'any problems', 'diagnostics',
      ],
      priority: 15,
    }),
    makePlaybook({
      id: 12,
      name: 'message-cleanup',
      keywords: [
        'clean up messages', 'clean up', 'cleanup messages', 'cleanup',
        'delete messages', 'clear messages',
        'purge messages', 'remove messages', 'clear chat',
        'clean test messages', 'delete test messages',
      ],
      priority: 10,
    }),
  ];

  it('should match system-health-check for "what\'s broken?"', () => {
    const result = classifyMessage("what's broken?", allPlaybooks);
    const names = result.map((r) => r.name);
    expect(names).toContain('system-health-check');
  });

  it('should match system-health-check for "is everything running?"', () => {
    const result = classifyMessage('is everything running?', allPlaybooks);
    const names = result.map((r) => r.name);
    expect(names).toContain('system-health-check');
  });

  it('should match system-health-check for "any issues with the system?"', () => {
    const result = classifyMessage('any issues with the system?', allPlaybooks);
    const names = result.map((r) => r.name);
    expect(names).toContain('system-health-check');
  });

  it('should match message-cleanup for "delete messages from today"', () => {
    const result = classifyMessage('delete messages from today', allPlaybooks);
    const names = result.map((r) => r.name);
    expect(names).toContain('message-cleanup');
  });

  it('should match message-cleanup for "clean up test messages"', () => {
    const result = classifyMessage('clean up test messages', allPlaybooks);
    const names = result.map((r) => r.name);
    expect(names).toContain('message-cleanup');
  });

  it('should match message-cleanup for "purge messages"', () => {
    const result = classifyMessage('purge messages', allPlaybooks);
    const names = result.map((r) => r.name);
    expect(names).toContain('message-cleanup');
  });

  it('should not match new playbooks for unrelated messages', () => {
    const result = classifyMessage('hello how are you', allPlaybooks);
    const names = result.map((r) => r.name);
    expect(names).not.toContain('system-health-check');
    expect(names).not.toContain('message-cleanup');
  });

  it('should rank system-health-check (priority 15) above message-cleanup (priority 10)', () => {
    // A message that matches both
    const result = classifyMessage('any problems with delete messages?', allPlaybooks);
    const healthIdx = result.findIndex((r) => r.name === 'system-health-check');
    const cleanupIdx = result.findIndex((r) => r.name === 'message-cleanup');
    if (healthIdx !== -1 && cleanupIdx !== -1) {
      expect(healthIdx).toBeLessThan(cleanupIdx);
    }
  });
});

describe('classifyMessage — real user scenarios', () => {
  const playbooks: CachedPlaybook[] = [
    makePlaybook({
      id: 20,
      name: 'research-and-share',
      keywords: ['search for', 'find out', 'look up', 'research', 'what is', 'tell me about', 'latest news', 'news', 'headlines', "what's new"],
      priority: 5,
    }),
    makePlaybook({
      id: 21,
      name: 'cron-scheduling',
      keywords: [
        'schedule', 'cron', 'every day', 'every morning', 'every evening',
        'every hour', 'every minute', 'recurring', 'remind me', 'remind me at',
        'schedule task', 'set up a job', 'automate', 'periodic',
        'alert me', 'notify me', 'minutes', 'hours',
      ],
      priority: 10,
    }),
    makePlaybook({
      id: 22,
      name: 'skill-management',
      keywords: [
        'delete skill', 'remove skill', 'disable skill',
        'failing skill', 'broken skill', 'failed skill',
        'my skills', 'list skills', 'show skill', 'skill status',
        'manage skills', 'skill details', 'what skills',
        'delete job', 'remove job', 'failing job',
        'my jobs', 'list jobs', 'scheduled tasks',
      ],
      priority: 10,
    }),
  ];

  it('should match research-and-share for "send me AI news"', () => {
    const result = classifyMessage('send me AI news', playbooks);
    const names = result.map(r => r.name);
    expect(names).toContain('research-and-share');
  });

  it('should match research-and-share for "what\'s new in tech?"', () => {
    const result = classifyMessage("what's new in tech?", playbooks);
    const names = result.map(r => r.name);
    expect(names).toContain('research-and-share');
  });

  it('should match research-and-share for "latest headlines"', () => {
    const result = classifyMessage('latest headlines', playbooks);
    const names = result.map(r => r.name);
    expect(names).toContain('research-and-share');
  });

  it('should match cron-scheduling for "every 2 minutes"', () => {
    const result = classifyMessage('send me one ai news every 2 minutes', playbooks);
    const names = result.map(r => r.name);
    expect(names).toContain('cron-scheduling');
  });

  it('should match cron-scheduling for "every 30 minutes"', () => {
    const result = classifyMessage('check my email every 30 minutes', playbooks);
    const names = result.map(r => r.name);
    expect(names).toContain('cron-scheduling');
  });

  it('should match cron-scheduling for "in 2 hours"', () => {
    const result = classifyMessage('remind me in 2 hours', playbooks);
    const names = result.map(r => r.name);
    expect(names).toContain('cron-scheduling');
  });

  it('should match skill-management for "delete skill 647"', () => {
    const result = classifyMessage('delete skill 647', playbooks);
    const names = result.map(r => r.name);
    expect(names).toContain('skill-management');
  });

  it('should match skill-management for "show skill 1700"', () => {
    const result = classifyMessage('show skill 1700', playbooks);
    const names = result.map(r => r.name);
    expect(names).toContain('skill-management');
  });

  it('should match skill-management for "what skills are failing"', () => {
    const result = classifyMessage('what skills are failing', playbooks);
    const names = result.map(r => r.name);
    expect(names).toContain('skill-management');
  });

  it('should match skill-management for "list my jobs"', () => {
    const result = classifyMessage('list my jobs', playbooks);
    const names = result.map(r => r.name);
    expect(names).toContain('skill-management');
  });

  it('should match skill-management for "my scheduled tasks"', () => {
    const result = classifyMessage('show me my scheduled tasks', playbooks);
    const names = result.map(r => r.name);
    expect(names).toContain('skill-management');
  });

  it('should match both research + cron for "send me AI news every 2 minutes"', () => {
    const result = classifyMessage('send me one ai news every 2 minutes', playbooks);
    const names = result.map(r => r.name);
    expect(names).toContain('research-and-share');
    expect(names).toContain('cron-scheduling');
    // cron-scheduling (priority 10) should rank above research-and-share (priority 5)
    expect(result.findIndex(r => r.name === 'cron-scheduling'))
      .toBeLessThan(result.findIndex(r => r.name === 'research-and-share'));
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
