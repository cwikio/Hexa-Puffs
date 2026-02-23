import { z } from 'zod';
import { getDatabase, type ProjectSourceRow, SOURCE_TYPES, SOURCE_STATUSES } from '../db/index.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import {
  type StandardResponse,
  createSuccess,
  createError,
  createErrorFromException,
} from '@mcp/shared/Types/StandardResponse.js';
import {
  type LinkProjectSourceData,
  type UnlinkProjectSourceData,
  type ListProjectSourcesData,
  type UpdateProjectSourceStatusData,
} from '../types/responses.js';

// ============================================================================
// Tool Definitions
// ============================================================================

export const linkProjectSourceToolDefinition = {
  name: 'link_project_source',
  description: 'Link a unified project to an external MCP source. Creates a mapping between a project in the Memorizer and its representation in an external service (e.g., Vercel, PostHog, GitHub). If the link already exists for the same (project_id, mcp_name), it updates the external details.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      project_id: {
        type: 'number',
        description: 'ID of the unified project to link',
      },
      mcp_name: {
        type: 'string',
        description: 'Name of the external MCP (e.g., "vercel", "posthog", "neon")',
      },
      external_project_id: {
        type: 'string',
        description: 'The project ID as known by the external service',
      },
      external_project_name: {
        type: 'string',
        description: 'The project name as it appears in the external service',
      },
      source_type: {
        type: 'string',
        description: 'How this link was created',
        enum: SOURCE_TYPES,
        default: 'manual',
      },
    },
    required: ['project_id', 'mcp_name'],
  },
};

export const unlinkProjectSourceToolDefinition = {
  name: 'unlink_project_source',
  description: 'Remove the link between a unified project and an external MCP source.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      project_id: {
        type: 'number',
        description: 'ID of the unified project',
      },
      mcp_name: {
        type: 'string',
        description: 'Name of the external MCP to unlink',
      },
    },
    required: ['project_id', 'mcp_name'],
  },
};

export const listProjectSourcesToolDefinition = {
  name: 'list_project_sources',
  description: 'List linked sources for projects. Filter by project_id to see all MCPs linked to a project, or by mcp_name to see all projects linked to an MCP. Returns sources with their parent project names.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      project_id: {
        type: 'number',
        description: 'Filter by unified project ID',
      },
      mcp_name: {
        type: 'string',
        description: 'Filter by MCP name',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (default: 50)',
        default: 50,
      },
    },
  },
};

export const updateProjectSourceStatusToolDefinition = {
  name: 'update_project_source_status',
  description: 'Update the health status of a project source after checking the external MCP. Used by status check skills.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      project_source_id: {
        type: 'number',
        description: 'ID of the project source to update',
      },
      last_status: {
        type: 'string',
        description: 'Current health status',
        enum: SOURCE_STATUSES,
      },
      last_checked_at: {
        type: 'string',
        description: 'ISO datetime of when the check was performed (defaults to now)',
      },
    },
    required: ['project_source_id', 'last_status'],
  },
};

// ============================================================================
// Input Schemas (Zod)
// ============================================================================

export const LinkProjectSourceInputSchema = z.object({
  project_id: z.number().positive(),
  mcp_name: z.string().min(1),
  external_project_id: z.string().optional(),
  external_project_name: z.string().optional(),
  source_type: z.enum(SOURCE_TYPES).default('manual'),
});

export const UnlinkProjectSourceInputSchema = z.object({
  project_id: z.number().positive(),
  mcp_name: z.string().min(1),
});

export const ListProjectSourcesInputSchema = z.object({
  project_id: z.number().positive().optional(),
  mcp_name: z.string().optional(),
  limit: z.number().positive().default(50),
});

export const UpdateProjectSourceStatusInputSchema = z.object({
  project_source_id: z.number().positive(),
  last_status: z.enum(SOURCE_STATUSES),
  last_checked_at: z.string().optional(),
});

// ============================================================================
// Handler Functions
// ============================================================================

