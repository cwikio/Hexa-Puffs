import { z } from 'zod';
import { getDatabase, type SkillRow, TRIGGER_TYPES } from '../db/index.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import {
  type StandardResponse,
  createSuccess,
  createError,
  createErrorFromException,
} from '@mcp/shared/Types/StandardResponse.js';
import {
  type StoreSkillData,
  type ListSkillsData,
  type GetSkillData,
  type UpdateSkillData,
  type DeleteSkillData,
} from '../types/responses.js';

// ============================================================================
// Helper: convert a SkillRow to the API response shape
// ============================================================================

function formatSkill(row: SkillRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled === 1,
    trigger_type: row.trigger_type,
    trigger_config: row.trigger_config ? JSON.parse(row.trigger_config) : null,
    instructions: row.instructions,
    required_tools: row.required_tools ? JSON.parse(row.required_tools) : [],
    max_steps: row.max_steps,
    notify_on_completion: row.notify_on_completion === 1,
    last_run_at: row.last_run_at,
    last_run_status: row.last_run_status,
    last_run_summary: row.last_run_summary,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ============================================================================
// Tool Definitions
// ============================================================================

export const storeSkillToolDefinition = {
  name: 'store_skill',
  description: 'Create a new autonomous skill — a scheduled or manually triggered behavior the assistant performs independently. trigger_type: "cron" for recurring schedules (e.g., daily email digest), "manual" for on-demand execution, "event" for event-driven triggers. Instructions should be natural language describing what the LLM should do step by step.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'Which agent owns this skill',
        default: 'main',
      },
      name: {
        type: 'string',
        description: 'Skill name (e.g. "Email Organizer")',
      },
      description: {
        type: 'string',
        description: 'Brief description of what this skill does',
      },
      trigger_type: {
        type: 'string',
        description: 'When this skill triggers',
        enum: TRIGGER_TYPES,
      },
      trigger_config: {
        type: 'object',
        description: 'For cron trigger_type, use EITHER: (1) Cron expression: { "schedule": "0 9 * * *", "timezone": "Europe/Warsaw" } for precise scheduling (e.g., 9am daily), OR (2) Interval: { "interval_minutes": 60 } for every-N-minutes execution. Default if omitted: runs once daily.',
      },
      instructions: {
        type: 'string',
        description: 'Natural language instructions for the LLM to follow when executing this skill',
      },
      required_tools: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of tool names this skill needs',
      },
      max_steps: {
        type: 'number',
        description: 'Maximum LLM reasoning steps allowed (default: 10)',
        default: 10,
      },
      notify_on_completion: {
        type: 'boolean',
        description: 'Send a Telegram notification when skill finishes (default: true)',
        default: true,
      },
      enabled: {
        type: 'boolean',
        description: 'Whether the skill is enabled (default: true). Set to false to seed skills that auto-enable later.',
        default: true,
      },
    },
    required: ['name', 'trigger_type', 'instructions'],
  },
};

export const listSkillsToolDefinition = {
  name: 'list_skills',
  description: 'List all registered skills with optional filtering by enabled status or trigger type. Returns skill IDs, names, schedules, and last run information.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'Agent ID to filter by',
        default: 'main',
      },
      enabled: {
        type: 'boolean',
        description: 'Filter by enabled/disabled status',
      },
      trigger_type: {
        type: 'string',
        description: 'Filter by trigger type',
        enum: TRIGGER_TYPES,
      },
    },
  },
};

export const getSkillToolDefinition = {
  name: 'get_skill',
  description: 'Get a single skill by ID',
  inputSchema: {
    type: 'object' as const,
    properties: {
      skill_id: {
        type: 'number',
        description: 'The ID of the skill',
      },
    },
    required: ['skill_id'],
  },
};

export const updateSkillToolDefinition = {
  name: 'update_skill',
  description: 'Update an existing skill (enable/disable, change schedule, update instructions, record last run)',
  inputSchema: {
    type: 'object' as const,
    properties: {
      skill_id: {
        type: 'number',
        description: 'The ID of the skill to update',
      },
      name: { type: 'string', description: 'New name' },
      description: { type: 'string', description: 'New description' },
      enabled: { type: 'boolean', description: 'Enable or disable the skill' },
      trigger_type: { type: 'string', enum: TRIGGER_TYPES, description: 'New trigger type' },
      trigger_config: { type: 'object', description: 'New trigger configuration' },
      instructions: { type: 'string', description: 'New instructions' },
      required_tools: { type: 'array', items: { type: 'string' }, description: 'New required tools list' },
      max_steps: { type: 'number', description: 'New max steps' },
      notify_on_completion: { type: 'boolean', description: 'New notification setting' },
      last_run_at: { type: 'string', description: 'ISO datetime of last run' },
      last_run_status: { type: 'string', description: 'Last run status (success/error)' },
      last_run_summary: { type: 'string', description: 'Summary of the last run' },
    },
    required: ['skill_id'],
  },
};

