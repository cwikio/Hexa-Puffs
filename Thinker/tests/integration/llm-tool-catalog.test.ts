/**
 * LLM Tool Catalog Coverage Tests
 *
 * Validates Qwen3.5-4B can correctly select each tool from the full 144-tool catalog.
 * One test per tool with a natural language prompt that should trigger it.
 *
 * Prerequisites:
 *   - Ollama running at localhost:11434
 *   - Model pulled: qwen3.5:4b-q4_K_M
 *
 * Run: cd Thinker && npx vitest run tests/integration/llm-tool-catalog.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL = process.env.TOOL_SELECTOR_MODEL || 'qwen3.5:4b-q4_K_M';
const REQUEST_TIMEOUT_MS = 30_000;

// ── Load fixture ────────────────────────────────────────────────

interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const toolSchemas: ToolSchema[] = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/tool-schemas.json'), 'utf-8'),
);

// ── Types ───────────────────────────────────────────────────────

interface ToolCallResponse {
  function: { name: string; arguments: string };
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCallResponse[];
    };
    finish_reason: string;
  }>;
}

// ── Ollama helpers ──────────────────────────────────────────────

async function isOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function isModelAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return data.models?.some((m) => m.name.startsWith(MODEL.split(':')[0])) ?? false;
  } catch {
    return false;
  }
}

const SYSTEM_PROMPT = [
  'You are a tool-calling assistant with access to many tools.',
  'When the user asks something that requires action, call the most appropriate tool.',
  'You do NOT have access to real-time information. For weather, news, current events, scores, or any time-sensitive data, ALWAYS use a search tool.',
  'When the user is just chatting (greetings, thanks, jokes, general knowledge questions), respond directly without calling any tool.',
  'Pick exactly ONE tool — the most specific match. Do not call multiple tools.',
].join(' ');

async function selectTool(message: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${OLLAMA_HOST}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: message },
        ],
        tools: toolSchemas,
        tool_choice: 'auto',
        temperature: 0.1,
        max_tokens: 512,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Ollama ${res.status}: ${body}`);
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const toolCalls = data.choices[0]?.message?.tool_calls;
    if (!toolCalls || toolCalls.length === 0) return null;
    return toolCalls[0].function.name;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Test case type ──────────────────────────────────────────────

interface ToolTestCase {
  prompt: string;
  expected: string;
  /** Alternative acceptable tool names */
  alts?: string[];
}

// ── Pre-flight checks ───────────────────────────────────────────

const ollamaUp = await isOllamaAvailable();
const modelReady = ollamaUp && (await isModelAvailable());

console.log(`Ollama: ${ollamaUp ? 'up' : 'down'}, Model (${MODEL}): ${modelReady ? 'ready' : 'missing'}`);
console.log(`Tool fixture: ${toolSchemas.length} tools loaded`);

const skipReason = !ollamaUp
  ? 'Ollama not running'
  : !modelReady
    ? `Model ${MODEL} not available`
    : false;

// ── Scoring ─────────────────────────────────────────────────────

const results: Array<{ group: string; tool: string; prompt: string; got: string | null; pass: boolean }> = [];

function runCase(group: string, tc: ToolTestCase) {
  const acceptable = [tc.expected, ...(tc.alts ?? [])];
  it.skipIf(skipReason)(
    `${tc.expected}`,
    async () => {
      const got = await selectTool(tc.prompt);
      const pass = got !== null && acceptable.includes(got);
      results.push({ group, tool: tc.expected, prompt: tc.prompt, got, pass });
      expect(acceptable, `Prompt: "${tc.prompt}" → got: ${got}`).toContain(got);
    },
    REQUEST_TIMEOUT_MS + 5_000,
  );
}

// ── Test suite ──────────────────────────────────────────────────

