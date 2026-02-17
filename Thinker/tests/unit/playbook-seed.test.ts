import { describe, it, expect } from 'vitest';
import { DEFAULT_PLAYBOOKS } from '../../src/agent/playbook-seed.js';

describe('playbook-seed: cron-scheduling', () => {
  const cronPlaybook = DEFAULT_PLAYBOOKS.find((p) => p.name === 'cron-scheduling');

  it('should exist in default playbooks', () => {
    expect(cronPlaybook).toBeDefined();
  });

  it('should include get_tool_catalog in required_tools', () => {
    expect(cronPlaybook!.required_tools).toContain('get_tool_catalog');
  });

  it('should include memory_store_skill in required_tools', () => {
    expect(cronPlaybook!.required_tools).toContain('memory_store_skill');
  });

  it('should include skill management tools in required_tools', () => {
    expect(cronPlaybook!.required_tools).toContain('memory_list_skills');
    expect(cronPlaybook!.required_tools).toContain('memory_delete_skill');
  });

  it('should NOT include removed cron job tools', () => {
    expect(cronPlaybook!.required_tools).not.toContain('create_job');
    expect(cronPlaybook!.required_tools).not.toContain('list_jobs');
    expect(cronPlaybook!.required_tools).not.toContain('delete_job');
  });

  it('should have max_steps of 8', () => {
    expect(cronPlaybook!.max_steps).toBe(8);
  });

  it('should have scheduling keywords', () => {
    const keywords = cronPlaybook!.trigger_config.keywords;
    expect(keywords).toContain('cron');
    expect(keywords).toContain('remind me');
    expect(keywords).toContain('every day');
    expect(keywords).toContain('every morning');
    expect(keywords).toContain('schedule task');
  });

  it('should have structured decision flow in instructions', () => {
    const instructions = cronPlaybook!.instructions;
    expect(instructions).toContain('CLASSIFY');
    expect(instructions).toContain('SIMPLE');
    expect(instructions).toContain('COMPLEX');
    expect(instructions).toContain('execution_plan');
    expect(instructions).toContain('get_tool_catalog');
    expect(instructions).toContain('EXACT tool names');
  });

  it('should have priority 10', () => {
    expect(cronPlaybook!.trigger_config.priority).toBe(10);
  });
});

describe('playbook-seed: skill-management', () => {
  const skillMgmt = DEFAULT_PLAYBOOKS.find((p) => p.name === 'skill-management');

  it('should exist in default playbooks', () => {
    expect(skillMgmt).toBeDefined();
  });

  it('should include skill CRUD tools in required_tools', () => {
    expect(skillMgmt!.required_tools).toContain('memory_list_skills');
    expect(skillMgmt!.required_tools).toContain('memory_get_skill');
    expect(skillMgmt!.required_tools).toContain('memory_delete_skill');
    expect(skillMgmt!.required_tools).toContain('memory_update_skill');
  });

  it('should have keywords for delete, list, and failing skill flows', () => {
    const keywords = skillMgmt!.trigger_config.keywords;
    expect(keywords).toContain('delete skill');
    expect(keywords).toContain('list skills');
    expect(keywords).toContain('failing skill');
    expect(keywords).toContain('show skill');
    expect(keywords).toContain('scheduled tasks');
  });

  it('should have priority 10', () => {
    expect(skillMgmt!.trigger_config.priority).toBe(10);
  });

  it('should have max_steps of 8', () => {
    expect(skillMgmt!.max_steps).toBe(8);
  });

  it('should instruct to confirm before deleting', () => {
    expect(skillMgmt!.instructions).toContain('confirm');
    expect(skillMgmt!.instructions).toContain('memory_delete_skill');
  });
});

describe('playbook-seed: cron-scheduling keywords', () => {
  const cronPlaybook = DEFAULT_PLAYBOOKS.find((p) => p.name === 'cron-scheduling');

  it('should include "minutes" keyword for "every N minutes" patterns', () => {
    expect(cronPlaybook!.trigger_config.keywords).toContain('minutes');
  });

  it('should include "hours" keyword for "every N hours" patterns', () => {
    expect(cronPlaybook!.trigger_config.keywords).toContain('hours');
  });
});

describe('playbook-seed: research-and-share keywords', () => {
  const researchPlaybook = DEFAULT_PLAYBOOKS.find((p) => p.name === 'research-and-share');

  it('should include "news" keyword', () => {
    expect(researchPlaybook!.trigger_config.keywords).toContain('news');
  });

  it('should include "headlines" keyword', () => {
    expect(researchPlaybook!.trigger_config.keywords).toContain('headlines');
  });

  it('should include "what\'s new" keyword', () => {
    expect(researchPlaybook!.trigger_config.keywords).toContain("what's new");
  });
});

describe('playbook-seed: structural integrity', () => {
  it('should have unique names across all playbooks', () => {
    const names = DEFAULT_PLAYBOOKS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('all playbooks should have required fields', () => {
    for (const pb of DEFAULT_PLAYBOOKS) {
      expect(pb.name, `${pb.name}: missing name`).toBeTruthy();
      expect(pb.trigger_type, `${pb.name}: wrong trigger_type`).toBe('event');
      expect(pb.trigger_config.keywords.length, `${pb.name}: no keywords`).toBeGreaterThan(0);
      expect(pb.instructions.length, `${pb.name}: instructions too short`).toBeGreaterThan(10);
      expect(pb.required_tools.length, `${pb.name}: no required_tools`).toBeGreaterThan(0);
      expect(pb.max_steps, `${pb.name}: max_steps too low`).toBeGreaterThanOrEqual(3);
    }
  });
});