export const deleteSkillToolDefinition = {
  name: 'delete_skill',
  description: 'Delete a skill by ID',
  inputSchema: {
    type: 'object' as const,
    properties: {
      skill_id: {
        type: 'number',
        description: 'The ID of the skill to delete',
      },
    },
    required: ['skill_id'],
  },
};

// ============================================================================
// Input Schemas (Zod)
// ============================================================================

export const StoreSkillInputSchema = z.object({
  agent_id: z.string().default('main'),
  name: z.string().min(1),
  description: z.string().optional(),
  trigger_type: z.enum(TRIGGER_TYPES),
  trigger_config: z.record(z.unknown()).optional(),
  instructions: z.string().min(1),
  required_tools: z.array(z.string()).optional(),
  max_steps: z.number().positive().default(10),
  notify_on_completion: z.boolean().default(true),
  enabled: z.boolean().default(true),
});

export const ListSkillsInputSchema = z.object({
  agent_id: z.string().default('main'),
  enabled: z.boolean().optional(),
  trigger_type: z.enum(TRIGGER_TYPES).optional(),
});

export const GetSkillInputSchema = z.object({
  skill_id: z.number().positive(),
});

export const UpdateSkillInputSchema = z.object({
  skill_id: z.number().positive(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  trigger_type: z.enum(TRIGGER_TYPES).optional(),
  trigger_config: z.record(z.unknown()).optional(),
  instructions: z.string().min(1).optional(),
  required_tools: z.array(z.string()).optional(),
  max_steps: z.number().positive().optional(),
  notify_on_completion: z.boolean().optional(),
  last_run_at: z.string().optional(),
  last_run_status: z.string().optional(),
  last_run_summary: z.string().optional(),
});

export const DeleteSkillInputSchema = z.object({
  skill_id: z.number().positive(),
});

// ============================================================================
// Handler Functions
// ============================================================================

export async function handleStoreSkill(args: unknown): Promise<StandardResponse<StoreSkillData>> {
  const parseResult = StoreSkillInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const {
    agent_id, name, description, trigger_type, trigger_config,
    instructions, required_tools, max_steps, notify_on_completion, enabled,
  } = parseResult.data;

  try {
    const db = getDatabase();

    // Check for duplicate name within agent
    const existing = db
      .prepare(`SELECT id FROM skills WHERE agent_id = ? AND name = ?`)
      .get(agent_id, name) as { id: number } | undefined;

    if (existing) {
      return createError(`Skill with name "${name}" already exists for agent "${agent_id}" (id: ${existing.id})`);
    }

    const result = db
      .prepare(
        `INSERT INTO skills (agent_id, name, description, trigger_type, trigger_config, instructions, required_tools, max_steps, notify_on_completion, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        agent_id,
        name,
        description ?? null,
        trigger_type,
        trigger_config ? JSON.stringify(trigger_config) : null,
        instructions,
        required_tools ? JSON.stringify(required_tools) : null,
        max_steps,
        notify_on_completion ? 1 : 0,
        enabled ? 1 : 0,
      );

    logger.info('Skill stored', { skill_id: result.lastInsertRowid, name });

    return createSuccess({
      skill_id: Number(result.lastInsertRowid),
      stored_at: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to store skill', { error });
    return createErrorFromException(error);
  }
}

export async function handleListSkills(args: unknown): Promise<StandardResponse<ListSkillsData>> {
  const parseResult = ListSkillsInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { agent_id, enabled, trigger_type } = parseResult.data;

  try {
    const db = getDatabase();

    let query = `SELECT * FROM skills WHERE agent_id = ?`;
    const params: (string | number)[] = [agent_id];

    if (enabled !== undefined) {
      query += ` AND enabled = ?`;
      params.push(enabled ? 1 : 0);
    }

    if (trigger_type) {
      query += ` AND trigger_type = ?`;
      params.push(trigger_type);
    }

    query += ` ORDER BY created_at DESC`;

    const skills = db.prepare(query).all(...params) as SkillRow[];

    // Get total count
    let countQuery = `SELECT COUNT(*) as count FROM skills WHERE agent_id = ?`;
    const countParams: (string | number)[] = [agent_id];
    if (enabled !== undefined) {
      countQuery += ` AND enabled = ?`;
      countParams.push(enabled ? 1 : 0);
    }
    if (trigger_type) {
      countQuery += ` AND trigger_type = ?`;
      countParams.push(trigger_type);
    }
    const countResult = db.prepare(countQuery).get(...countParams) as { count: number };

    return createSuccess({
      skills: skills.map(formatSkill),
      total_count: countResult.count,
    });
  } catch (error) {
    logger.error('Failed to list skills', { error });
    return createErrorFromException(error);
  }
}

export async function handleGetSkill(args: unknown): Promise<StandardResponse<GetSkillData>> {
  const parseResult = GetSkillInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { skill_id } = parseResult.data;

  try {
    const db = getDatabase();

    const skill = db
      .prepare(`SELECT * FROM skills WHERE id = ?`)
      .get(skill_id) as SkillRow | undefined;

    if (!skill) {
      return createError(`Skill with ID ${skill_id} not found`);
    }

    return createSuccess({
      skill: formatSkill(skill),
    });
  } catch (error) {
    logger.error('Failed to get skill', { error });
    return createErrorFromException(error);
  }
}

export async function handleUpdateSkill(args: unknown): Promise<StandardResponse<UpdateSkillData>> {
  const parseResult = UpdateSkillInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { skill_id, ...updates } = parseResult.data;

  try {
    const db = getDatabase();

    // Check skill exists
    const existing = db
      .prepare(`SELECT id FROM skills WHERE id = ?`)
      .get(skill_id) as { id: number } | undefined;

    if (!existing) {
      return createError(`Skill with ID ${skill_id} not found`);
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?');
      values.push(updates.description);
    }
    if (updates.enabled !== undefined) {
      setClauses.push('enabled = ?');
      values.push(updates.enabled ? 1 : 0);
    }
    if (updates.trigger_type !== undefined) {
      setClauses.push('trigger_type = ?');
      values.push(updates.trigger_type);
    }
    if (updates.trigger_config !== undefined) {
      setClauses.push('trigger_config = ?');
      values.push(JSON.stringify(updates.trigger_config));
    }
    if (updates.instructions !== undefined) {
      setClauses.push('instructions = ?');
      values.push(updates.instructions);
    }
    if (updates.required_tools !== undefined) {
      setClauses.push('required_tools = ?');
      values.push(JSON.stringify(updates.required_tools));
    }
    if (updates.max_steps !== undefined) {
      setClauses.push('max_steps = ?');
      values.push(updates.max_steps);
    }
    if (updates.notify_on_completion !== undefined) {
      setClauses.push('notify_on_completion = ?');
      values.push(updates.notify_on_completion ? 1 : 0);
    }
    if (updates.last_run_at !== undefined) {
      setClauses.push('last_run_at = ?');
      values.push(updates.last_run_at);
    }
    if (updates.last_run_status !== undefined) {
      setClauses.push('last_run_status = ?');
      values.push(updates.last_run_status);
    }
    if (updates.last_run_summary !== undefined) {
      setClauses.push('last_run_summary = ?');
      values.push(updates.last_run_summary);
    }

    if (setClauses.length === 0) {
      return createError('No fields to update');
    }

    // Always update the updated_at timestamp
    setClauses.push("updated_at = datetime('now')");
    values.push(skill_id);

    db.prepare(
      `UPDATE skills SET ${setClauses.join(', ')} WHERE id = ?`
    ).run(...values);

    logger.info('Skill updated', { skill_id, fields: Object.keys(updates) });

    return createSuccess({
      updated_fields: Object.keys(updates).filter(k => (updates as Record<string, unknown>)[k] !== undefined),
    });
  } catch (error) {
    logger.error('Failed to update skill', { error });
    return createErrorFromException(error);
  }
}

export async function handleDeleteSkill(args: unknown): Promise<StandardResponse<DeleteSkillData>> {
  const parseResult = DeleteSkillInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { skill_id } = parseResult.data;

  try {
    const db = getDatabase();

    const skill = db
      .prepare(`SELECT * FROM skills WHERE id = ?`)
      .get(skill_id) as SkillRow | undefined;

    if (!skill) {
      return createError(`Skill with ID ${skill_id} not found`);
    }

    db.prepare(`DELETE FROM skills WHERE id = ?`).run(skill_id);

    logger.info('Skill deleted', { skill_id, name: skill.name });

    return createSuccess({
      deleted_skill: skill.name,
    });
  } catch (error) {
    logger.error('Failed to delete skill', { error });
    return createErrorFromException(error);
  }
}
