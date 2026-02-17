import { z } from 'zod';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { getDatabase, type FactRow, type ConversationRow, type ProfileRow } from '../db/index.js';
import { getConfig } from '../config/index.js';
import { ExportError } from '../utils/errors.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import {
  type StandardResponse,
  createSuccess,
  createError,
  createErrorFromException,
} from '@mcp/shared/Types/StandardResponse.js';
import {
  type ExportMemoryData,
  type ImportMemoryData,
} from '../types/responses.js';

// Tool definitions
export const exportMemoryToolDefinition = {
  name: 'export_memory',
  description: 'Export memory to human-readable files',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'Agent ID to export',
        default: 'main',
      },
      format: {
        type: 'string',
        enum: ['markdown', 'json'],
        description: 'Export format',
        default: 'markdown',
      },
      include_conversations: {
        type: 'boolean',
        description: 'Whether to include conversation history',
        default: true,
      },
    },
  },
};

export const importMemoryToolDefinition = {
  name: 'import_memory',
  description: 'Import user-edited memory files (profile or facts)',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agent_id: {
        type: 'string',
        description: 'Agent ID to import into',
        default: 'main',
      },
      file_path: {
        type: 'string',
        description: 'Path to the file to import',
      },
    },
    required: ['file_path'],
  },
};

// Input schemas
export const ExportMemoryInputSchema = z.object({
  agent_id: z.string().default('main'),
  format: z.enum(['markdown', 'json']).default('markdown'),
  include_conversations: z.boolean().default(true),
});

export const ImportMemoryInputSchema = z.object({
  agent_id: z.string().default('main'),
  file_path: z.string().min(1),
});

