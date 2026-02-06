import { z } from 'zod';
import { getDatabase, type ProfileRow } from '../db/index.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import {
  type StandardResponse,
  createSuccess,
  createError,
  createErrorFromException,
} from '@mcp/shared/Types/StandardResponse.js';
import {
  type GetProfileData,
  type UpdateProfileData,
} from '../types/responses.js';

// Tool definitions
export const getProfileToolDefinition = {
  name: 'get_profile',
  description: "Get the user's profile including name, background, preferences, current projects, and learned patterns. Use this to personalize responses or check what structured information is stored about the user.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'The agent ID',
        default: 'main',
      },
    },
  },
};

export const updateProfileToolDefinition = {
  name: 'update_profile',
  description: 'Update user profile fields. Supports dot notation for nested fields (e.g., "user_info.name", "preferences.communication"). Use this for structured, long-lived user attributes. For individual facts or learnings, use store_fact instead.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'The agent ID',
        default: 'main',
      },
      updates: {
        type: 'object',
        description: 'Fields to update (dot notation supported)',
      },
      reason: {
        type: 'string',
        description: 'Reason for the update (for history)',
      },
    },
    required: ['updates'],
  },
};

// Input schemas for validation
export const GetProfileInputSchema = z.object({
  agent_id: z.string().default('main'),
});

export const UpdateProfileInputSchema = z.object({
  agent_id: z.string().default('main'),
  updates: z.record(z.unknown()),
  reason: z.string().optional(),
});

// Default profile structure
const DEFAULT_PROFILE = {
  user_info: {
    name: null,
    background: null,
    timezone: null,
    current_role: null,
  },
  preferences: {
    communication: null,
    coding_languages: [],
    tools: [],
    working_style: null,
  },
  current_projects: [],
  learned_patterns: [],
};

/**
 * Set a nested value using dot notation
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    // Handle array notation like "current_projects[0]"
    const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);

    if (arrayMatch) {
      const [, arrayName, indexStr] = arrayMatch;
      const index = parseInt(indexStr, 10);
      if (!(arrayName in current)) {
        current[arrayName] = [];
      }
      const arr = current[arrayName] as unknown[];
      while (arr.length <= index) {
        arr.push({});
      }
      current = arr[index] as Record<string, unknown>;
    } else {
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }
  }

  const lastPart = parts[parts.length - 1];
  const arrayMatch = lastPart.match(/^(\w+)\[(\d+)\]$/);

  if (arrayMatch) {
    const [, arrayName, indexStr] = arrayMatch;
    const index = parseInt(indexStr, 10);
    if (!(arrayName in current)) {
      current[arrayName] = [];
    }
    (current[arrayName] as unknown[])[index] = value;
  } else {
    current[lastPart] = value;
  }
}

// Handler functions
export async function handleGetProfile(args: unknown): Promise<StandardResponse<GetProfileData>> {
  const parseResult = GetProfileInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { agent_id } = parseResult.data;

  try {
    const db = getDatabase();

    const profile = db
      .prepare(`SELECT * FROM profiles WHERE agent_id = ?`)
      .get(agent_id) as ProfileRow | undefined;

    if (!profile) {
      // Return default profile if none exists
      return createSuccess({
        profile: DEFAULT_PROFILE,
        last_updated: null,
      });
    }

    return createSuccess({
      profile: JSON.parse(profile.profile_data),
      last_updated: profile.updated_at,
    });
  } catch (error) {
    logger.error('Failed to get profile', { error });
    return createErrorFromException(error);
  }
}

export async function handleUpdateProfile(args: unknown): Promise<StandardResponse<UpdateProfileData>> {
  const parseResult = UpdateProfileInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { agent_id, updates, reason } = parseResult.data;

  try {
    const db = getDatabase();

    // Get current profile
    const existingRow = db
      .prepare(`SELECT * FROM profiles WHERE agent_id = ?`)
      .get(agent_id) as ProfileRow | undefined;

    let currentProfile: Record<string, unknown>;
    if (existingRow) {
      currentProfile = JSON.parse(existingRow.profile_data);

      // Store in history before updating
      db.prepare(
        `INSERT INTO profile_history (agent_id, profile_data, change_reason)
         VALUES (?, ?, ?)`
      ).run(agent_id, existingRow.profile_data, reason ?? null);
    } else {
      currentProfile = structuredClone(DEFAULT_PROFILE);
    }

    // Apply updates using dot notation
    const updatedFields: string[] = [];
    for (const [path, value] of Object.entries(updates)) {
      setNestedValue(currentProfile, path, value);
      updatedFields.push(path);
    }

    const profileJson = JSON.stringify(currentProfile);

    if (existingRow) {
      db.prepare(
        `UPDATE profiles SET profile_data = ?, updated_at = datetime('now')
         WHERE agent_id = ?`
      ).run(profileJson, agent_id);
    } else {
      db.prepare(
        `INSERT INTO profiles (agent_id, profile_data)
         VALUES (?, ?)`
      ).run(agent_id, profileJson);
    }

    logger.info('Profile updated', { agent_id, fields: updatedFields });

    return createSuccess({
      updated_fields: updatedFields,
    });
  } catch (error) {
    logger.error('Failed to update profile', { error });
    return createErrorFromException(error);
  }
}
