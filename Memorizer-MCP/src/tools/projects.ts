import { z } from 'zod';
import { getDatabase, type ProjectRow, PROJECT_STATUSES, PROJECT_TYPES, PROJECT_PRIORITIES } from '../db/index.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import {
  type StandardResponse,
  createSuccess,
  createError,
  createErrorFromException,
} from '@mcp/shared/Types/StandardResponse.js';
import {
  type CreateProjectData,
  type ListProjectsData,
  type UpdateProjectData,
} from '../types/responses.js';

// ============================================================================
// Tool Definitions
// ============================================================================

export const createProjectToolDefinition = {
  name: 'create_project',
  description: 'Create a new project — something the user is working on. Projects are linked to contacts (clients) and used to organize email/calendar context. Duplicate names within the same agent are rejected.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'Which agent owns this project',
        default: 'main',
      },
      name: {
        type: 'string',
        description: 'Project name (e.g., "API Redesign")',
      },
      status: {
        type: 'string',
        description: 'Project status',
        enum: PROJECT_STATUSES,
        default: 'active',
      },
      type: {
        type: 'string',
        description: 'Project type',
        enum: PROJECT_TYPES,
        default: 'work',
      },
      description: {
        type: 'string',
        description: 'Brief description of the project',
      },
      primary_contact_id: {
        type: 'number',
        description: 'ID of the primary contact (client) for this project. Null for personal projects.',
      },
      participants: {
        type: 'array',
        items: { type: 'number' },
        description: 'Array of contact IDs for additional people involved in this project',
      },
      company: {
        type: 'string',
        description: 'Company this project belongs to',
      },
      priority: {
        type: 'string',
        description: 'Project priority',
        enum: PROJECT_PRIORITIES,
      },
    },
    required: ['name'],
  },
};

export const listProjectsToolDefinition = {
  name: 'list_projects',
  description: 'List projects with optional filtering by status, type, company, contact, or priority. Use contact_id to find all projects a specific person is involved in (as primary contact or participant).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'Agent ID to filter by',
        default: 'main',
      },
      status: {
        type: 'string',
        description: 'Filter by project status',
        enum: PROJECT_STATUSES,
      },
      type: {
        type: 'string',
        description: 'Filter by project type',
        enum: PROJECT_TYPES,
      },
      company: {
        type: 'string',
        description: 'Filter by company name',
      },
      contact_id: {
        type: 'number',
        description: 'Filter by contact ID (matches primary_contact_id or participants)',
      },
      priority: {
        type: 'string',
        description: 'Filter by priority',
        enum: PROJECT_PRIORITIES,
      },
      limit: {
        type: 'number',
        description: 'Maximum number of projects to return (default: 50)',
        default: 50,
      },
    },
  },
};

export const updateProjectToolDefinition = {
  name: 'update_project',
  description: 'Update an existing project. Any provided field will be updated; omitted fields remain unchanged.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      project_id: {
        type: 'number',
        description: 'The ID of the project to update',
      },
      name: { type: 'string', description: 'New name' },
      status: { type: 'string', enum: PROJECT_STATUSES, description: 'New status' },
      type: { type: 'string', enum: PROJECT_TYPES, description: 'New type' },
      description: { type: 'string', description: 'New description' },
      primary_contact_id: { type: 'number', description: 'New primary contact ID' },
      participants: { type: 'array', items: { type: 'number' }, description: 'New participants list' },
      company: { type: 'string', description: 'New company' },
      priority: { type: 'string', enum: PROJECT_PRIORITIES, description: 'New priority' },
    },
    required: ['project_id'],
  },
};

// ============================================================================
// Input Schemas (Zod)
// ============================================================================

export const CreateProjectInputSchema = z.object({
  agent_id: z.string().default('main'),
  name: z.string().min(1),
  status: z.enum(PROJECT_STATUSES).default('active'),
  type: z.enum(PROJECT_TYPES).default('work'),
  description: z.string().optional(),
  primary_contact_id: z.number().positive().optional(),
  participants: z.array(z.number().positive()).optional(),
  company: z.string().optional(),
  priority: z.enum(PROJECT_PRIORITIES).optional(),
});

export const ListProjectsInputSchema = z.object({
  agent_id: z.string().default('main'),
  status: z.enum(PROJECT_STATUSES).optional(),
  type: z.enum(PROJECT_TYPES).optional(),
  company: z.string().optional(),
  contact_id: z.number().positive().optional(),
  priority: z.enum(PROJECT_PRIORITIES).optional(),
  limit: z.number().positive().default(50),
});

export const UpdateProjectInputSchema = z.object({
  project_id: z.number().positive(),
  name: z.string().min(1).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  type: z.enum(PROJECT_TYPES).optional(),
  description: z.string().optional(),
  primary_contact_id: z.number().positive().nullable().optional(),
  participants: z.array(z.number().positive()).optional(),
  company: z.string().optional(),
  priority: z.enum(PROJECT_PRIORITIES).nullable().optional(),
});

// ============================================================================
// Handler Functions
// ============================================================================

