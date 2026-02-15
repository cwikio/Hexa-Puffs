import type { CoreTool } from 'ai';
import { Logger } from '@mcp/shared/Utils/logger.js';
import type { MCPMetadata } from '../orchestrator/types.js';

const logger = new Logger('thinker:tool-selector');

/**
 * Tool groups — core is always included.
 * Glob patterns (e.g. "memory_*") are expanded against the full tool map at runtime.
 */
export const TOOL_GROUPS: Record<string, string[]> = {
  core: ['send_telegram', 'store_fact', 'search_memories', 'get_status', 'spawn_subagent'],
  search: ['searcher_web_search', 'searcher_news_search', 'searcher_image_search', 'searcher_web_fetch'],
  memory: ['memory_*'],
  email: [
    'gmail_list_emails', 'gmail_get_email', 'gmail_send_email', 'gmail_reply_email',
    'gmail_mark_read', 'gmail_get_new_emails', 'gmail_delete_email', 'gmail_modify_labels',
    'gmail_list_drafts', 'gmail_create_draft', 'gmail_update_draft', 'gmail_send_draft',
    'gmail_delete_draft', 'gmail_list_labels', 'gmail_create_label', 'gmail_delete_label',
    'gmail_list_attachments', 'gmail_get_attachment',
    'gmail_list_filters', 'gmail_get_filter', 'gmail_create_filter', 'gmail_delete_filter',
  ],
  calendar: [
    'gmail_list_calendars', 'gmail_list_events', 'gmail_get_event',
    'gmail_create_event', 'gmail_update_event', 'gmail_delete_event',
    'gmail_quick_add_event', 'gmail_find_free_time',
  ],
  telegram: ['telegram_*'],
  files: ['filer_*'],
  passwords: ['onepassword_*'],
  browser: [
    'web_browser_navigate', 'web_browser_snapshot', 'web_browser_click',
    'web_browser_type', 'web_browser_take_screenshot', 'web_browser_tabs',
    'web_browser_fill_form', 'web_browser_navigate_back', 'web_browser_close',
  ],
  jobs: ['create_job', 'queue_task', 'list_jobs', 'get_job_status', 'delete_job',
         'memory_store_skill', 'memory_list_skills'],
  codexec: ['codexec_*'],
};

/** Keyword patterns → tool groups to activate */
const KEYWORD_ROUTES: Array<{ pattern: RegExp; groups: string[] }> = [
  { pattern: /weather|forecast|temperature|news|score|search|look\s?up|find out|who is|what is|current|fetch.*url|read.*article|read.*page|extract.*content|what does.*say/i,
    groups: ['search'] },
  { pattern: /email|e-mail|mail|inbox|send.*to|draft|compose/i,
    groups: ['email'] },
  { pattern: /calendar|meeting|schedule|event|appointment|busy|free time/i,
    groups: ['calendar'] },
  { pattern: /file|document|save|write.*file|read.*file|workspace/i,
    groups: ['files'] },
  { pattern: /password|secret|credential|vault|1password/i,
    groups: ['passwords'] },
  { pattern: /remember|memory|forget|what do you know|about me|fact|contact|ignore|pamiet|wiesz o mnie/i,
    groups: ['memory', 'email'] },
  { pattern: /telegram|message|chat|group/i,
    groups: ['telegram'] },
  { pattern: /browse|website|navigate|webpage|screenshot|login.*site|fill.*form|open.*page|scrape|web.*page|visit.*site|www\.\w|https?:\/\/|go\s+to\s+\S+\.\S/i,
    groups: ['browser', 'search'] },
  { pattern: /\bcode\b|script|execute|python|node\.?js|bash|calculate|compute|program/i,
    groups: ['codexec'] },
  { pattern: /cron|remind me|recurring|every\s+(day|hour|week|minute|morning|evening|\d)|daily at|weekly|hourly|schedule.*(task|job|remind)|per\s+(minute|hour|day|week)|for\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(minute|hour|day|week)|\d+\s*times|once\s+a\s+(day|week|hour|minute)|repeat/i,
    groups: ['jobs'] },
  { pattern: /photo|picture|image|pic|show\s?me|gallery|wallpaper/i,
    groups: ['search', 'telegram'] },
  { pattern: /subagent|sub.?agent|delegate|parallel.*task|spawn/i,
    groups: [] }, // core includes spawn_subagent
  { pattern: /status|health|mcp/i,
    groups: [] }, // core only
];

