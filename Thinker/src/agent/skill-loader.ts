/**
 * SkillLoader - Scans ~/.annabelle/skills/ for agentskills.io-compatible SKILL.md files.
 * Parses YAML frontmatter + markdown body, maps to CachedPlaybook for classifier.
 *
 * Compatible with the Agent Skills specification (https://agentskills.io/specification).
 * Annabelle-specific extensions (keywords, priority, required_tools) go in the
 * standard `metadata` block, which the spec reserves for arbitrary key-value pairs.
 */

import { readdir, readFile, stat } from 'fs/promises';
import { resolve, join } from 'path';
import { parse as parseYaml } from 'yaml';
import type { CachedPlaybook } from './playbook-classifier.js';
import { Logger } from '@mcp/shared/Utils/logger.js';

const logger = new Logger('thinker:skill-loader');

/**
 * Parsed SKILL.md frontmatter following the agentskills.io spec.
 */
interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  'allowed-tools'?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Generate a stable negative ID from a skill name.
 * Negative IDs distinguish file-based skills from DB playbooks (positive IDs).
 */
function nameToNegativeId(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return -Math.abs(hash || 1);
}

/**
 * Split a SKILL.md file into YAML frontmatter and markdown body.
 * Returns null if the file doesn't have valid frontmatter delimiters.
 */
function splitFrontmatter(content: string): { yaml: string; body: string } | null {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) return null;

  // Find the closing --- delimiter (skip the opening one)
  const afterOpening = trimmed.indexOf('\n');
  if (afterOpening === -1) return null;

  const closingIdx = trimmed.indexOf('\n---', afterOpening);
  if (closingIdx === -1) return null;

  const yaml = trimmed.substring(afterOpening + 1, closingIdx);
  const body = trimmed.substring(closingIdx + 4).trim(); // skip \n---

  return { yaml, body };
}

export class SkillLoader {
  private skillsDir: string;

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
  }

  /**
   * Scan skillsDir for directories containing SKILL.md.
   * Returns parsed skills mapped to CachedPlaybook format.
   */
  async scan(): Promise<CachedPlaybook[]> {
    const results: CachedPlaybook[] = [];

    let entries: string[];
    try {
      entries = await readdir(this.skillsDir);
    } catch {
      // Directory doesn't exist or isn't readable — not an error
      return results;
    }

    for (const entry of entries) {
      const dirPath = resolve(this.skillsDir, entry);

      try {
        const dirStat = await stat(dirPath);
        if (!dirStat.isDirectory()) continue;
      } catch {
        continue;
      }

      const skillMdPath = join(dirPath, 'SKILL.md');
      const playbook = await this.parseSkillFile(skillMdPath, entry);
      if (playbook) {
        results.push(playbook);
      }
    }

    return results;
  }

  /**
   * Parse a single SKILL.md file into a CachedPlaybook.
   * Returns null if the file doesn't exist or has invalid format.
   */
  private async parseSkillFile(
    skillMdPath: string,
    dirName: string,
  ): Promise<CachedPlaybook | null> {
    let content: string;
    try {
      content = await readFile(skillMdPath, 'utf-8');
    } catch {
      return null; // No SKILL.md in this directory
    }

    // Split frontmatter from body
    const parts = splitFrontmatter(content);
    if (!parts) {
      logger.warn(` ${dirName}/SKILL.md has no valid YAML frontmatter, skipping`);
      return null;
    }

    // Parse YAML frontmatter
    let fm: SkillFrontmatter;
    try {
      fm = parseYaml(parts.yaml);
    } catch (error) {
      logger.warn(
        `Failed to parse YAML in ${dirName}/SKILL.md: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }

    // Validate required fields (agentskills.io spec)
    if (!fm.name || typeof fm.name !== 'string') {
      logger.warn(` ${dirName}/SKILL.md missing required 'name' field, skipping`);
      return null;
    }
    if (!fm.description || typeof fm.description !== 'string') {
      logger.warn(` ${dirName}/SKILL.md missing required 'description' field, skipping`);
      return null;
    }

    // Validate name matches directory name (agentskills.io requirement)
    if (fm.name !== dirName) {
      logger.warn(
        `${dirName}/SKILL.md name "${fm.name}" doesn't match directory name "${dirName}", skipping`,
      );
      return null;
    }

    // Extract Annabelle extensions from metadata block
    const meta = fm.metadata ?? {};
    const keywords = Array.isArray(meta.keywords)
      ? (meta.keywords as unknown[]).filter((k): k is string => typeof k === 'string')
      : [];
    const priority = typeof meta.priority === 'number' ? meta.priority : 0;
    const requiredTools = Array.isArray(meta.required_tools)
      ? (meta.required_tools as unknown[]).filter((t): t is string => typeof t === 'string')
      : [];

    // Also parse allowed-tools from the spec's standard field
    if (fm['allowed-tools'] && requiredTools.length === 0) {
      const tools = fm['allowed-tools'].split(/\s+/).filter(Boolean);
      requiredTools.push(...tools);
    }

    // Extract scheduling extensions from metadata
    const triggerConfig = meta.trigger_config && typeof meta.trigger_config === 'object'
      ? meta.trigger_config as Record<string, unknown>
      : undefined;
    const maxSteps = typeof meta.max_steps === 'number' ? meta.max_steps : undefined;
    const executionPlan = Array.isArray(meta.execution_plan) ? meta.execution_plan as Array<{
      id: string;
      toolName: string;
      parameters?: Record<string, unknown>;
    }> : undefined;

    return {
      id: nameToNegativeId(fm.name),
      name: fm.name,
      description: fm.description,
      instructions: parts.body,
      keywords: keywords.map((k) => k.toLowerCase()),
      priority,
      requiredTools,
      source: 'file',
      triggerConfig,
      maxSteps,
      executionPlan,
    };
  }
}
