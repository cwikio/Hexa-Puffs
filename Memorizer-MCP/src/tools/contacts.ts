import { z } from 'zod';
import { getDatabase, type ContactRow, CONTACT_TYPES } from '../db/index.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import {
  type StandardResponse,
  createSuccess,
  createError,
  createErrorFromException,
} from '@mcp/shared/Types/StandardResponse.js';
import {
  type CreateContactData,
  type ListContactsData,
  type UpdateContactData,
} from '../types/responses.js';

// ============================================================================
// Tool Definitions
// ============================================================================

export const createContactToolDefinition = {
  name: 'create_contact',
  description: 'Create a new contact — a person the user works with or knows. Contacts are linked to projects and used to enrich email/calendar context. Duplicate emails within the same agent are rejected.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'Which agent owns this contact',
        default: 'main',
      },
      name: {
        type: 'string',
        description: 'Full name of the contact',
      },
      email: {
        type: 'string',
        description: 'Email address of the contact',
      },
      company: {
        type: 'string',
        description: 'Company or organization the contact belongs to',
      },
      role: {
        type: 'string',
        description: 'Role or job title (e.g., "Product Manager")',
      },
      type: {
        type: 'string',
        description: 'Contact type',
        enum: CONTACT_TYPES,
        default: 'work',
      },
      notes: {
        type: 'string',
        description: 'Free-form notes about this contact (preferences, patterns, etc.)',
      },
    },
    required: ['name', 'email'],
  },
};

export const listContactsToolDefinition = {
  name: 'list_contacts',
  description: 'List contacts with optional filtering by email, company, type, or name. Use this to look up people by email address (e.g., when processing incoming emails) or to find all contacts at a company.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'Agent ID to filter by',
        default: 'main',
      },
      email: {
        type: 'string',
        description: 'Filter by exact email address',
      },
      company: {
        type: 'string',
        description: 'Filter by company name',
      },
      type: {
        type: 'string',
        description: 'Filter by contact type',
        enum: CONTACT_TYPES,
      },
      name: {
        type: 'string',
        description: 'Filter by name (partial match, case-insensitive)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of contacts to return (default: 50)',
        default: 50,
      },
    },
  },
};

export const updateContactToolDefinition = {
  name: 'update_contact',
  description: 'Update an existing contact. Any provided field will be updated; omitted fields remain unchanged.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      contact_id: {
        type: 'number',
        description: 'The ID of the contact to update',
      },
      name: { type: 'string', description: 'New name' },
      email: { type: 'string', description: 'New email' },
      company: { type: 'string', description: 'New company' },
      role: { type: 'string', description: 'New role' },
      type: { type: 'string', enum: CONTACT_TYPES, description: 'New type' },
      notes: { type: 'string', description: 'New notes' },
    },
    required: ['contact_id'],
  },
};

// ============================================================================
// Input Schemas (Zod)
// ============================================================================

export const CreateContactInputSchema = z.object({
  agent_id: z.string().default('main'),
  name: z.string().min(1),
  email: z.string().min(1),
  company: z.string().optional(),
  role: z.string().optional(),
  type: z.enum(CONTACT_TYPES).default('work'),
  notes: z.string().optional(),
});

export const ListContactsInputSchema = z.object({
  agent_id: z.string().default('main'),
  email: z.string().optional(),
  company: z.string().optional(),
  type: z.enum(CONTACT_TYPES).optional(),
  name: z.string().optional(),
  limit: z.number().positive().default(50),
});

export const UpdateContactInputSchema = z.object({
  contact_id: z.number().positive(),
  name: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
  company: z.string().optional(),
  role: z.string().optional(),
  type: z.enum(CONTACT_TYPES).optional(),
  notes: z.string().optional(),
});

// ============================================================================
// Handler Functions
// ============================================================================

