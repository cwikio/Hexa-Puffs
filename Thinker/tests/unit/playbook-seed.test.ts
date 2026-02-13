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

  it('should include cron job tools in required_tools', () => {
    expect(cronPlaybook!.required_tools).toContain('create_job');
    expect(cronPlaybook!.required_tools).toContain('list_jobs');
    expect(cronPlaybook!.required_tools).toContain('delete_job');
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
    expect(instructions).toContain('CRON JOB');
    expect(instructions).toContain('SKILL');
    expect(instructions).toContain('get_tool_catalog');
    expect(instructions).toContain('EXACT tool names');
  });

  it('should have priority 10', () => {
    expect(cronPlaybook!.trigger_config.priority).toBe(10);
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
