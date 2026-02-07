/**
 * PlaybookClassifier - Lightweight keyword matching to map user messages to domain playbooks.
 * Pure functions, no I/O, no dependencies on the agent loop.
 */

export interface CachedPlaybook {
  id: number;
  name: string;
  description: string | null;
  instructions: string;
  keywords: string[];
  priority: number;
  requiredTools: string[];
}

/**
 * Classify a user message against cached playbooks using keyword substring matching.
 * Returns matching playbooks sorted by priority (highest first).
 * Multiple playbooks can match a single message.
 */
export function classifyMessage(
  message: string,
  playbooks: CachedPlaybook[]
): CachedPlaybook[] {
  if (!message || playbooks.length === 0) return [];

  const lower = message.toLowerCase();
  const matched: CachedPlaybook[] = [];

  for (const pb of playbooks) {
    if (pb.keywords.some((kw) => lower.includes(kw))) {
      matched.push(pb);
    }
  }

  return matched.sort((a, b) => b.priority - a.priority);
}

/**
 * Parse a Memorizer skill record into a CachedPlaybook.
 * Returns null if the skill doesn't have valid playbook trigger_config.
 */
export function parseSkillToPlaybook(
  skill: Record<string, unknown>
): CachedPlaybook | null {
  const id = skill.id as number | undefined;
  const name = skill.name as string | undefined;
  const instructions = skill.instructions as string | undefined;

  if (!id || !name || !instructions) return null;

  const triggerConfig = skill.trigger_config as Record<string, unknown> | null;
  const keywords = (triggerConfig?.keywords as string[] | undefined) ?? [];

  if (keywords.length === 0) return null;

  return {
    id,
    name,
    description: (skill.description as string | null) ?? null,
    instructions,
    keywords: keywords.map((k) => k.toLowerCase()),
    priority: (triggerConfig?.priority as number | undefined) ?? 0,
    requiredTools: (skill.required_tools as string[] | undefined) ?? [],
  };
}
