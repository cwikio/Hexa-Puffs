import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { SkillLoader } from '../../src/agent/skill-loader.js';

/**
 * Helper: create a skill directory with a SKILL.md file inside a temp dir.
 */
async function createSkill(
  baseDir: string,
  dirName: string,
  skillMdContent: string,
): Promise<string> {
  const skillDir = join(baseDir, dirName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), skillMdContent, 'utf-8');
  return skillDir;
}

describe('SkillLoader — schedule extraction from metadata', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'skill-loader-schedule-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should extract trigger_config.schedule from metadata', async () => {
    await createSkill(tempDir, 'daily-report', `---
name: daily-report
description: Send a daily summary.
metadata:
  trigger_config:
    schedule: "0 9 * * *"
    timezone: Europe/Warsaw
  required_tools:
    - telegram_send_message
---

Summarize today's events and send via Telegram.
`);

    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toHaveLength(1);
    const skill = skills[0];
    expect(skill.triggerConfig).toEqual({
      schedule: '0 9 * * *',
      timezone: 'Europe/Warsaw',
    });
    expect(skill.requiredTools).toEqual(['telegram_send_message']);
  });

  it('should extract trigger_config.interval_minutes from metadata', async () => {
    await createSkill(tempDir, 'interval-check', `---
name: interval-check
description: Check something every 30 minutes.
metadata:
  trigger_config:
    interval_minutes: 30
---

Do the check.
`);

    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toHaveLength(1);
    expect(skills[0].triggerConfig).toEqual({ interval_minutes: 30 });
  });

  it('should extract trigger_config.at for one-shot schedule', async () => {
    await createSkill(tempDir, 'one-shot-reminder', `---
name: one-shot-reminder
description: Remind about a meeting.
metadata:
  trigger_config:
    at: "2026-02-14T09:00:00"
---

Send a reminder about the meeting.
`);

    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toHaveLength(1);
    expect(skills[0].triggerConfig).toEqual({ at: '2026-02-14T09:00:00' });
  });

  it('should return undefined triggerConfig when no trigger_config in metadata', async () => {
    await createSkill(tempDir, 'no-schedule', `---
name: no-schedule
description: A manual-only skill.
metadata:
  keywords:
    - manual
---

Just instructions.
`);

    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toHaveLength(1);
    expect(skills[0].triggerConfig).toBeUndefined();
  });

  it('should return undefined triggerConfig when no metadata at all', async () => {
    await createSkill(tempDir, 'minimal-skill', `---
name: minimal-skill
description: Bare minimum skill.
---

Body.
`);

    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toHaveLength(1);
    expect(skills[0].triggerConfig).toBeUndefined();
    expect(skills[0].maxSteps).toBeUndefined();
    expect(skills[0].executionPlan).toBeUndefined();
  });

  it('should extract max_steps from metadata', async () => {
    await createSkill(tempDir, 'limited-skill', `---
name: limited-skill
description: A skill with step limit.
metadata:
  max_steps: 5
  trigger_config:
    schedule: "0 */2 * * *"
---

Run with limited steps.
`);

    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toHaveLength(1);
    expect(skills[0].maxSteps).toBe(5);
    expect(skills[0].triggerConfig).toEqual({ schedule: '0 */2 * * *' });
  });

  it('should extract execution_plan from metadata', async () => {
    await createSkill(tempDir, 'direct-skill', `---
name: direct-skill
description: A skill with a direct execution plan.
metadata:
  trigger_config:
    schedule: "*/5 * * * *"
  execution_plan:
    - id: step1
      toolName: telegram_send_message
      parameters:
        chat_id: "123"
        message: "Hello from direct tier!"
---

This skill runs without LLM involvement.
`);

    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toHaveLength(1);
    const skill = skills[0];
    expect(skill.executionPlan).toEqual([
      {
        id: 'step1',
        toolName: 'telegram_send_message',
        parameters: { chat_id: '123', message: 'Hello from direct tier!' },
      },
    ]);
    expect(skill.triggerConfig).toEqual({ schedule: '*/5 * * * *' });
  });

  it('should handle execution_plan with multiple steps', async () => {
    await createSkill(tempDir, 'multi-step', `---
name: multi-step
description: Multi-step direct skill.
metadata:
  execution_plan:
    - id: search
      toolName: searcher_web_search
      parameters:
        query: "latest AI news"
    - id: notify
      toolName: telegram_send_message
      parameters:
        chat_id: "456"
        message: "Search done"
---

Two-step workflow.
`);

    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toHaveLength(1);
    expect(skills[0].executionPlan).toHaveLength(2);
    expect(skills[0].executionPlan![0].id).toBe('search');
    expect(skills[0].executionPlan![1].id).toBe('notify');
  });

  it('should return undefined executionPlan when metadata has no execution_plan', async () => {
    await createSkill(tempDir, 'agent-skill', `---
name: agent-skill
description: Uses Thinker agent tier.
metadata:
  trigger_config:
    schedule: "0 8 * * *"
---

Complex instructions for the agent.
`);

    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toHaveLength(1);
    expect(skills[0].executionPlan).toBeUndefined();
  });
});