export async function handleLinkProjectSource(args: unknown): Promise<StandardResponse<LinkProjectSourceData>> {
  const parseResult = LinkProjectSourceInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { project_id, mcp_name, external_project_id, external_project_name, source_type } = parseResult.data;

  try {
    const db = getDatabase();

    // Validate project exists
    const project = db
      .prepare(`SELECT id, name FROM projects WHERE id = ?`)
      .get(project_id) as { id: number; name: string } | undefined;

    if (!project) {
      return createError(`Project with ID ${project_id} not found`);
    }

    // Check for existing link
    const existing = db
      .prepare(`SELECT id FROM project_sources WHERE project_id = ? AND mcp_name = ?`)
      .get(project_id, mcp_name) as { id: number } | undefined;

    if (existing) {
      // Update existing link
      db.prepare(
        `UPDATE project_sources SET external_project_id = ?, external_project_name = ?, source_type = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(
        external_project_id ?? null,
        external_project_name ?? null,
        source_type,
        existing.id,
      );

      logger.info('Project source link updated', { project_source_id: existing.id, project_id, mcp_name });

      return createSuccess({
        project_source_id: existing.id,
        linked_at: new Date().toISOString(),
        already_existed: true,
      });
    }

    const result = db
      .prepare(
        `INSERT INTO project_sources (project_id, mcp_name, external_project_id, external_project_name, source_type)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        project_id,
        mcp_name,
        external_project_id ?? null,
        external_project_name ?? null,
        source_type,
      );

    logger.info('Project source linked', { project_source_id: result.lastInsertRowid, project_id, mcp_name });

    return createSuccess({
      project_source_id: Number(result.lastInsertRowid),
      linked_at: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to link project source', { error });
    return createErrorFromException(error);
  }
}

export async function handleUnlinkProjectSource(args: unknown): Promise<StandardResponse<UnlinkProjectSourceData>> {
  const parseResult = UnlinkProjectSourceInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { project_id, mcp_name } = parseResult.data;

  try {
    const db = getDatabase();

    // Find the link
    const existing = db
      .prepare(
        `SELECT ps.id, p.name as project_name
         FROM project_sources ps
         JOIN projects p ON ps.project_id = p.id
         WHERE ps.project_id = ? AND ps.mcp_name = ?`
      )
      .get(project_id, mcp_name) as { id: number; project_name: string } | undefined;

    if (!existing) {
      return createError(`No link found between project ${project_id} and MCP "${mcp_name}"`);
    }

    db.prepare(`DELETE FROM project_sources WHERE id = ?`).run(existing.id);

    logger.info('Project source unlinked', { project_id, mcp_name });

    return createSuccess({
      unlinked_project: existing.project_name,
      unlinked_mcp: mcp_name,
    });
  } catch (error) {
    logger.error('Failed to unlink project source', { error });
    return createErrorFromException(error);
  }
}

export async function handleListProjectSources(args: unknown): Promise<StandardResponse<ListProjectSourcesData>> {
  const parseResult = ListProjectSourcesInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { project_id, mcp_name, limit } = parseResult.data;

  try {
    const db = getDatabase();

    let query = `
      SELECT ps.*, p.name as project_name
      FROM project_sources ps
      JOIN projects p ON ps.project_id = p.id
      WHERE 1=1`;
    const params: (string | number)[] = [];

    if (project_id) {
      query += ` AND ps.project_id = ?`;
      params.push(project_id);
    }

    if (mcp_name) {
      query += ` AND ps.mcp_name = ?`;
      params.push(mcp_name);
    }

    query += ` ORDER BY p.name ASC, ps.mcp_name ASC LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(query).all(...params) as (ProjectSourceRow & { project_name: string })[];

    // Count with same filters
    let countQuery = `SELECT COUNT(*) as count FROM project_sources ps WHERE 1=1`;
    const countParams: (string | number)[] = [];
    if (project_id) { countQuery += ` AND ps.project_id = ?`; countParams.push(project_id); }
    if (mcp_name) { countQuery += ` AND ps.mcp_name = ?`; countParams.push(mcp_name); }
    const countResult = db.prepare(countQuery).get(...countParams) as { count: number };

    return createSuccess({
      sources: rows.map(row => ({
        id: row.id,
        project_id: row.project_id,
        project_name: row.project_name,
        mcp_name: row.mcp_name,
        external_project_id: row.external_project_id,
        external_project_name: row.external_project_name,
        source_type: row.source_type,
        last_status: row.last_status,
        last_checked_at: row.last_checked_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })),
      total_count: countResult.count,
    });
  } catch (error) {
    logger.error('Failed to list project sources', { error });
    return createErrorFromException(error);
  }
}

export async function handleUpdateProjectSourceStatus(args: unknown): Promise<StandardResponse<UpdateProjectSourceStatusData>> {
  const parseResult = UpdateProjectSourceStatusInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { project_source_id, last_status, last_checked_at } = parseResult.data;

  try {
    const db = getDatabase();

    const existing = db
      .prepare(`SELECT id FROM project_sources WHERE id = ?`)
      .get(project_source_id) as { id: number } | undefined;

    if (!existing) {
      return createError(`Project source with ID ${project_source_id} not found`);
    }

    const checkedAt = last_checked_at ?? new Date().toISOString();

    db.prepare(
      `UPDATE project_sources SET last_status = ?, last_checked_at = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(last_status, checkedAt, project_source_id);

    logger.info('Project source status updated', { project_source_id, last_status });

    return createSuccess({
      updated_fields: ['last_status', 'last_checked_at'],
    });
  } catch (error) {
    logger.error('Failed to update project source status', { error });
    return createErrorFromException(error);
  }
}
