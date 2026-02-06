import { z } from 'zod';
import {
  getDatabase,
  type FactRow,
  type ConversationRow,
  type ProfileHistoryRow,
  type SkillRow,
  type ContactRow,
  type ProjectRow,
} from '../db/index.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import {
  type StandardResponse,
  createSuccess,
  createError,
  createErrorFromException,
} from '@mcp/shared/Types/StandardResponse.js';
import {
  type TimelineEvent,
  type TimelineSource,
  type QueryTimelineData,
} from '../types/responses.js';

const TIMELINE_SOURCES = [
  'facts',
  'conversations',
  'profile_changes',
  'skills',
  'contacts',
  'projects',
] as const;

// Tool definition
export const queryTimelineToolDefinition = {
  name: 'query_timeline',
  description:
    'Query what happened across a time range. Searches facts, conversations, profile changes, skill executions, contacts, and projects within the given dates. Use when the user asks "what happened last week", "what was I working on Tuesday", "show me everything since January", or "when did I last talk about X". The calling LLM should resolve natural-language dates into date_from/date_to before calling this tool.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'Agent ID to filter by',
        default: 'main',
      },
      date_from: {
        type: 'string',
        description: 'Start date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS)',
      },
      date_to: {
        type: 'string',
        description:
          'End date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS). Defaults to now.',
      },
      categories: {
        type: 'array',
        items: {
          type: 'string',
          enum: TIMELINE_SOURCES,
        },
        description:
          'Filter to specific event types. Omit to search all categories.',
      },
      query: {
        type: 'string',
        description: 'Optional keyword to filter results across all sources',
      },
      limit: {
        type: 'number',
        description: 'Maximum total results to return',
        default: 50,
      },
    },
    required: ['date_from'],
  },
};

// Zod input schema
export const QueryTimelineInputSchema = z.object({
  agent_id: z.string().default('main'),
  date_from: z.string().min(1),
  date_to: z.string().optional(),
  categories: z
    .array(z.enum(TIMELINE_SOURCES))
    .optional(),
  query: z.string().optional(),
  limit: z.number().positive().default(50),
});

/**
 * Normalize a date string to include time component for consistent SQL BETWEEN.
 * "2026-02-10" → "2026-02-10 00:00:00" (for from) or "2026-02-10 23:59:59" (for to)
 */
function normalizeDateFrom(date: string): string {
  if (date.length === 10) return `${date} 00:00:00`;
  return date;
}