// Helper functions
function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function groupFactsByCategory(facts: FactRow[]): Record<string, FactRow[]> {
  const grouped: Record<string, FactRow[]> = {};
  for (const fact of facts) {
    if (!grouped[fact.category]) {
      grouped[fact.category] = [];
    }
    grouped[fact.category].push(fact);
  }
  return grouped;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// Handler functions
export async function handleExportMemory(args: unknown): Promise<StandardResponse<ExportMemoryData>> {
  const parseResult = ExportMemoryInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { agent_id, format, include_conversations } = parseResult.data;

  try {
    const db = getDatabase();
    const config = getConfig();
    const exportPath = config.export.path;

    // Ensure export directory exists
    if (!existsSync(exportPath)) {
      mkdirSync(exportPath, { recursive: true });
    }

    let filesCreated = 0;

    // Get profile
    const profile = db
      .prepare(`SELECT * FROM profiles WHERE agent_id = ?`)
      .get(agent_id) as ProfileRow | undefined;

    // Get facts
    const facts = db
      .prepare(`SELECT * FROM facts WHERE agent_id = ? ORDER BY category, created_at DESC`)
      .all(agent_id) as FactRow[];

    // Get conversations (if requested)
    let conversations: ConversationRow[] = [];
    if (include_conversations) {
      conversations = db
        .prepare(`SELECT * FROM conversations WHERE agent_id = ? ORDER BY created_at DESC LIMIT 500`)
        .all(agent_id) as ConversationRow[];
    }

    if (format === 'json') {
      // Export as JSON
      const profilePath = join(exportPath, 'profile.json');
      ensureDir(profilePath);
      writeFileSync(
        profilePath,
        JSON.stringify(profile ? JSON.parse(profile.profile_data) : {}, null, 2)
      );
      filesCreated++;

      const factsPath = join(exportPath, 'facts', 'all-facts.json');
      ensureDir(factsPath);
      writeFileSync(
        factsPath,
        JSON.stringify(facts.map(f => ({
          id: f.id,
          fact: f.fact,
          category: f.category,
          confidence: f.confidence,
          created_at: f.created_at,
        })), null, 2)
      );
      filesCreated++;

      if (include_conversations) {
        const convPath = join(exportPath, 'conversations', 'recent.json');
        ensureDir(convPath);
        writeFileSync(
          convPath,
          JSON.stringify(conversations.map(c => ({
            id: c.id,
            user_message: c.user_message,
            agent_response: c.agent_response,
            created_at: c.created_at,
          })), null, 2)
        );
        filesCreated++;
      }
    } else {
      // Export as Markdown
      // Profile
      const profileMd = generateProfileMarkdown(profile);
      const profilePath = join(exportPath, 'profile.md');
      ensureDir(profilePath);
      writeFileSync(profilePath, profileMd);
      filesCreated++;

      // Facts by category
      const groupedFacts = groupFactsByCategory(facts);
      for (const [category, categoryFacts] of Object.entries(groupedFacts)) {
        const factsMd = generateFactsMarkdown(category, categoryFacts);
        const factsPath = join(exportPath, 'facts', `${category}.md`);
        ensureDir(factsPath);
        writeFileSync(factsPath, factsMd);
        filesCreated++;
      }

      // Conversations
      if (include_conversations && conversations.length > 0) {
        const recentMd = generateConversationsMarkdown(conversations.slice(0, 50));
        const convPath = join(exportPath, 'conversations', 'recent.md');
        ensureDir(convPath);
        writeFileSync(convPath, recentMd);
        filesCreated++;
      }

      // Summary
      const summaryMd = generateSummaryMarkdown(profile, facts, conversations);
      writeFileSync(join(exportPath, 'summary.md'), summaryMd);
      filesCreated++;
    }

    logger.info('Memory exported', { path: exportPath, files: filesCreated });

    return createSuccess({
      export_path: exportPath,
      files_created: filesCreated,
      exported_at: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to export memory', { error });
    return createErrorFromException(error);
  }
}

export async function handleImportMemory(args: unknown): Promise<StandardResponse<ImportMemoryData>> {
  const parseResult = ImportMemoryInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError('Invalid input: ' + parseResult.error.message);
  }

  const { agent_id, file_path } = parseResult.data;

  try {
    if (!existsSync(file_path)) {
      return createError(`File not found: ${file_path}`);
    }

    const content = readFileSync(file_path, 'utf-8');
    const data = JSON.parse(content);

    const db = getDatabase();
    let changesApplied = 0;
    const fieldsUpdated: string[] = [];

    // Determine what kind of file this is
    if (file_path.includes('profile.json')) {
      // Import profile
      const existingRow = db
        .prepare(`SELECT * FROM profiles WHERE agent_id = ?`)
        .get(agent_id) as ProfileRow | undefined;

      if (existingRow) {
        // Store history
        db.prepare(
          `INSERT INTO profile_history (agent_id, profile_data, change_reason)
           VALUES (?, ?, ?)`
        ).run(agent_id, existingRow.profile_data, 'Imported from file');

        db.prepare(
          `UPDATE profiles SET profile_data = ?, updated_at = datetime('now')
           WHERE agent_id = ?`
        ).run(JSON.stringify(data), agent_id);
      } else {
        db.prepare(
          `INSERT INTO profiles (agent_id, profile_data)
           VALUES (?, ?)`
        ).run(agent_id, JSON.stringify(data));
      }

      changesApplied = 1;
      fieldsUpdated.push('profile');
    } else if (file_path.includes('facts') && Array.isArray(data)) {
      // Import facts
      const insertFact = db.prepare(
        `INSERT OR REPLACE INTO facts (agent_id, fact, category, confidence)
         VALUES (?, ?, ?, ?)`
      );

      for (const fact of data) {
        if (fact.fact && fact.category) {
          insertFact.run(agent_id, fact.fact, fact.category, fact.confidence ?? 1.0);
          changesApplied++;
        }
      }
      fieldsUpdated.push('facts');
    } else {
      return createError('Unknown file format. Expected profile.json or facts JSON array.');
    }

    logger.info('Memory imported', { file_path, changes: changesApplied });

    return createSuccess({
      changes_applied: changesApplied,
      fields_updated: fieldsUpdated,
    });
  } catch (error) {
    logger.error('Failed to import memory', { error });
    return createErrorFromException(error);
  }
}

// Markdown generators
function generateProfileMarkdown(profile: ProfileRow | undefined): string {
  const data = profile ? JSON.parse(profile.profile_data) : {};
  const lastUpdated = profile ? formatDate(profile.updated_at) : 'Never';

  let md = `# My AI Assistant's Understanding of Me\n\n`;
  md += `Last updated: ${lastUpdated}\n\n`;

  if (data.user_info) {
    md += `## Who I Am\n`;
    if (data.user_info.name) md += `- **Name:** ${data.user_info.name}\n`;
    if (data.user_info.background) md += `- **Background:** ${data.user_info.background}\n`;
    if (data.user_info.timezone) md += `- **Timezone:** ${data.user_info.timezone}\n`;
    if (data.user_info.current_role) md += `- **Current Role:** ${data.user_info.current_role}\n`;
    md += `\n`;
  }

  if (data.preferences) {
    md += `## My Preferences\n`;
    if (data.preferences.communication) md += `- **Communication:** ${data.preferences.communication}\n`;
    if (data.preferences.coding_languages?.length > 0) {
      md += `- **Languages:** ${data.preferences.coding_languages.join(', ')}\n`;
    }
    if (data.preferences.tools?.length > 0) {
      md += `- **Tools:** ${data.preferences.tools.join(', ')}\n`;
    }
    if (data.preferences.working_style) md += `- **Working Style:** ${data.preferences.working_style}\n`;
    md += `\n`;
  }

  if (data.current_projects?.length > 0) {
    md += `## Current Projects\n`;
    for (const project of data.current_projects) {
      md += `1. **${project.name}** (${project.status}`;
      if (project.started) md += `, started ${project.started}`;
      md += `)\n`;
    }
    md += `\n`;
  }

  if (data.learned_patterns?.length > 0) {
    md += `## Patterns the AI Has Noticed\n`;
    for (const pattern of data.learned_patterns) {
      md += `- ${pattern}\n`;
    }
  }

  return md;
}

function generateFactsMarkdown(category: string, facts: FactRow[]): string {
  const categoryTitle = category.charAt(0).toUpperCase() + category.slice(1) + 's';

  let md = `# ${categoryTitle} I've Learned\n\n`;

  for (const fact of facts) {
    md += `- ${fact.fact} (learned ${formatDate(fact.created_at)})\n`;
  }

  return md;
}

function generateConversationsMarkdown(conversations: ConversationRow[]): string {
  let md = `# Recent Conversations\n\n`;

  for (const conv of conversations) {
    md += `## ${formatDate(conv.created_at)}\n\n`;
    md += `**User:** ${conv.user_message.substring(0, 200)}${conv.user_message.length > 200 ? '...' : ''}\n\n`;
    md += `**Assistant:** ${conv.agent_response.substring(0, 200)}${conv.agent_response.length > 200 ? '...' : ''}\n\n`;
    md += `---\n\n`;
  }

  return md;
}

function generateSummaryMarkdown(
  profile: ProfileRow | undefined,
  facts: FactRow[],
  conversations: ConversationRow[]
): string {
  const groupedFacts = groupFactsByCategory(facts);

  let md = `# Memory Summary\n\n`;
  md += `Generated: ${new Date().toISOString()}\n\n`;

  md += `## Statistics\n\n`;
  md += `- **Total Facts:** ${facts.length}\n`;
  md += `- **Total Conversations:** ${conversations.length}\n`;
  md += `- **Profile Last Updated:** ${profile ? formatDate(profile.updated_at) : 'Never'}\n\n`;

  md += `## Facts by Category\n\n`;
  for (const [category, categoryFacts] of Object.entries(groupedFacts)) {
    md += `- **${category}:** ${categoryFacts.length} facts\n`;
  }

  return md;
}