describe('LLM Tool Catalog Coverage', () => {
  it.skipIf(skipReason)(
    'warmup (loads model into VRAM)',
    async () => {
      await selectTool('hello');
      expect(true).toBe(true);
    },
    90_000,
  );

  // ── Filer (13 tools) ────────────────────────────────────────

  describe('filer', () => {
    const cases: ToolTestCase[] = [
      {
        prompt: 'create a new file at path notes.txt with content "Meeting at 3pm with design team"',
        expected: 'filer_create_file',
      },
      {
        prompt: 'read the contents of the file report.txt',
        expected: 'filer_read_file',
      },
      {
        prompt: 'list all files in the documents folder',
        expected: 'filer_list_files',
      },
      {
        prompt: 'append the text "buy milk" to the existing file todo.txt',
        expected: 'filer_update_file',
        alts: ['filer_read_file'],
      },
      {
        prompt: 'delete the file old-notes.txt from my workspace',
        expected: 'filer_delete_file',
      },
      {
        prompt: 'move report.txt to the archive folder',
        expected: 'filer_move_file',
      },
      {
        prompt: 'copy the file /granted/template.txt to workspace/template.txt',
        expected: 'filer_copy_file',
      },
      {
        prompt: 'search for files containing the word "budget"',
        expected: 'filer_search_files',
      },
      {
        prompt: 'check if I have access to /home/user/documents',
        expected: 'filer_check_grant',
      },
      {
        prompt: 'request access to the path /var/data so I can read files there',
        expected: 'filer_request_grant',
      },
      {
        prompt: 'show me all my current file access grants',
        expected: 'filer_list_grants',
      },
      {
        prompt: 'what is my workspace location and how much disk space is used',
        expected: 'filer_get_workspace_info',
      },
      {
        prompt: 'show me the audit log of recent file operations',
        expected: 'filer_get_audit_log',
      },
    ];

    for (const tc of cases) runCase('filer', tc);
  });

  // ── Memory (31 tools) ───────────────────────────────────────

  describe('memory', () => {
    const cases: ToolTestCase[] = [
      {
        prompt: 'remember that I prefer dark mode in all apps',
        expected: 'memory_store_fact',
        alts: ['store_fact'],
      },
      {
        prompt: 'list all the facts you have stored about me',
        expected: 'memory_list_facts',
      },
      {
        prompt: 'delete the fact about my coffee preference, fact ID 42',
        expected: 'memory_delete_fact',
      },
      {
        prompt: 'update fact ID 7 — my job title is now Senior Engineer',
        expected: 'memory_update_fact',
        alts: ['memory_list_facts'],
      },
      {
        prompt: 'what do you remember about my vacation plans',
        expected: 'memory_retrieve_memories',
        alts: ['search_memories'],
      },
      {
        prompt: 'store this conversation in memory: user asked about weather, assistant searched and replied with forecast',
        expected: 'memory_store_conversation',
        alts: ['memory_store_fact'],
      },
      {
        prompt: 'search our past chat transcripts about the project deadline',
        expected: 'memory_search_conversations',
      },
      {
        prompt: 'show me my full user profile',
        expected: 'memory_get_profile',
      },
      {
        prompt: 'update my profile — set my name to John Smith',
        expected: 'memory_update_profile',
      },
      {
        prompt: 'create a new skill that checks my email every morning at 9am and sends a summary',
        expected: 'memory_store_skill',
      },
      {
        prompt: 'list all my registered autonomous skills',
        expected: 'memory_list_skills',
      },
      {
        prompt: 'get the details of skill ID 5',
        expected: 'memory_get_skill',
      },
      {
        prompt: 'update skill ID 12 to set enabled to false',
        expected: 'memory_update_skill',
        alts: ['memory_get_skill', 'memory_list_skills'],
      },
      {
        prompt: 'delete skill ID 7 from the skill registry',
        expected: 'memory_delete_skill',
        alts: ['memory_get_skill', 'memory_list_skills'],
      },
      {
        prompt: 'add a new contact: Jane Doe, email jane@example.com, works at Acme Corp',
        expected: 'memory_create_contact',
      },
      {
        prompt: 'list all my contacts who work at Google',
        expected: 'memory_list_contacts',
      },
      {
        prompt: "update contact ID 15 — change email to jane.doe@newcompany.com",
        expected: 'memory_update_contact',
        alts: ['memory_list_contacts'],
      },
      {
        prompt: 'create a new project called Website Redesign with high priority',
        expected: 'memory_create_project',
      },
      {
        prompt: 'list all my active projects',
        expected: 'memory_list_projects',
      },
      {
        prompt: 'update project ID 5 — set status to completed',
        expected: 'memory_update_project',
        alts: ['memory_list_projects'],
      },
      {
        prompt: 'what happened last week across all my activities and conversations',
        expected: 'memory_query_timeline',
      },
      {
        prompt: 'how much memory storage am I using — show me statistics',
        expected: 'memory_get_memory_stats',
      },
      {
        prompt: 'generate embeddings for all facts that are missing them',
        expected: 'memory_backfill_embeddings',
      },
      {
        prompt: 'process old conversations to extract facts that were never mined',
        expected: 'memory_backfill_extract_facts',
      },
      {
        prompt: 'export all my memory data to human-readable files',
        expected: 'memory_export_memory',
      },
      {
        prompt: 'import the edited profile.md and facts.md memory files back into memory storage',
        expected: 'memory_import_memory',
        alts: ['memory_export_memory', 'filer_read_file'],
      },
      {
        prompt: 'consolidate and deduplicate all my stored facts',
        expected: 'memory_synthesize_facts',
      },
      {
        prompt: 'link project ID 2 to the MCP source named "github" so it tracks that integration',
        expected: 'memory_link_project_source',
        alts: ['memory_update_project', 'memory_list_projects'],
      },
      {
        prompt: 'unlink and remove the "github" MCP source from project ID 2',
        expected: 'memory_unlink_project_source',
        alts: ['memory_list_project_sources', 'memory_update_project'],
      },
      {
        prompt: 'list all MCP data sources that are linked to project ID 2',
        expected: 'memory_list_project_sources',
        alts: ['memory_list_projects'],
      },
      {
        prompt: 'mark the MCP source "github" as healthy for project ID 3 — update its sync status',
        expected: 'memory_update_project_source_status',
        alts: ['memory_list_project_sources'],
      },
    ];

    for (const tc of cases) runCase('memory', tc);
  });

  // ── Searcher (4 tools) ───────────────────────────────────────

  describe('searcher', () => {
    const cases: ToolTestCase[] = [
      {
        prompt: 'search the web for best restaurants in Paris',
        expected: 'searcher_web_search',
      },
      {
        prompt: 'search for the latest AI news articles',
        expected: 'searcher_news_search',
      },
      {
        prompt: 'search for images of golden retrievers — I need pictures',
        expected: 'searcher_image_search',
        alts: ['searcher_web_search'],
      },
      {
        prompt: 'fetch the content of this URL and extract the text: https://example.com/article',
        expected: 'searcher_web_fetch',
      },
    ];

    for (const tc of cases) runCase('searcher', tc);
  });

  // ── Gmail (30 tools) ────────────────────────────────────────

  describe('gmail', () => {
    const cases: ToolTestCase[] = [
      {
        prompt: 'list my recent emails from Amazon',
        expected: 'gmail_list_emails',
      },
      {
        prompt: 'get the full content of email message ID msg_abc123',
        expected: 'gmail_get_email',
      },
      {
        prompt: 'send an email to bob@example.com with subject "Meeting tomorrow"',
        expected: 'gmail_send_email',
      },
      {
        prompt: 'reply to the email thread about the quarterly report',
        expected: 'gmail_reply_email',
        alts: ['gmail_list_emails', 'gmail_get_email'],
      },
      {
        prompt: 'delete the spam email from the Nigerian prince',
        expected: 'gmail_delete_email',
        alts: ['gmail_list_emails'],
      },
      {
        prompt: 'mark the email from Sarah as read',
        expected: 'gmail_mark_read',
        alts: ['gmail_list_emails'],
      },
      {
        prompt: 'add the "Important" label to the email about the contract',
        expected: 'gmail_modify_labels',
        alts: ['gmail_list_emails', 'gmail_list_labels'],
      },
      {
        prompt: 'check if I have any new emails since last time',
        expected: 'gmail_get_new_emails',
      },
      {
        prompt: 'list all my email drafts',
        expected: 'gmail_list_drafts',
      },
      {
        prompt: 'create a draft email to the team about the offsite',
        expected: 'gmail_create_draft',
        alts: ['gmail_send_email'],
      },
      {
        prompt: 'update my draft about the meeting — change the time to 3pm',
        expected: 'gmail_update_draft',
        alts: ['gmail_list_drafts'],
      },
      {
        prompt: 'send the draft I wrote to the marketing team',
        expected: 'gmail_send_draft',
        alts: ['gmail_list_drafts'],
      },
      {
        prompt: 'delete the draft I started about the holiday party',
        expected: 'gmail_delete_draft',
        alts: ['gmail_list_drafts'],
      },
      {
        prompt: 'list all my Gmail labels including system labels',
        expected: 'gmail_list_labels',
      },
      {
        prompt: 'create a new Gmail label called "Clients"',
        expected: 'gmail_create_label',
      },
      {
        prompt: 'delete the Gmail label called "Old Projects"',
        expected: 'gmail_delete_label',
        alts: ['gmail_list_labels'],
      },
      {
        prompt: 'list all attachments in the email about the invoice',
        expected: 'gmail_list_attachments',
        alts: ['gmail_list_emails'],
      },
      {
        prompt: 'download the PDF attachment from the contract email',
        expected: 'gmail_get_attachment',
        alts: ['gmail_list_emails', 'gmail_list_attachments'],
      },
      {
        prompt: 'list all my calendars including shared ones',
        expected: 'gmail_list_calendars',
      },
      {
        prompt: 'what events do I have on my calendar this week',
        expected: 'gmail_list_events',
      },
      {
        prompt: 'get the full details of calendar event ID evt_xyz789',
        expected: 'gmail_get_event',
      },
      {
        prompt: 'create a meeting with the design team on Friday at 2pm',
        expected: 'gmail_create_event',
        alts: ['gmail_quick_add_event'],
      },
      {
        prompt: 'update the Friday meeting — move it to 4pm instead',
        expected: 'gmail_update_event',
        alts: ['gmail_list_events'],
      },
      {
        prompt: 'cancel the calendar event for the dentist appointment',
        expected: 'gmail_delete_event',
        alts: ['gmail_list_events'],
      },
      {
        prompt: 'add a calendar event: lunch with Mike tomorrow at noon',
        expected: 'gmail_quick_add_event',
        alts: ['gmail_create_event'],
      },
      {
        prompt: 'when am I free next Tuesday between 9am and 5pm',
        expected: 'gmail_find_free_time',
        alts: ['gmail_list_events', 'searcher_web_search'],
      },
      {
        prompt: 'list all my Gmail filter rules',
        expected: 'gmail_list_filters',
      },
      {
        prompt: 'get the details of Gmail filter ID filter_123',
        expected: 'gmail_get_filter',
      },
      {
        prompt: 'create a Gmail filter that auto-archives emails from noreply@',
        expected: 'gmail_create_filter',
      },
      {
        prompt: 'delete Gmail filter ID filter_456',
        expected: 'gmail_delete_filter',
      },
    ];

    for (const tc of cases) runCase('gmail', tc);
  });

  // ── Telegram (16 tools) ─────────────────────────────────────

  describe('telegram', () => {
    const cases: ToolTestCase[] = [
      {
        prompt: 'send a Telegram message to John saying "See you at 5"',
        expected: 'telegram_send_message',
        alts: ['send_telegram', 'telegram_list_contacts', 'telegram_search_users', 'telegram_list_chats'],
      },
      {
        prompt: 'show me the recent message history from the work group chat',
        expected: 'telegram_get_messages',
        alts: ['telegram_list_chats'],
      },
      {
        prompt: 'search Telegram messages for "meeting notes"',
        expected: 'telegram_search_messages',
      },
      {
        prompt: 'delete the last 3 messages I sent in the group chat',
        expected: 'telegram_delete_messages',
        alts: ['telegram_get_messages', 'telegram_list_chats'],
      },
      {
        prompt: 'list all my Telegram chats and groups',
        expected: 'telegram_list_chats',
      },
      {
        prompt: 'get detailed info about the Telegram chat "Project Alpha"',
        expected: 'telegram_get_chat',
        alts: ['telegram_list_chats'],
      },
      {
        prompt: 'create a new Telegram group called "Weekend Plans" with Alice and Bob',
        expected: 'telegram_create_group',
        alts: ['telegram_list_contacts', 'telegram_search_users'],
      },
      {
        prompt: 'list all my saved Telegram contacts',
        expected: 'telegram_list_contacts',
      },
      {
        prompt: 'add a new Telegram contact with phone number +1234567890',
        expected: 'telegram_add_contact',
      },
      {
        prompt: 'search for Telegram users with username @johndoe',
        expected: 'telegram_search_users',
      },
      {
        prompt: 'send this photo to the family group on Telegram',
        expected: 'telegram_send_media',
        alts: ['telegram_list_chats', 'telegram_send_message'],
      },
      {
        prompt: 'download the video that was shared in the Telegram chat',
        expected: 'telegram_download_media',
        alts: ['telegram_get_messages', 'telegram_list_chats'],
      },
      {
        prompt: 'what is my Telegram account info — username and phone number',
        expected: 'telegram_get_me',
      },
      {
        prompt: 'mark all messages as read in the Telegram work group',
        expected: 'telegram_mark_read',
        alts: ['telegram_list_chats', 'telegram_get_messages'],
      },
      {
        prompt: 'get any new Telegram messages that arrived since last check',
        expected: 'telegram_get_new_messages',
      },
      {
        prompt: 'subscribe to real-time messages from the Telegram channel "TechNews"',
        expected: 'telegram_subscribe_chat',
      },
    ];

    for (const tc of cases) runCase('telegram', tc);
  });

  // ── CodeExec (13 tools) ─────────────────────────────────────

  describe('codexec', () => {
    const cases: ToolTestCase[] = [
      {
        prompt: 'run this Python code: print("hello world")',
        expected: 'codexec_execute_code',
      },
      {
        prompt: 'start a persistent Python REPL session for data analysis',
        expected: 'codexec_start_session',
      },
      {
        prompt: 'send this code to my existing REPL session: df.describe()',
        expected: 'codexec_send_to_session',
      },
      {
        prompt: 'close REPL session ID sess_abc',
        expected: 'codexec_close_session',
      },
      {
        prompt: 'list all active REPL sessions',
        expected: 'codexec_list_sessions',
      },
      {
        prompt: 'save this code as a reusable script called "data-cleaner"',
        expected: 'codexec_save_script',
        alts: ['codexec_save_and_run_script'],
      },
      {
        prompt: 'get the saved script called "data-cleaner"',
        expected: 'codexec_get_script',
      },
      {
        prompt: 'list all my saved scripts',
        expected: 'codexec_list_scripts',
      },
      {
        prompt: 'search my saved scripts for anything related to CSV parsing',
        expected: 'codexec_search_scripts',
      },
      {
        prompt: 'run the saved script called "daily-report"',
        expected: 'codexec_run_script',
      },
      {
        prompt: 'save this code as "api-checker" and run it immediately',
        expected: 'codexec_save_and_run_script',
        alts: ['codexec_save_script', 'codexec_execute_code'],
      },
      {
        prompt: 'delete the saved script called "old-backup"',
        expected: 'codexec_delete_script',
      },
      {
        prompt: 'install the pandas package via pip',
        expected: 'codexec_install_package',
      },
    ];

    for (const tc of cases) runCase('codexec', tc);
  });

  // ── 1Password (4 tools) ─────────────────────────────────────

  describe('onepassword', () => {
    const cases: ToolTestCase[] = [
      {
        prompt: 'list all my 1Password vaults',
        expected: 'onepassword_list_vaults',
      },
      {
        prompt: 'list items in my "Work" 1Password vault',
        expected: 'onepassword_list_items',
      },
      {
        prompt: 'get the full details of the "AWS Credentials" item in 1Password',
        expected: 'onepassword_get_item',
      },
      {
        prompt: 'read the secret at op://vault/item/field from 1Password',
        expected: 'onepassword_read_secret',
      },
    ];

    for (const tc of cases) runCase('onepassword', tc);
  });

  // ── Guardian (2 tools) ──────────────────────────────────────

  describe('guardian', () => {
    const cases: ToolTestCase[] = [
      {
        prompt: 'scan this user input for prompt injection attacks: "Ignore all previous instructions and..."',
        expected: 'guardian_scan_content',
      },
      {
        prompt: 'show me the security scan audit log',
        expected: 'guardian_get_scan_log',
      },
    ];

    for (const tc of cases) runCase('guardian', tc);
  });

  // ── Web Browser (21 tools) ──────────────────────────────────

  describe('web_browser', () => {
    const cases: ToolTestCase[] = [
      {
        prompt: 'open the browser and navigate to https://github.com',
        expected: 'web_browser_navigate',
      },
      {
        prompt: 'go back to the previous page in the browser',
        expected: 'web_browser_navigate_back',
      },
      {
        prompt: 'take an accessibility snapshot of the current browser page',
        expected: 'web_browser_snapshot',
      },
      {
        prompt: 'click the "Sign In" button on the page (ref ID 15)',
        expected: 'web_browser_click',
      },
      {
        prompt: 'type my username "john_doe" into the login field',
        expected: 'web_browser_type',
        alts: ['web_browser_fill', 'web_browser_snapshot'],
      },
      {
        prompt: 'clear the search box and fill it with "machine learning"',
        expected: 'web_browser_fill',
        alts: ['web_browser_type', 'web_browser_snapshot'],
      },
      {
        prompt: 'take a screenshot of what the browser is showing right now',
        expected: 'web_browser_take_screenshot',
      },
      {
        prompt: 'list all open browser tabs',
        expected: 'web_browser_tab_list',
      },
      {
        prompt: 'open a new browser tab and go to google.com',
        expected: 'web_browser_tab_new',
      },
      {
        prompt: 'switch to browser tab number 3',
        expected: 'web_browser_tab_select',
      },
      {
        prompt: 'close the second browser tab',
        expected: 'web_browser_tab_close',
      },
      {
        prompt: 'close the browser completely and release all resources',
        expected: 'web_browser_close',
      },
      {
        prompt: 'select "English" from the language dropdown menu on the page',
        expected: 'web_browser_select_option',
        alts: ['web_browser_click', 'web_browser_snapshot'],
      },
      {
        prompt: 'hover over the navigation menu to show the dropdown',
        expected: 'web_browser_hover',
        alts: ['web_browser_click', 'web_browser_snapshot'],
      },
      {
        prompt: 'drag the slider element to the right on the page',
        expected: 'web_browser_drag',
        alts: ['web_browser_click', 'web_browser_snapshot'],
      },
      {
        prompt: 'press the Enter key on the keyboard',
        expected: 'web_browser_press_key',
      },
      {
        prompt: 'wait 3 seconds for the page to finish loading dynamic content',
        expected: 'web_browser_wait',
      },
      {
        prompt: 'save the current browser page as a PDF file',
        expected: 'web_browser_pdf_save',
      },
      {
        prompt: 'show me the browser console error messages',
        expected: 'web_browser_console_messages',
      },
      {
        prompt: 'upload the file resume.pdf to the file input on the page',
        expected: 'web_browser_file_upload',
      },
      {
        prompt: 'show me what network requests the browser page is making',
        expected: 'web_browser_network_requests',
      },
    ];

    for (const tc of cases) runCase('web_browser', tc);
  });

  // ── Orchestrator essentials (7 tools) ───────────────────────

  describe('orchestrator', () => {
    const cases: ToolTestCase[] = [
      {
        prompt: 'send a quick Telegram message to chat 12345 saying "on my way"',
        expected: 'send_telegram',
        alts: ['telegram_send_message'],
      },
      {
        prompt: 'store the fact that I am allergic to peanuts',
        expected: 'store_fact',
        alts: ['memory_store_fact'],
      },
      {
        prompt: 'search my memories for anything about the Barcelona trip',
        expected: 'search_memories',
        alts: ['memory_retrieve_memories'],
      },
      {
        prompt: 'what is the current status of the orchestrator and all MCP servers',
        expected: 'get_status',
      },
      {
        prompt: 'show me the full catalog of all available tools grouped by MCP',
        expected: 'get_tool_catalog',
      },
      {
        prompt: 'check the status of background task ID task_789',
        expected: 'get_job_status',
      },
      {
        prompt: 'run a health check on all connected MCP servers',
        expected: 'system_health_check',
      },
    ];

    for (const tc of cases) runCase('orchestrator', tc);
  });

  // ── Orchestrator actions (3 tools) ──────────────────────────

  describe('orchestrator_actions', () => {
    const cases: ToolTestCase[] = [
      {
        prompt: 'queue a background task to generate the monthly report',
        expected: 'queue_task',
      },
      {
        prompt: 'trigger a one-time backfill of old conversation history',
        expected: 'trigger_backfill',
      },
      {
        prompt: 'spawn a subagent to independently research flight prices to Tokyo',
        expected: 'spawn_subagent',
      },
    ];

    for (const tc of cases) runCase('orchestrator_actions', tc);
  });

  // ── Summary ─────────────────────────────────────────────────

  it.skipIf(skipReason)('print summary', () => {
    if (results.length === 0) return;

    const groups = new Map<string, { total: number; passed: number }>();
    for (const r of results) {
      const g = groups.get(r.group) ?? { total: 0, passed: 0 };
      g.total++;
      if (r.pass) g.passed++;
      groups.set(r.group, g);
    }

    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║       TOOL CATALOG COVERAGE SUMMARY          ║');
    console.log('╠══════════════════════════════════════════════╣');
    for (const [name, g] of groups) {
      const pct = Math.round((g.passed / g.total) * 100);
      const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
      console.log(`║ ${name.padEnd(12)} ${bar} ${g.passed}/${g.total} (${pct}%) ║`);
    }
    const totalPassed = results.filter((r) => r.pass).length;
    const totalTests = results.length;
    const totalPct = Math.round((totalPassed / totalTests) * 100);
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║ TOTAL        ${'█'.repeat(Math.round(totalPct / 5))}${'░'.repeat(20 - Math.round(totalPct / 5))} ${totalPassed}/${totalTests} (${totalPct}%) ║`);
    console.log('╚══════════════════════════════════════════════╝');

    const failures = results.filter((r) => !r.pass);
    if (failures.length > 0) {
      console.log('\nFailed:');
      for (const f of failures) {
        console.log(`  ✗ ${f.tool} — got: ${f.got ?? 'null'} — "${f.prompt}"`);
      }
    }
  });
});