function normalizeDateTo(date: string): string {
  if (date.length === 10) return `${date} 23:59:59`;
  return date;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

function shouldQuery(
  categories: TimelineSource[] | undefined,
  source: TimelineSource,
): boolean {
  return !categories || categories.includes(source);
}

function buildLikeClause(
  column: string,
  query: string | undefined,
  params: (string | number)[],
): string {
  if (!query) return '';
  params.push(`%${query}%`);
  return ` AND ${column} LIKE ?`;
}

// --- Per-source query functions ---

function queryFacts(
  agentId: string,
  dateFrom: string,
  dateTo: string,
  query: string | undefined,
): TimelineEvent[] {
  const db = getDatabase();
  const events: TimelineEvent[] = [];

  const params: (string | number)[] = [agentId, dateFrom, dateTo];
  const likeSql = buildLikeClause('fact', query, params);

  // Facts created in range
  const createdRows = db
    .prepare(
      `SELECT id, fact, category, confidence, source, created_at, updated_at
       FROM facts
       WHERE agent_id = ? AND created_at BETWEEN ? AND ?${likeSql}
       ORDER BY created_at DESC`,
    )
    .all(...params) as FactRow[];

  for (const row of createdRows) {
    events.push({
      timestamp: row.created_at,
      source: 'facts',
      event_type: 'created',
      summary: `Learned: "${truncate(row.fact, 120)}" (${row.category})`,
      details: {
        fact_id: row.id,
        fact: row.fact,
        category: row.category,
        confidence: row.confidence,
        source_conversation: row.source,
      },
    });
  }

  // Facts updated in range (where updated_at differs from created_at)
  const updParams: (string | number)[] = [agentId, dateFrom, dateTo];
  const updLikeSql = buildLikeClause('fact', query, updParams);

  const updatedRows = db
    .prepare(
      `SELECT id, fact, category, confidence, created_at, updated_at
       FROM facts
       WHERE agent_id = ? AND updated_at BETWEEN ? AND ?
         AND updated_at != created_at${updLikeSql}
       ORDER BY updated_at DESC`,
    )
    .all(...updParams) as FactRow[];

  for (const row of updatedRows) {
    events.push({
      timestamp: row.updated_at,
      source: 'facts',
      event_type: 'updated',
      summary: `Updated fact: "${truncate(row.fact, 120)}" (${row.category})`,
      details: {
        fact_id: row.id,
        fact: row.fact,
        category: row.category,
      },
    });
  }

  return events;
}

function queryConversations(
  agentId: string,
  dateFrom: string,
  dateTo: string,
  query: string | undefined,
): TimelineEvent[] {
  const db = getDatabase();
  const params: (string | number)[] = [agentId, dateFrom, dateTo];

  let likeSql = '';
  if (query) {
    likeSql = ' AND (user_message LIKE ? OR agent_response LIKE ?)';
    params.push(`%${query}%`, `%${query}%`);
  }

  const rows = db
    .prepare(
      `SELECT id, session_id, user_message, agent_response, tags, created_at
       FROM conversations
       WHERE agent_id = ? AND created_at BETWEEN ? AND ?${likeSql}
       ORDER BY created_at DESC`,
    )
    .all(...params) as ConversationRow[];

  return rows.map((row) => ({
    timestamp: row.created_at,
    source: 'conversations' as const,
    event_type: 'created' as const,
    summary: `Conversation: "${truncate(row.user_message, 150)}"`,
    details: {
      conversation_id: row.id,
      session_id: row.session_id,
      user_message_preview: truncate(row.user_message, 300),
      response_preview: truncate(row.agent_response, 300),
      tags: row.tags ? JSON.parse(row.tags) : null,
    },
  }));
}

function queryProfileChanges(
  agentId: string,
  dateFrom: string,
  dateTo: string,
  query: string | undefined,
): TimelineEvent[] {
  const db = getDatabase();
  const params: (string | number)[] = [agentId, dateFrom, dateTo];
  const likeSql = buildLikeClause('change_reason', query, params);

  const rows = db
    .prepare(
      `SELECT id, agent_id, changed_at, change_reason
       FROM profile_history
       WHERE agent_id = ? AND changed_at BETWEEN ? AND ?${likeSql}
       ORDER BY changed_at DESC`,
    )
    .all(...params) as ProfileHistoryRow[];

  return rows.map((row) => ({
    timestamp: row.changed_at,
    source: 'profile_changes' as const,
    event_type: 'changed' as const,
    summary: `Profile updated: ${row.change_reason || 'no reason given'}`,
    details: {
      history_id: row.id,
      change_reason: row.change_reason,
    },
  }));
}

function querySkills(
  agentId: string,
  dateFrom: string,
  dateTo: string,
  query: string | undefined,
): TimelineEvent[] {
  const db = getDatabase();
  const events: TimelineEvent[] = [];

  // Skills created in range
  const createParams: (string | number)[] = [agentId, dateFrom, dateTo];
  const createLikeSql = buildLikeClause('name', query, createParams);

  const createdRows = db
    .prepare(
      `SELECT id, name, description, trigger_type, last_run_at, last_run_status, last_run_summary, created_at, updated_at
       FROM skills
       WHERE agent_id = ? AND created_at BETWEEN ? AND ?${createLikeSql}
       ORDER BY created_at DESC`,
    )
    .all(...createParams) as SkillRow[];

  for (const row of createdRows) {
    events.push({
      timestamp: row.created_at,
      source: 'skills',
      event_type: 'created',
      summary: `Skill "${row.name}" created (${row.trigger_type})`,
      details: {
        skill_id: row.id,
        name: row.name,
        description: row.description,
        trigger_type: row.trigger_type,
      },
    });
  }

  // Skills executed in range (last_run_at)
  const runParams: (string | number)[] = [agentId, dateFrom, dateTo];
  const runLikeSql = buildLikeClause('name', query, runParams);

  const executedRows = db
    .prepare(
      `SELECT id, name, last_run_at, last_run_status, last_run_summary
       FROM skills
       WHERE agent_id = ? AND last_run_at BETWEEN ? AND ?${runLikeSql}
       ORDER BY last_run_at DESC`,
    )
    .all(...runParams) as SkillRow[];

  for (const row of executedRows) {
    if (row.last_run_at) {
      events.push({
        timestamp: row.last_run_at,
        source: 'skills',
        event_type: 'executed',
        summary: `Skill "${row.name}" ran: ${row.last_run_status || 'unknown'}`,
        details: {
          skill_id: row.id,
          name: row.name,
          status: row.last_run_status,
          summary: row.last_run_summary,
        },
      });
    }
  }

  return events;
}

function queryContacts(
  agentId: string,
  dateFrom: string,
  dateTo: string,
  query: string | undefined,
): TimelineEvent[] {
  const db = getDatabase();
  const events: TimelineEvent[] = [];

  // Contacts created in range
  const createParams: (string | number)[] = [agentId, dateFrom, dateTo];
  let createLikeSql = '';
  if (query) {
    createLikeSql = ' AND (name LIKE ? OR email LIKE ? OR company LIKE ?)';
    createParams.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }

  const createdRows = db
    .prepare(
      `SELECT id, name, email, company, role, type, created_at, updated_at
       FROM contacts
       WHERE agent_id = ? AND created_at BETWEEN ? AND ?${createLikeSql}
       ORDER BY created_at DESC`,
    )
    .all(...createParams) as ContactRow[];

  for (const row of createdRows) {
    events.push({
      timestamp: row.created_at,
      source: 'contacts',
      event_type: 'created',
      summary: `New contact: ${row.name} (${row.email})`,
      details: {
        contact_id: row.id,
        name: row.name,
        email: row.email,
        company: row.company,
        role: row.role,
        type: row.type,
      },
    });
  }

  // Contacts updated in range
  const updParams: (string | number)[] = [agentId, dateFrom, dateTo];
  let updLikeSql = '';
  if (query) {
    updLikeSql = ' AND (name LIKE ? OR email LIKE ? OR company LIKE ?)';
    updParams.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }

  const updatedRows = db
    .prepare(
      `SELECT id, name, email, company, role, type, created_at, updated_at
       FROM contacts
       WHERE agent_id = ? AND updated_at BETWEEN ? AND ?
         AND updated_at != created_at${updLikeSql}
       ORDER BY updated_at DESC`,
    )
    .all(...updParams) as ContactRow[];

  for (const row of updatedRows) {
    events.push({
      timestamp: row.updated_at,
      source: 'contacts',
      event_type: 'updated',
      summary: `Contact updated: ${row.name} (${row.email})`,
      details: {
        contact_id: row.id,
        name: row.name,
        email: row.email,
        company: row.company,
      },
    });
  }

  return events;
}

function queryProjects(
  agentId: string,
  dateFrom: string,
  dateTo: string,
  query: string | undefined,
): TimelineEvent[] {
  const db = getDatabase();
  const events: TimelineEvent[] = [];

  // Projects created in range
  const createParams: (string | number)[] = [agentId, dateFrom, dateTo];
  let createLikeSql = '';
  if (query) {
    createLikeSql = ' AND (name LIKE ? OR description LIKE ? OR company LIKE ?)';
    createParams.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }

  const createdRows = db
    .prepare(
      `SELECT id, name, status, type, description, company, priority, created_at, updated_at
       FROM projects
       WHERE agent_id = ? AND created_at BETWEEN ? AND ?${createLikeSql}
       ORDER BY created_at DESC`,
    )
    .all(...createParams) as ProjectRow[];

  for (const row of createdRows) {
    events.push({
      timestamp: row.created_at,
      source: 'projects',
      event_type: 'created',
      summary: `Project "${row.name}" created (${row.status})`,
      details: {
        project_id: row.id,
        name: row.name,
        status: row.status,
        type: row.type,
        description: row.description,
        company: row.company,
        priority: row.priority,
      },
    });
  }

  // Projects updated in range
  const updParams: (string | number)[] = [agentId, dateFrom, dateTo];
  let updLikeSql = '';
  if (query) {
    updLikeSql = ' AND (name LIKE ? OR description LIKE ? OR company LIKE ?)';
    updParams.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }

  const updatedRows = db
    .prepare(
      `SELECT id, name, status, type, description, company, priority, created_at, updated_at
       FROM projects
       WHERE agent_id = ? AND updated_at BETWEEN ? AND ?
         AND updated_at != created_at${updLikeSql}
       ORDER BY updated_at DESC`,
    )
    .all(...updParams) as ProjectRow[];

  for (const row of updatedRows) {
    events.push({
      timestamp: row.updated_at,
      source: 'projects',
      event_type: 'updated',
      summary: `Project "${row.name}" updated (${row.status})`,
      details: {
        project_id: row.id,
        name: row.name,
        status: row.status,
      },
    });
  }

  return events;
}

// --- Main handler ---

export async function handleQueryTimeline(
  args: unknown,
): Promise<StandardResponse<QueryTimelineData>> {
  const parseResult = QueryTimelineInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { agent_id, date_from, date_to, categories, query, limit } =
    parseResult.data;

  try {
    const normalizedFrom = normalizeDateFrom(date_from);
    const normalizedTo = date_to
      ? normalizeDateTo(date_to)
      : normalizeDateTo(new Date().toISOString().slice(0, 10));

    const allEvents: TimelineEvent[] = [];
    const sourcesQueried: TimelineSource[] = [];

    if (shouldQuery(categories, 'facts')) {
      sourcesQueried.push('facts');
      allEvents.push(...queryFacts(agent_id, normalizedFrom, normalizedTo, query));
    }

    if (shouldQuery(categories, 'conversations')) {
      sourcesQueried.push('conversations');
      allEvents.push(
        ...queryConversations(agent_id, normalizedFrom, normalizedTo, query),
      );
    }

    if (shouldQuery(categories, 'profile_changes')) {
      sourcesQueried.push('profile_changes');
      allEvents.push(
        ...queryProfileChanges(agent_id, normalizedFrom, normalizedTo, query),
      );
    }

    if (shouldQuery(categories, 'skills')) {
      sourcesQueried.push('skills');
      allEvents.push(
        ...querySkills(agent_id, normalizedFrom, normalizedTo, query),
      );
    }

    if (shouldQuery(categories, 'contacts')) {
      sourcesQueried.push('contacts');
      allEvents.push(
        ...queryContacts(agent_id, normalizedFrom, normalizedTo, query),
      );
    }

    if (shouldQuery(categories, 'projects')) {
      sourcesQueried.push('projects');
      allEvents.push(
        ...queryProjects(agent_id, normalizedFrom, normalizedTo, query),
      );
    }

    // Sort by timestamp descending, then apply limit
    allEvents.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const totalCount = allEvents.length;
    const limitedEvents = allEvents.slice(0, limit);

    logger.info('Timeline query completed', {
      date_from: normalizedFrom,
      date_to: normalizedTo,
      sources: sourcesQueried,
      total_events: totalCount,
      returned: limitedEvents.length,
    });

    return createSuccess({
      events: limitedEvents,
      total_count: totalCount,
      date_range: { from: normalizedFrom, to: normalizedTo },
      sources_queried: sourcesQueried,
    });
  } catch (error) {
    logger.error('Failed to query timeline', { error });
    return createErrorFromException(error);
  }
}