/** Default groups when no keyword matches (general questions) */
const DEFAULT_GROUPS = ['search', 'memory'];

/**
 * Expand a single pattern (possibly a glob like "memory_*") against available tool names.
 */
function expandPattern(pattern: string, allToolNames: string[]): string[] {
  if (!pattern.includes('*')) {
    return [pattern];
  }
  const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
  return allToolNames.filter((name) => regex.test(name));
}

/**
 * Merge hardcoded TOOL_GROUPS with auto-generated groups from MCP metadata.
 * Any MCP not already in the hardcoded map gets a glob group: `{mcpName}: ['{mcpName}_*']`
 */
function getEffectiveGroups(
  mcpMetadata: Record<string, MCPMetadata> | undefined,
): Record<string, string[]> {
  const groups = { ...TOOL_GROUPS };
  if (mcpMetadata) {
    for (const mcpName of Object.keys(mcpMetadata)) {
      if (!groups[mcpName]) {
        groups[mcpName] = [`${mcpName}_*`];
      }
    }
  }
  return groups;
}

/**
 * Merge hardcoded KEYWORD_ROUTES with keyword routes from MCP metadata.
 * MCPs with manifest keywords that don't already have a hardcoded route get an auto-generated one.
 */
function getEffectiveKeywordRoutes(
  mcpMetadata: Record<string, MCPMetadata> | undefined,
): Array<{ pattern: RegExp; groups: string[] }> {
  const routes = [...KEYWORD_ROUTES];
  if (mcpMetadata) {
    for (const [mcpName, meta] of Object.entries(mcpMetadata)) {
      if (meta.keywords && meta.keywords.length > 0) {
        // Skip if a hardcoded route already targets this group
        const hasRoute = routes.some((r) => r.groups.includes(mcpName));
        if (!hasRoute) {
          const escaped = meta.keywords.map((k) =>
            k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          );
          routes.push({ pattern: new RegExp(escaped.join('|'), 'i'), groups: [mcpName] });
        }
      }
    }
  }
  return routes;
}

/**
 * Select a subset of tools relevant to the given message.
 * Always includes `core` tools. Adds groups based on keyword matching.
 * Falls back to `DEFAULT_GROUPS` when no keywords match.
 *
 * When mcpMetadata is provided, auto-generates tool groups and keyword routes
 * for MCPs not covered by the hardcoded maps (Tier 3 fallback).
 */
export function selectToolsForMessage(
  message: string,
  allTools: Record<string, CoreTool>,
  mcpMetadata?: Record<string, MCPMetadata>,
): Record<string, CoreTool> {
  const allToolNames = Object.keys(allTools);
  const effectiveGroups = getEffectiveGroups(mcpMetadata);
  const effectiveRoutes = getEffectiveKeywordRoutes(mcpMetadata);

  // Determine which groups to activate
  const activeGroups = new Set<string>(['core']);

  let matched = false;
  for (const route of effectiveRoutes) {
    if (route.pattern.test(message)) {
      for (const group of route.groups) {
        activeGroups.add(group);
      }
      matched = true;
    }
  }

  if (!matched) {
    for (const group of DEFAULT_GROUPS) {
      activeGroups.add(group);
    }
  }

  // Collect tool names from active groups
  const selectedNames = new Set<string>();
  for (const groupName of activeGroups) {
    const patterns = effectiveGroups[groupName];
    if (!patterns) continue;
    for (const pattern of patterns) {
      for (const name of expandPattern(pattern, allToolNames)) {
        selectedNames.add(name);
      }
    }
  }

  // Build filtered tool map
  const selected: Record<string, CoreTool> = {};
  for (const name of selectedNames) {
    if (allTools[name]) {
      selected[name] = allTools[name];
    }
  }

  const groupList = Array.from(activeGroups).join(', ');
  logger.info(`Tool selector: [${groupList}] → ${Object.keys(selected).length} tools`);

  return selected;
}
