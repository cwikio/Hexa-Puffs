/**
 * Script Library tool schemas and handlers.
 *
 * save_script, get_script, list_scripts, search_scripts, run_script, delete_script
 */

import { z } from 'zod';
import type { ScriptLibrary } from '../scripts/library.js';

// ── save_script ────────────────────────────────────────────────────────────

export const saveScriptSchema = z.object({
  name: z.string().min(1).describe('Script name (will be slugified for storage)'),
  description: z.string().min(1).describe('What this script does'),
  language: z.enum(['python', 'node', 'bash']).describe('Programming language'),
  code: z.string().min(1).describe('The script code'),
  tags: z
    .array(z.string())
    .optional()
    .describe('Tags for categorization (e.g., ["data", "csv"])'),
  packages: z
    .array(z.string())
    .optional()
    .describe('Required packages (e.g., ["pandas", "openpyxl"])'),
});

export type SaveScriptInput = z.infer<typeof saveScriptSchema>;

export function handleSaveScript(library: ScriptLibrary) {
  return async (input: SaveScriptInput) => {
    return library.save({
      name: input.name,
      description: input.description,
      language: input.language,
      code: input.code,
      tags: input.tags,
      packages: input.packages,
    });
  };
}

// ── get_script ─────────────────────────────────────────────────────────────

export const getScriptSchema = z.object({
  name: z.string().min(1).describe('Script name to retrieve'),
});

export type GetScriptInput = z.infer<typeof getScriptSchema>;

export function handleGetScript(library: ScriptLibrary) {
  return async (input: GetScriptInput) => {
    return library.get(input.name);
  };
}

// ── list_scripts ───────────────────────────────────────────────────────────

export const listScriptsSchema = z.object({
  language: z
    .enum(['python', 'node', 'bash'])
    .optional()
    .describe('Filter by language'),
  tag: z.string().optional().describe('Filter by tag'),
});

export type ListScriptsInput = z.infer<typeof listScriptsSchema>;

export function handleListScripts(library: ScriptLibrary) {
  return async (input: ListScriptsInput) => {
    const scripts = await library.list({
      language: input.language,
      tag: input.tag,
    });
    return { scripts };
  };
}

// ── search_scripts ─────────────────────────────────────────────────────────

export const searchScriptsSchema = z.object({
  query: z.string().min(1).describe('Search query (matches name, description, tags)'),
});

export type SearchScriptsInput = z.infer<typeof searchScriptsSchema>;

export function handleSearchScripts(library: ScriptLibrary) {
  return async (input: SearchScriptsInput) => {
    const scripts = await library.search(input.query);
    return { scripts };
  };
}

// ── run_script ─────────────────────────────────────────────────────────────

export const runScriptSchema = z.object({
  name: z.string().min(1).describe('Script name to run'),
  args: z
    .array(z.string())
    .optional()
    .describe('Arguments passed to the script (available via sys.argv / process.argv / $@)'),
  timeout_ms: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Timeout in ms (default: 30000, max: 300000)'),
  working_dir: z
    .string()
    .optional()
    .describe('Working directory for script execution'),
});

export type RunScriptInput = z.infer<typeof runScriptSchema>;

export function handleRunScript(library: ScriptLibrary) {
  return async (input: RunScriptInput) => {
    return library.run({
      name: input.name,
      args: input.args,
      timeout_ms: input.timeout_ms,
      working_dir: input.working_dir,
    });
  };
}

// ── delete_script ──────────────────────────────────────────────────────────

export const deleteScriptSchema = z.object({
  name: z.string().min(1).describe('Script name to delete'),
});

export type DeleteScriptInput = z.infer<typeof deleteScriptSchema>;

export function handleDeleteScript(library: ScriptLibrary) {
  return async (input: DeleteScriptInput) => {
    return library.delete(input.name);
  };
}
