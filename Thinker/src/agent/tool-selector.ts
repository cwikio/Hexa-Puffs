import type { CoreTool } from 'ai';

/**
 * Tool groups — core is always included.
 * Glob patterns (e.g. "memory_*") are expanded against the full tool map at runtime.
 */
const TOOL_GROUPS: Record<string, string[]> = {
  core: ['send_telegram', 'store_fact', 'search_memories', 'get_status'],
  search: ['searcher_web_search', 'searcher_news_search'],
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
  browser: ['web_browser_*'],
  jobs: ['create_job', 'queue_task', 'list_jobs', 'get_job_status', 'delete_job'],
};

/** Keyword patterns → tool groups to activate */
const KEYWORD_ROUTES: Array<{ pattern: RegExp; groups: string[] }> = [
  { pattern: /weather|forecast|temperature|news|score|search|look\s?up|find out|who is|what is|current/i,
    groups: ['search'] },
  { pattern: /email|e-mail|mail|inbox|send.*to|draft|compose/i,
    groups: ['email'] },
  { pattern: /calendar|meeting|schedule|event|appointment|busy|free time/i,
    groups: ['calendar'] },
  { pattern: /file|document|save|write.*file|read.*file|workspace/i,
    groups: ['files'] },
  { pattern: /password|secret|credential|vault|1password/i,
    groups: ['passwords'] },
  { pattern: /remember|memory|forget|what do you know|about me|fact|pamiet|wiesz o mnie/i,
    groups: ['memory'] },
  { pattern: /telegram|message|chat|contact|group/i,
    groups: ['telegram'] },
  { pattern: /browse|website|navigate|webpage|screenshot|login.*site|fill.*form|open.*page|scrape|web.*page|visit.*site|www\.\w|https?:\/\/|go\s+to\s+\S+\.\S/i,
    groups: ['browser'] },
  { pattern: /cron|remind me|recurring|every\s+(day|hour|week|minute|morning|evening|\d)|daily at|weekly|hourly|schedule.*(task|job|remind)/i,
    groups: ['jobs', 'memory'] },
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
 * Select a subset of tools relevant to the given message.
 * Always includes `core` tools. Adds groups based on keyword matching.
 * Falls back to `DEFAULT_GROUPS` when no keywords match.
 */
export function selectToolsForMessage(
  message: string,
  allTools: Record<string, CoreTool>,
): Record<string, CoreTool> {
  const allToolNames = Object.keys(allTools);

  // Determine which groups to activate
  const activeGroups = new Set<string>(['core']);

  let matched = false;
  for (const route of KEYWORD_ROUTES) {
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
    const patterns = TOOL_GROUPS[groupName];
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
  console.log(`Tool selector: [${groupList}] → ${Object.keys(selected).length} tools`);

  return selected;
}
