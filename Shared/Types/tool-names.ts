/**
 * Canonical tool name constants for cross-boundary tool calls.
 *
 * Tool names follow the pattern: {mcpName}_{toolName}
 * The Orchestrator's ToolRouter prefixes tools with their MCP name + separator ('_').
 *
 * Import these instead of hardcoding tool name strings to make renames a single-point change.
 */

// ── Memory MCP ──────────────────────────────────────────────────────────────

export const MEMORY_STORE_FACT = 'memory_store_fact' as const;
export const MEMORY_LIST_FACTS = 'memory_list_facts' as const;
export const MEMORY_DELETE_FACT = 'memory_delete_fact' as const;
export const MEMORY_UPDATE_FACT = 'memory_update_fact' as const;
export const MEMORY_STORE_CONVERSATION = 'memory_store_conversation' as const;
export const MEMORY_SEARCH_CONVERSATIONS = 'memory_search_conversations' as const;
export const MEMORY_GET_PROFILE = 'memory_get_profile' as const;
export const MEMORY_UPDATE_PROFILE = 'memory_update_profile' as const;
export const MEMORY_RETRIEVE_MEMORIES = 'memory_retrieve_memories' as const;
export const MEMORY_GET_MEMORY_STATS = 'memory_get_memory_stats' as const;
export const MEMORY_EXPORT_MEMORY = 'memory_export_memory' as const;
export const MEMORY_IMPORT_MEMORY = 'memory_import_memory' as const;
export const MEMORY_STORE_SKILL = 'memory_store_skill' as const;
export const MEMORY_LIST_SKILLS = 'memory_list_skills' as const;
export const MEMORY_GET_SKILL = 'memory_get_skill' as const;
export const MEMORY_UPDATE_SKILL = 'memory_update_skill' as const;
export const MEMORY_DELETE_SKILL = 'memory_delete_skill' as const;
export const MEMORY_SYNTHESIZE_FACTS = 'memory_synthesize_facts' as const;
export const MEMORY_BACKFILL_EXTRACT_FACTS = 'memory_backfill_extract_facts' as const;
export const MEMORY_CREATE_PROJECT = 'memory_create_project' as const;
export const MEMORY_LIST_PROJECTS = 'memory_list_projects' as const;
export const MEMORY_UPDATE_PROJECT = 'memory_update_project' as const;
export const MEMORY_LINK_PROJECT_SOURCE = 'memory_link_project_source' as const;
export const MEMORY_UNLINK_PROJECT_SOURCE = 'memory_unlink_project_source' as const;
export const MEMORY_LIST_PROJECT_SOURCES = 'memory_list_project_sources' as const;
export const MEMORY_UPDATE_PROJECT_SOURCE_STATUS = 'memory_update_project_source_status' as const;
export const MEMORY_CREATE_CONTACT = 'memory_create_contact' as const;
export const MEMORY_LIST_CONTACTS = 'memory_list_contacts' as const;
export const MEMORY_UPDATE_CONTACT = 'memory_update_contact' as const;
export const MEMORY_QUERY_TIMELINE = 'memory_query_timeline' as const;

// ── Telegram MCP ────────────────────────────────────────────────────────────

export const TELEGRAM_SEND_MESSAGE = 'telegram_send_message' as const;
export const TELEGRAM_GET_MESSAGES = 'telegram_get_messages' as const;
export const TELEGRAM_GET_NEW_MESSAGES = 'telegram_get_new_messages' as const;
export const TELEGRAM_LIST_CHATS = 'telegram_list_chats' as const;
export const TELEGRAM_LIST_CONTACTS = 'telegram_list_contacts' as const;
export const TELEGRAM_DELETE_MESSAGES = 'telegram_delete_messages' as const;

// ── Filer MCP ───────────────────────────────────────────────────────────────

export const FILER_CREATE_FILE = 'filer_create_file' as const;
export const FILER_READ_FILE = 'filer_read_file' as const;
export const FILER_LIST_FILES = 'filer_list_files' as const;
export const FILER_UPDATE_FILE = 'filer_update_file' as const;
export const FILER_DELETE_FILE = 'filer_delete_file' as const;
export const FILER_MOVE_FILE = 'filer_move_file' as const;
export const FILER_COPY_FILE = 'filer_copy_file' as const;
export const FILER_SEARCH_FILES = 'filer_search_files' as const;
export const FILER_CHECK_GRANT = 'filer_check_grant' as const;
export const FILER_REQUEST_GRANT = 'filer_request_grant' as const;
export const FILER_LIST_GRANTS = 'filer_list_grants' as const;
export const FILER_GET_WORKSPACE_INFO = 'filer_get_workspace_info' as const;
export const FILER_GET_AUDIT_LOG = 'filer_get_audit_log' as const;

// ── Searcher MCP ────────────────────────────────────────────────────────────

export const SEARCHER_WEB_SEARCH = 'searcher_web_search' as const;
export const SEARCHER_NEWS_SEARCH = 'searcher_news_search' as const;
export const SEARCHER_IMAGE_SEARCH = 'searcher_image_search' as const;
export const SEARCHER_WEB_FETCH = 'searcher_web_fetch' as const;

// ── 1Password MCP ───────────────────────────────────────────────────────────

export const ONEPASSWORD_GET_ITEM = 'onepassword_get_item' as const;

// ── Gmail MCP ───────────────────────────────────────────────────────────────

export const GMAIL_LIST_EMAILS = 'gmail_list_emails' as const;
export const GMAIL_LIST_EVENTS = 'gmail_list_events' as const;