export async function handleCreateProject(args: unknown): Promise<StandardResponse<CreateProjectData>> {
  const parseResult = CreateProjectInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const {
    agent_id, name, status, type, description,
    primary_contact_id, participants, company, priority,
  } = parseResult.data;

  try {
    const db = getDatabase();

    // Check for duplicate name within agent
    const existing = db
      .prepare(`SELECT id FROM projects WHERE agent_id = ? AND name = ?`)
      .get(agent_id, name) as { id: number } | undefined;

    if (existing) {
      return createError(
        `Project with name "${name}" already exists for agent "${agent_id}" (id: ${existing.id})`
      );
    }

    // Validate primary_contact_id exists if provided
    if (primary_contact_id) {
      const contact = db
        .prepare(`SELECT id FROM contacts WHERE id = ?`)
        .get(primary_contact_id) as { id: number } | undefined;

      if (!contact) {
        return createError(`Contact with ID ${primary_contact_id} not found`);
      }
    }

    const result = db
      .prepare(
        `INSERT INTO projects (agent_id, name, status, type, description, primary_contact_id, participants, company, priority)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        agent_id,
        name,
        status,
        type,
        description ?? null,
        primary_contact_id ?? null,
        participants ? JSON.stringify(participants) : null,
        company ?? null,
        priority ?? null,
      );

    logger.info('Project created', { project_id: result.lastInsertRowid, name });

    return createSuccess({
      project_id: Number(result.lastInsertRowid),
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to create project', { error });
    return createErrorFromException(error);
  }
}

export async function handleListProjects(args: unknown): Promise<StandardResponse<ListProjectsData>> {
  const parseResult = ListProjectsInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { agent_id, status, type, company, contact_id, priority, limit } = parseResult.data;

  try {
    const db = getDatabase();

    let query = `SELECT * FROM projects WHERE agent_id = ?`;
    const params: (string | number)[] = [agent_id];

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    if (type) {
      query += ` AND type = ?`;
      params.push(type);
    }

    if (company) {
      query += ` AND company = ?`;
      params.push(company);
    }

    if (contact_id) {
      // Match either primary contact or participant in JSON array
      query += ` AND (primary_contact_id = ? OR participants LIKE ?)`;
      params.push(contact_id);
      params.push(`%${contact_id}%`);
    }

    if (priority) {
      query += ` AND priority = ?`;
      params.push(priority);
    }

    query += ` ORDER BY name ASC LIMIT ?`;
    params.push(limit);

    const projects = db.prepare(query).all(...params) as ProjectRow[];

    // Count with same filters
    let countQuery = `SELECT COUNT(*) as count FROM projects WHERE agent_id = ?`;
    const countParams: (string | number)[] = [agent_id];
    if (status) { countQuery += ` AND status = ?`; countParams.push(status); }
    if (type) { countQuery += ` AND type = ?`; countParams.push(type); }
    if (company) { countQuery += ` AND company = ?`; countParams.push(company); }
    if (contact_id) {
      countQuery += ` AND (primary_contact_id = ? OR participants LIKE ?)`;
      countParams.push(contact_id);
      countParams.push(`%${contact_id}%`);
    }
    if (priority) { countQuery += ` AND priority = ?`; countParams.push(priority); }

    const countResult = db.prepare(countQuery).get(...countParams) as { count: number };

    return createSuccess({
      projects: projects.map(row => ({
        id: row.id,
        name: row.name,
        status: row.status,
        type: row.type,
        description: row.description,
        primary_contact_id: row.primary_contact_id,
        participants: row.participants ? JSON.parse(row.participants) : null,
        company: row.company,
        priority: row.priority,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })),
      total_count: countResult.count,
    });
  } catch (error) {
    logger.error('Failed to list projects', { error });
    return createErrorFromException(error);
  }
}

export async function handleUpdateProject(args: unknown): Promise<StandardResponse<UpdateProjectData>> {
  const parseResult = UpdateProjectInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { project_id, ...updates } = parseResult.data;

  try {
    const db = getDatabase();

    // Check project exists
    const existing = db
      .prepare(`SELECT id FROM projects WHERE id = ?`)
      .get(project_id) as { id: number } | undefined;

    if (!existing) {
      return createError(`Project with ID ${project_id} not found`);
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) { setClauses.push('name = ?'); values.push(updates.name); }
    if (updates.status !== undefined) { setClauses.push('status = ?'); values.push(updates.status); }
    if (updates.type !== undefined) { setClauses.push('type = ?'); values.push(updates.type); }
    if (updates.description !== undefined) { setClauses.push('description = ?'); values.push(updates.description); }
    if (updates.primary_contact_id !== undefined) { setClauses.push('primary_contact_id = ?'); values.push(updates.primary_contact_id); }
    if (updates.participants !== undefined) { setClauses.push('participants = ?'); values.push(JSON.stringify(updates.participants)); }
    if (updates.company !== undefined) { setClauses.push('company = ?'); values.push(updates.company); }
    if (updates.priority !== undefined) { setClauses.push('priority = ?'); values.push(updates.priority); }

    if (setClauses.length === 0) {
      return createError('No fields to update');
    }

    setClauses.push("updated_at = datetime('now')");
    values.push(project_id);

    db.prepare(
      `UPDATE projects SET ${setClauses.join(', ')} WHERE id = ?`
    ).run(...values);

    logger.info('Project updated', { project_id, fields: Object.keys(updates) });

    return createSuccess({
      updated_fields: Object.keys(updates).filter(k => (updates as Record<string, unknown>)[k] !== undefined),
    });
  } catch (error) {
    logger.error('Failed to update project', { error });
    return createErrorFromException(error);
  }
}