export async function handleCreateContact(args: unknown): Promise<StandardResponse<CreateContactData>> {
  const parseResult = CreateContactInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { agent_id, name, email, company, role, type, notes } = parseResult.data;

  try {
    const db = getDatabase();

    // Check for duplicate email within agent
    const existing = db
      .prepare(`SELECT id, name FROM contacts WHERE agent_id = ? AND email = ?`)
      .get(agent_id, email) as { id: number; name: string } | undefined;

    if (existing) {
      return createError(
        `Contact with email "${email}" already exists for agent "${agent_id}" (id: ${existing.id}, name: "${existing.name}")`
      );
    }

    const result = db
      .prepare(
        `INSERT INTO contacts (agent_id, name, email, company, role, type, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(agent_id, name, email, company ?? null, role ?? null, type, notes ?? null);

    logger.info('Contact created', { contact_id: result.lastInsertRowid, name, email });

    return createSuccess({
      contact_id: Number(result.lastInsertRowid),
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to create contact', { error });
    return createErrorFromException(error);
  }
}

export async function handleListContacts(args: unknown): Promise<StandardResponse<ListContactsData>> {
  const parseResult = ListContactsInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { agent_id, email, company, type, name, limit } = parseResult.data;

  try {
    const db = getDatabase();

    let query = `SELECT * FROM contacts WHERE agent_id = ?`;
    const params: (string | number)[] = [agent_id];

    if (email) {
      query += ` AND email = ?`;
      params.push(email);
    }

    if (company) {
      query += ` AND company = ?`;
      params.push(company);
    }

    if (type) {
      query += ` AND type = ?`;
      params.push(type);
    }

    if (name) {
      query += ` AND name LIKE ?`;
      params.push(`%${name}%`);
    }

    query += ` ORDER BY name ASC LIMIT ?`;
    params.push(limit);

    const contacts = db.prepare(query).all(...params) as ContactRow[];

    // Count with same filters
    let countQuery = `SELECT COUNT(*) as count FROM contacts WHERE agent_id = ?`;
    const countParams: (string | number)[] = [agent_id];
    if (email) { countQuery += ` AND email = ?`; countParams.push(email); }
    if (company) { countQuery += ` AND company = ?`; countParams.push(company); }
    if (type) { countQuery += ` AND type = ?`; countParams.push(type); }
    if (name) { countQuery += ` AND name LIKE ?`; countParams.push(`%${name}%`); }

    const countResult = db.prepare(countQuery).get(...countParams) as { count: number };

    return createSuccess({
      contacts: contacts.map(row => ({
        id: row.id,
        name: row.name,
        email: row.email,
        company: row.company,
        role: row.role,
        type: row.type,
        notes: row.notes,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })),
      total_count: countResult.count,
    });
  } catch (error) {
    logger.error('Failed to list contacts', { error });
    return createErrorFromException(error);
  }
}

export async function handleUpdateContact(args: unknown): Promise<StandardResponse<UpdateContactData>> {
  const parseResult = UpdateContactInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { contact_id, ...updates } = parseResult.data;

  try {
    const db = getDatabase();

    // Check contact exists
    const existing = db
      .prepare(`SELECT id FROM contacts WHERE id = ?`)
      .get(contact_id) as { id: number } | undefined;

    if (!existing) {
      return createError(`Contact with ID ${contact_id} not found`);
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) { setClauses.push('name = ?'); values.push(updates.name); }
    if (updates.email !== undefined) { setClauses.push('email = ?'); values.push(updates.email); }
    if (updates.company !== undefined) { setClauses.push('company = ?'); values.push(updates.company); }
    if (updates.role !== undefined) { setClauses.push('role = ?'); values.push(updates.role); }
    if (updates.type !== undefined) { setClauses.push('type = ?'); values.push(updates.type); }
    if (updates.notes !== undefined) { setClauses.push('notes = ?'); values.push(updates.notes); }

    if (setClauses.length === 0) {
      return createError('No fields to update');
    }

    setClauses.push("updated_at = datetime('now')");
    values.push(contact_id);

    db.prepare(
      `UPDATE contacts SET ${setClauses.join(', ')} WHERE id = ?`
    ).run(...values);

    logger.info('Contact updated', { contact_id, fields: Object.keys(updates) });

    return createSuccess({
      updated_fields: Object.keys(updates).filter(k => (updates as Record<string, unknown>)[k] !== undefined),
    });
  } catch (error) {
    logger.error('Failed to update contact', { error });
    return createErrorFromException(error);
  }
}
