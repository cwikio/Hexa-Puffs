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

describe('SkillLoader', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'skill-loader-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ─── Full agentskills.io SKILL.md with Annabelle metadata ───────────────

  it('should parse a SKILL.md with full Annabelle metadata', async () => {
    await createSkill(tempDir, 'email-triage', `---
name: email-triage
description: Check, read, and summarize unread emails.
metadata:
  author: annabelle
  version: "1.0"
  keywords:
    - email
    - inbox
    - unread
  priority: 10
  required_tools:
    - gmail_list_emails
    - gmail_get_email
---

## Steps
1. List unread emails
2. Summarize them
`);

    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toHaveLength(1);
    const skill = skills[0];
    expect(skill.name).toBe('email-triage');
    expect(skill.description).toBe('Check, read, and summarize unread emails.');
    expect(skill.keywords).toEqual(['email', 'inbox', 'unread']);
    expect(skill.priority).toBe(10);
    expect(skill.requiredTools).toEqual(['gmail_list_emails', 'gmail_get_email']);
    expect(skill.source).toBe('file');
    expect(skill.id).toBeLessThan(0); // negative ID
    expect(skill.instructions).toContain('## Steps');
    expect(skill.instructions).toContain('List unread emails');
  });

  // ─── Minimal SKILL.md (no metadata — description-only skill) ────────────

  it('should parse a minimal SKILL.md with only name and description', async () => {
    await createSkill(tempDir, 'code-review', `---
name: code-review
description: Review code snippets for bugs and improvements.
---

Analyze the code and provide feedback.
`);

    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toHaveLength(1);
    const skill = skills[0];
    expect(skill.name).toBe('code-review');
    expect(skill.description).toBe('Review code snippets for bugs and improvements.');
    expect(skill.keywords).toEqual([]); // no keywords = description-only
    expect(skill.priority).toBe(0); // default
    expect(skill.requiredTools).toEqual([]);
    expect(skill.source).toBe('file');
    expect(skill.instructions).toContain('Analyze the code');
  });

  // ─── allowed-tools fallback ─────────────────────────────────────────────

  it('should use allowed-tools as fallback for requiredTools', async () => {
    await createSkill(tempDir, 'web-search', `---
name: web-search
description: Search the web for information.
allowed-tools: searcher_web_search searcher_scrape
---

Use the search tool.
`);

    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toHaveLength(1);
    expect(skills[0].requiredTools).toEqual(['searcher_web_search', 'searcher_scrape']);
  });

  it('should prefer metadata.required_tools over allowed-tools', async () => {
    await createSkill(tempDir, 'hybrid-skill', `---
name: hybrid-skill
description: A skill with both fields.
allowed-tools: tool_a tool_b
metadata:
  required_tools:
    - tool_c
---

Instructions here.
`);

    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toHaveLength(1);
    // metadata.required_tools takes precedence (allowed-tools is fallback only)
    expect(skills[0].requiredTools).toEqual(['tool_c']);
  });

  // ─── Multiple skills ────────────────────────────────────────────────────

  it('should scan multiple skill directories', async () => {
    await createSkill(tempDir, 'skill-one', `---
name: skill-one
description: First skill.
---

First.
`);
    await createSkill(tempDir, 'skill-two', `---
name: skill-two
description: Second skill.
metadata:
  keywords:
    - two
  priority: 5
---

Second.
`);

    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(['skill-one', 'skill-two']);
  });

  // ─── Stable negative IDs ────────────────────────────────────────────────

  it('should generate stable IDs across scans', async () => {
    await createSkill(tempDir, 'stable-id-test', `---
name: stable-id-test
description: Testing ID stability.
---

Body.
`);

    const loader = new SkillLoader(tempDir);
    const first = await loader.scan();
    const second = await loader.scan();

    expect(first[0].id).toBe(second[0].id);
    expect(first[0].id).toBeLessThan(0);
  });

  // ─── Validation: missing name ───────────────────────────────────────────

  it('should skip SKILL.md with missing name field', async () => {
    await createSkill(tempDir, 'no-name', `---
description: A skill without a name.
---

Body.
`);

    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toHaveLength(0);
  });

  // ─── Validation: missing description ────────────────────────────────────

  it('should skip SKILL.md with missing description field', async () => {
    await createSkill(tempDir, 'no-desc', `---
name: no-desc
---

Body.
`);

    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toHaveLength(0);
  });

  // ─── Validation: name/directory mismatch ────────────────────────────────

  it('should skip SKILL.md where name does not match directory name', async () => {
    await createSkill(tempDir, 'dir-name', `---
name: different-name
description: Name doesn't match directory.
---

Body.
`);

    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toHaveLength(0);
  });

  // ─── Validation: no frontmatter ─────────────────────────────────────────

  it('should skip SKILL.md with no YAML frontmatter', async () => {
    await createSkill(tempDir, 'no-frontmatter', `# Just markdown

No frontmatter delimiters here.
`);

    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toHaveLength(0);
  });

  // ─── Validation: invalid YAML ───────────────────────────────────────────

  it('should skip SKILL.md with invalid YAML', async () => {
    await createSkill(tempDir, 'bad-yaml', `---
name: bad-yaml
description: [invalid: yaml: {{
---

Body.
`);

    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toHaveLength(0);
  });

  // ─── Non-existent directory ─────────────────────────────────────────────

  it('should return empty array when skills directory does not exist', async () => {
    const loader = new SkillLoader('/tmp/nonexistent-skills-dir-12345');
    const skills = await loader.scan();

    expect(skills).toEqual([]);
  });

  // ─── Empty directory ────────────────────────────────────────────────────

  it('should return empty array for an empty skills directory', async () => {
    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toEqual([]);
  });

  // ─── Skips non-directory entries ────────────────────────────────────────

  it('should skip files (non-directories) in the skills directory', async () => {
    // Create a regular file (not a directory) in the skills dir
    await writeFile(join(tempDir, 'README.md'), '# Not a skill', 'utf-8');

    // Also create a valid skill to verify scanning still works
    await createSkill(tempDir, 'valid-skill', `---
name: valid-skill
description: A valid skill.
---

Works.
`);

    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('valid-skill');
  });

  // ─── Skips directories without SKILL.md ─────────────────────────────────

  it('should skip directories that have no SKILL.md file', async () => {
    // Create an empty directory
    await mkdir(join(tempDir, 'empty-dir'));

    // Also create a valid skill
    await createSkill(tempDir, 'has-skill', `---
name: has-skill
description: This one has a SKILL.md.
---

Content.
`);

    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('has-skill');
  });

  // ─── Keywords are lowercased ────────────────────────────────────────────

  it('should lowercase all keywords', async () => {
    await createSkill(tempDir, 'case-test', `---
name: case-test
description: Test keyword casing.
metadata:
  keywords:
    - Email
    - INBOX
    - Unread
---

Body.
`);

    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toHaveLength(1);
    expect(skills[0].keywords).toEqual(['email', 'inbox', 'unread']);
  });

  // ─── Quoted strings in YAML ─────────────────────────────────────────────

  it('should handle quoted strings with colons in YAML', async () => {
    await createSkill(tempDir, 'quoted-yaml', `---
name: quoted-yaml
description: "Description with: colons and special chars!"
metadata:
  author: "test: org"
  keywords:
    - "key: word"
---

Body.
`);

    const loader = new SkillLoader(tempDir);
    const skills = await loader.scan();

    expect(skills).toHaveLength(1);
    expect(skills[0].description).toBe('Description with: colons and special chars!');
    expect(skills[0].keywords).toEqual(['key: word']);
  });
});
