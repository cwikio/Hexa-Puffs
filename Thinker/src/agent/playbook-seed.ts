/**
 * PlaybookSeed - Default playbook definitions seeded on first startup.
 * Idempotent: existing playbooks are never overwritten.
 */

import type { OrchestratorClient } from '../orchestrator/client.js';
import type { TraceContext } from '../tracing/types.js';
import { Logger } from '@mcp/shared/Utils/logger.js';

const logger = new Logger('thinker:playbook-seed');

interface PlaybookSeed {
  name: string;
  description: string;
  trigger_type: 'event';
  trigger_config: {
    keywords: string[];
    priority: number;
  };
  instructions: string;
  required_tools: string[];
  max_steps: number;
  notify_on_completion: boolean;
}

const DEFAULT_PLAYBOOKS: PlaybookSeed[] = [
  {
    name: 'email-triage',
    description: 'Check, read, and summarize unread emails',
    trigger_type: 'event',
    trigger_config: {
      keywords: ['email', 'inbox', 'unread', 'mail', 'gmail', 'check email', 'check my email'],
      priority: 10,
    },
    instructions: `## WHEN TO USE
User asks to check, read, triage, or summarize their inbox or emails.

## STEPS
1. gmail_list_emails with query "is:unread" — get unread emails
2. Scan subject lines and senders for urgency
3. For important or urgent emails, call gmail_get_email for full details
4. Present a summary: count of unread, key senders, urgent items
5. Ask if the user wants to reply, archive, or take action on any

## NOTES
- Don't read every email in full — summarize first, drill into details on request
- Group by sender or topic when there are many`,
    required_tools: ['gmail_list_emails', 'gmail_get_email', 'gmail_reply_email'],
    max_steps: 8,
    notify_on_completion: false,
  },
  {
    name: 'email-compose',
    description: 'Compose and send emails',
    trigger_type: 'event',
    trigger_config: {
      keywords: ['send email', 'write email', 'compose email', 'draft email', 'reply email', 'email to'],
      priority: 10,
    },
    instructions: `## WHEN TO USE
User asks to write, send, or reply to an email.

## STEPS
1. memory_retrieve_memories — check for context about the recipient or topic
2. gmail_create_draft with the composed content
3. Show the draft to the user and ask for confirmation
4. gmail_send_draft only after user confirms

## NOTES
- Never send without user confirmation
- If replying, use gmail_reply_email instead of gmail_send_email
- Match tone to context (formal for work, casual for friends)`,
    required_tools: ['gmail_create_draft', 'gmail_send_draft', 'gmail_reply_email'],
    max_steps: 8,
    notify_on_completion: false,
  },
  {
    name: 'schedule-meeting',
    description: 'Check availability and create calendar events',
    trigger_type: 'event',
    trigger_config: {
      keywords: ['meeting', 'calendar', 'schedule', 'event', 'appointment', 'free time', 'busy'],
      priority: 10,
    },
    instructions: `## WHEN TO USE
User asks to schedule something, check their calendar, or find available time.

## STEPS
1. memory_retrieve_memories — check for context about the person or recurring meetings
2. gmail_find_free_time or gmail_list_events — check current availability
3. If scheduling: gmail_create_event with the agreed time
4. If attendees involved: telegram_send_message or gmail_send_email to notify them

## NOTES
- Always confirm the time with the user before creating
- Use gmail_quick_add_event for simple natural language requests
- Check for conflicts before suggesting times
- Use ISO 8601 datetime format for time parameters (e.g., '2026-01-15T09:00:00Z')`,
    required_tools: ['gmail_list_events', 'gmail_find_free_time', 'gmail_create_event'],
    max_steps: 8,
    notify_on_completion: false,
  },
  {
    name: 'research-and-share',
    description: 'Search the web for information and optionally share findings',
    trigger_type: 'event',
    trigger_config: {
      keywords: ['search for', 'find out', 'look up', 'research', 'what is', 'tell me about', 'latest news'],
      priority: 5,
    },
    instructions: `## WHEN TO USE
User asks to search, research, or find information about a topic. Also when user provides a URL and wants to know what's on the page.

## STEPS
1. If the user provides a specific URL: use searcher_web_fetch to read the page content directly
2. If searching for a topic: searcher_web_search or searcher_news_search — find relevant information
3. If search results have promising URLs: use searcher_web_fetch to read the full article content
4. Summarize the key findings concisely
5. store_fact — save important findings to memory if they seem useful long-term
6. If user wants to share: telegram_send_message or gmail_send_email with the summary

## NOTES
- Use searcher_web_fetch (not browser) to read webpage content — it's much faster
- Use searcher_news_search with freshness="24h" for current events
- Don't overwhelm — present top 3-5 results, offer to dig deeper
- Only fall back to browser tools if web_fetch returns empty or unusable content
- ALWAYS include source URLs at the bottom of your response (Sources: section with clickable links)`,
    required_tools: ['searcher_web_search', 'searcher_news_search', 'searcher_web_fetch', 'memory_store_fact'],
    max_steps: 8,
    notify_on_completion: false,
  },
  {
    name: 'telegram-conversation',
    description: 'Read and reply to Telegram messages',
    trigger_type: 'event',
    trigger_config: {
      keywords: ['telegram message', 'check telegram', 'telegram chat', 'reply on telegram'],
      priority: 10,
    },
    instructions: `## WHEN TO USE
User asks about Telegram messages or wants to reply to someone on Telegram.

## STEPS
1. telegram_get_new_messages or telegram_get_messages — fetch recent messages
2. memory_retrieve_memories — check context about the conversation or person
3. Present messages to the user with context
4. If replying: telegram_send_message with the user's response
5. memory_store_conversation — log the exchange

## NOTES
- Mark messages as read after presenting them
- Include chat/sender context when summarizing`,
    required_tools: ['telegram_get_new_messages', 'telegram_send_message'],
    max_steps: 8,
    notify_on_completion: false,
  },
  {
    name: 'memory-recall',
    description: 'Recall everything stored in memory about a topic or person',
    trigger_type: 'event',
    trigger_config: {
      keywords: ['remember', 'what do you know', 'what did i tell you', 'memory', 'recall', 'what have you learned'],
      priority: 15,
    },
    instructions: `## WHEN TO USE
User asks what you remember, know, or have learned about them or a topic.

## STEPS
1. memory_list_facts with no category filter — get ALL stored facts
2. memory_get_profile — get the user's profile
3. memory_search_conversations — find relevant past conversations
4. Present an organized summary grouped by category

## NOTES
- Never ask "what specifically?" — always do a full recall first
- Group facts by category (preference, background, project, contact, etc.)
- This overrides the default behavior — be thorough`,
    required_tools: ['memory_list_facts', 'memory_get_profile', 'memory_search_conversations'],
    max_steps: 8,
    notify_on_completion: false,
  },
  {
    name: 'file-operations',
    description: 'Read, write, and manage workspace files',
    trigger_type: 'event',
    trigger_config: {
      keywords: ['file', 'document', 'save to file', 'read file', 'write file', 'workspace'],
      priority: 5,
    },
    instructions: `## WHEN TO USE
User asks to create, read, update, or manage files in the workspace.

## STEPS
1. filer_list_files or filer_search_files — understand what exists
2. filer_read_file for existing files, filer_create_file for new ones
3. filer_update_file for modifications
4. Confirm the result to the user

## NOTES
- Check grants before writing (filer_check_grant / filer_request_grant)
- Show file contents before overwriting
- Use filer_search_files to find files by content when the name is unknown`,
    required_tools: ['filer_list_files', 'filer_read_file', 'filer_create_file', 'filer_update_file'],
    max_steps: 8,
    notify_on_completion: false,
  },
  {
    name: 'daily-briefing',
    description: 'Combined overview of emails, calendar, and news',
    trigger_type: 'event',
    trigger_config: {
      keywords: ['daily briefing', 'morning briefing', 'briefing', "what's happening", 'daily summary', 'overview'],
      priority: 15,
    },
    instructions: `## WHEN TO USE
User asks for a daily briefing, morning summary, or general overview.

## STEPS
1. gmail_list_emails with query "is:unread" — summarize unread email count and key items
2. gmail_list_events for today — show upcoming meetings and deadlines
3. searcher_news_search for top headlines — brief news overview
4. Present all three sections in a compact format

## NOTES
- Keep each section to 3-5 bullet points max
- Highlight anything urgent or time-sensitive
- This is a summary — don't go deep, offer to drill into any section`,
    required_tools: ['gmail_list_emails', 'gmail_list_events', 'searcher_news_search'],
    max_steps: 10,
    notify_on_completion: false,
  },
  {
    name: 'contact-lookup',
    description: 'Find information about a person across memory and contacts',
    trigger_type: 'event',
    trigger_config: {
      keywords: ['who is', 'contact', 'about him', 'about her', 'colleague', 'manager', 'person', 'his email', 'her email', 'email address', 'email of', "'s email", 'find email', 'email'],
      priority: 10,
    },
    instructions: `## WHEN TO USE
User asks about a person — who they are, their contact info, email, or context.

## STEPS
1. memory_retrieve_memories with the person's name — check stored facts
2. gmail_list_emails with from:[name] or to:[name] — find email address from correspondence
3. telegram_list_contacts or telegram_search_users — find contact details on Telegram
4. memory_search_conversations — find past conversations mentioning them
5. Present a combined profile of what you know

## NOTES
- Cross-reference across memory, Gmail, contacts, and conversations
- Gmail is the best source for finding someone's email address — search for emails from/to them
- If nothing found, say so clearly rather than guessing`,
    required_tools: ['memory_retrieve_memories', 'gmail_list_emails', 'telegram_list_contacts', 'memory_search_conversations'],
    max_steps: 8,
    notify_on_completion: false,
  },
  {
    name: 'email-classify',
    description: 'Classify emails and apply labels for automatic inbox organization',
    trigger_type: 'event',
    trigger_config: {
      keywords: ['classify email', 'label email', 'organize inbox', 'sort email', 'categorize email', 'tag email', 'organize email'],
      priority: 10,
    },
    instructions: `You MUST follow these steps exactly. Do NOT skip steps. Do NOT store skills or facts. Do NOT send multiple messages.

STEP 1: Call gmail_list_labels to get all existing labels (you need their IDs).
STEP 2: Call gmail_list_emails with query "is:unread" (or user-specified filter), max_results 20.
STEP 3: For each email, call gmail_modify_labels with the label NAME that best fits (the tool resolves names to IDs automatically). Use categories: Work, Personal, Finance, Newsletters, Notifications, Social. Prefer existing labels from step 1.
STEP 4: Call gmail_create_label ONLY if no existing label fits.
STEP 5: Send ONE short Telegram summary: "Classified X emails: Y Work, Z Personal, ..." — no per-email details.

CONSTRAINTS:
- Do NOT call memory_store_skill or memory_store_fact
- Do NOT send more than ONE Telegram message
- Do NOT list or summarize individual email contents
- Skip emails that already have user-applied labels
- If you need to read an email's body to decide, call gmail_get_email — but prefer classifying by subject/sender/snippet alone`,
    required_tools: ['gmail_list_labels', 'gmail_list_emails', 'gmail_get_email', 'gmail_create_label', 'gmail_modify_labels'],
    max_steps: 6,
    notify_on_completion: false,
  },
  {
    name: 'system-health-check',
    description: 'Check system status, what services are running, what is broken',
    trigger_type: 'event',
    trigger_config: {
      keywords: [
        "what's broken",
        'what is broken',
        'system status',
        'health check',
        'are you ok',
        'are you working',
        'is everything running',
        "what's running",
        'what is running',
        'service status',
        'any issues',
        'any problems',
        'diagnostics',
      ],
      priority: 15,
    },
    instructions: `## WHEN TO USE
User asks about system health, what's working/broken, or general diagnostics.

## STEPS
1. Call get_status to get full system status
2. Check each MCP service for availability
3. Check agent status (paused, restart count, availability)
4. Present a clear summary:
   - Services that are UP
   - Services that are DOWN or degraded
   - Agents that are paused or restarting
   - Overall assessment (all good, or specific issues)

## NOTES
- If everything is healthy, say so concisely
- If something is down, highlight it prominently
- Mention cost-paused agents explicitly with their pause reason
- The /status slash command provides the same info faster without using tokens`,
    required_tools: ['get_status'],
    max_steps: 4,
    notify_on_completion: false,
  },
  {
    name: 'message-cleanup',
    description: 'Clean up, delete, or purge messages from a chat',
    trigger_type: 'event',
    trigger_config: {
      keywords: [
        'clean up messages',
        'clean up',
        'cleanup messages',
        'cleanup',
        'delete messages',
        'clear messages',
        'purge messages',
        'remove messages',
        'clear chat',
        'clean test messages',
        'delete test messages',
      ],
      priority: 10,
    },
    instructions: `## WHEN TO USE
User asks to clean up, delete, or purge messages from a Telegram chat.

## STEPS
1. Ask the user for scope if not specified: how many messages, or what time range
2. Call telegram_get_messages to fetch the messages in scope
3. Confirm with the user how many messages will be deleted
4. Call telegram_delete_messages with the message IDs
5. Report how many were deleted

## NOTES
- Always confirm before deleting
- For large deletions, process in batches of 100
- The /delete slash command is faster for deterministic deletions (e.g. /delete today, /delete 50)
- telegram_get_messages max is 100 per call — paginate with offset_id if needed`,
    required_tools: ['telegram_get_messages', 'telegram_delete_messages'],
    max_steps: 8,
    notify_on_completion: false,
  },
  {
    name: 'web-browsing',
    description: 'Browse websites, extract information, fill forms, and take screenshots',
    trigger_type: 'event',
    trigger_config: {
      keywords: [
        'browse', 'website', 'webpage', 'open page', 'go to', 'visit site',
        'screenshot', 'scrape', 'fill form', 'login site', 'web page',
        'www', 'http', 'navigate to', 'open url',
      ],
      priority: 10,
    },
    instructions: `## WHEN TO USE
User asks to interact with a website: fill forms, click buttons, take screenshots, login, or navigate multi-page flows. NOT for just reading page content — use web_fetch for that.

## IMPORTANT: web_fetch vs browser
- If the user just wants to READ a page's content → use searcher_web_fetch instead (much faster)
- Only use browser tools when you need to INTERACT with the page (click, scroll, fill forms, login, screenshot)
- If web_fetch was already tried and returned empty/unusable content, then use browser as fallback

## STEPS
1. web_browser_navigate — go to the requested URL
2. web_browser_snapshot — get the accessibility tree to understand page structure
3. Read the snapshot to find relevant content, links, buttons, or form fields (identified by [ref] numbers)
4. Interact as needed:
   - web_browser_click with the ref number to click links or buttons
   - web_browser_type with the ref number and text to type into inputs
   - web_browser_fill_form to fill multiple form fields at once
   - web_browser_navigate_back to go back to the previous page
5. web_browser_snapshot again after each interaction to see the updated page
6. web_browser_take_screenshot if the user wants a visual capture
7. Summarize the extracted information to the user

## NOTES
- Always snapshot after navigating or clicking — the page may have changed
- Use ref numbers from the snapshot to target elements (e.g., click ref "5" for a link shown as [5])
- web_browser_tabs can list, open, close, or switch tabs if multi-tab browsing is needed
- For forms: prefer web_browser_fill_form over individual type calls when filling multiple fields
- If a page requires login, fill credentials step by step and confirm before submitting
- Keep interactions minimal — navigate, snapshot, extract, done
- Call web_browser_close when you are completely done browsing to free resources`,
    required_tools: [
      'web_browser_navigate', 'web_browser_snapshot', 'web_browser_click',
      'web_browser_type', 'web_browser_take_screenshot', 'web_browser_tabs',
      'web_browser_fill_form', 'web_browser_navigate_back', 'web_browser_close',
    ],
    max_steps: 10,
    notify_on_completion: false,
  },
  {
    name: 'cron-scheduling',
    description: 'Create recurring cron jobs or scheduled skills from natural language',
    trigger_type: 'event',
    trigger_config: {
      keywords: [
        'cron', 'remind me', 'recurring', 'every minute', 'every hour', 'every day',
        'every week', 'every month', 'every morning', 'every evening',
        'schedule task', 'background job', 'repeat', 'daily at', 'weekly',
        'hourly', 'once a day', 'once a week', 'times a day', 'times a week',
        'per minute', 'per hour', 'per day',
      ],
      priority: 10,
    },
    instructions: `## WHEN TO USE
User wants to set up a recurring task, reminder, or scheduled job.

## CHOOSING THE RIGHT TOOL
There are two options — pick based on complexity:

**Option A: Cron Job (create_job)** — ONLY for fixed, single-step actions where the exact same tool call runs every time.
Examples: "remind me to drink water at 9am", "send me 'good morning' every day"
- Runs ONE tool call with the exact same parameters every time
- The result is NOT sent to the user — so the action itself must deliver (e.g., telegram_send_message)
- Zero cost per execution (no LLM tokens)

**Option B: Scheduled Skill (memory_store_skill with trigger_type "cron")** — for ANYTHING that needs reading, deciding, classifying, summarizing, or multiple steps.
Examples: "classify my emails daily", "prune/organize my inbox every morning", "send me an article from onet.pl every hour", "every morning summarize my unread emails", "weekly review of my calendar", "archive old newsletters daily"
- A full AI reasoning loop runs each execution — can search, read, decide, and SEND results
- Use this whenever the task involves fetching data AND making decisions about it
- Costs LLM tokens per execution

**IMPORTANT — ALWAYS use scheduled skill (Option B) for:**
- Email operations: classify, prune, organize, archive, label, sort, triage, clean up
- Anything that reads data and makes decisions based on content
- Tasks where different inputs produce different actions each run
- Multi-step workflows (list → read → decide → act)

**Only use cron job (Option A) for:** fixed reminders, static notifications, single deterministic tool calls with hardcoded parameters.

## STEPS FOR CRON JOBS (Option A)
1. Parse the user's schedule into a cron expression:
   - "every day at 9am" → "0 9 * * *"
   - "every hour" → "0 * * * *"
   - "every 5 minutes" → "*/5 * * * *"
   - "every Monday at 8am" → "0 8 * * 1"
   - "every weekday at 9am" → "0 9 * * 1-5"
2. Determine the action — usually telegram_send_message with the reminder text
3. Confirm with user: "I'll create a cron job that sends you '[message]' every day at 9:00 AM. OK?"
4. Call create_job with type "cron", the cron expression, and the action. Do NOT specify timezone — it is auto-detected by the system.

## STEPS FOR SCHEDULED SKILLS (Option B)
1. Parse the schedule (same cron expression rules as above)
2. Write clear natural language instructions describing what the AI should do each run
3. Confirm with user
4. Call memory_store_skill with:
   - trigger_type: "cron"
   - trigger_config: { "schedule": "<cron>" }  (timezone is auto-injected by the system)
   - instructions: the natural language task description
   - agent_id: "thinker"

## AUTO-EXPIRATION
- For limited runs: set maxRuns (e.g., "5 times" → maxRuns: 5)
- For date limits: set expiresAt as ISO date (e.g., "until Friday" → compute the ISO date for next Friday midnight)
- For duration: compute expiresAt from now + duration (e.g., "for 20 days" → now + 20 days as ISO)
- Both can be combined — whichever limit is hit first stops the job
- Omit both for permanent cron jobs

## NOTES
- Timezone is auto-detected by the system — do NOT specify timezone unless the user explicitly requests a different one
- Use list_jobs to show existing cron jobs, memory_list_skills for existing skills
- Cron format: "minute hour day month weekday" (e.g., "0 9 * * *" = 9:00 AM daily)
- Always confirm the schedule before creating — mistakes are hard to undo
- If the task only sends a fixed message → cron job. Otherwise → scheduled skill.`,
    required_tools: ['create_job', 'list_jobs', 'delete_job', 'memory_store_skill', 'memory_list_skills'],
    max_steps: 6,
    notify_on_completion: false,
  },
  {
    name: 'vercel-deployments',
    description: 'Check Vercel deployments, build logs, and project status',
    trigger_type: 'event',
    trigger_config: {
      keywords: [
        'vercel', 'deployment', 'deploy', 'build log', 'build error',
        'production deploy', 'preview deploy', 'vercel project',
        'vercel status', 'deployment status', 'build status',
      ],
      priority: 10,
    },
    instructions: `## WHEN TO USE
User asks about software deployments, build logs, project status, or deployment errors.

## AVAILABLE TOOLS
IMPORTANT: Only these Vercel tools exist. Do NOT call vercel_list_teams, vercel_list_projects, or any other tool not listed here:
- vercel_getDeployments — list deployments (optionally filter by project name via "app" param, state, target)
- vercel_getDeployment — get details for a specific deployment by ID
- vercel_getDeploymentEvents — get build logs/events for a deployment
- vercel_listDeploymentFiles — list files in a deployment
- vercel_getDeploymentFileContents — read a specific file from a deployment

## CRITICAL PARAMETER RULES
- NEVER pass teamId or slug parameters — the API token handles scope automatically
- Passing made-up teamId/slug values causes 403 Forbidden errors
- The only required parameter is deploymentId (for single-deployment tools) or no params for getDeployments

## STEPS
1. vercel_getDeployments — list recent deployments. Use "app" param to filter by project name if mentioned. Do NOT pass teamId or slug.
2. Identify the relevant deployment from the list — note its deployment ID (starts with "dpl_")
3. vercel_getDeployment with the real deployment ID from step 1 — get full details (status, URL, errors)
4. If user asks about logs/errors: vercel_getDeploymentEvents with the deployment ID
5. Present: project name, deployment state, URL, any errors or warnings from the logs

## NOTES
- There is no list_teams or list_projects tool — start with getDeployments which returns project info
- Deployment states: READY, ERROR, BUILDING, QUEUED, CANCELED
- Filter getDeployments by target="production" for prod-only views
- Use "app" parameter (not "project" or "name") to filter by project name
- ALWAYS use real IDs from API responses — never guess or make up IDs`,
    required_tools: [
      'vercel_getDeployments', 'vercel_getDeployment', 'vercel_getDeploymentEvents',
      'vercel_listDeploymentFiles', 'vercel_getDeploymentFileContents',
    ],
    max_steps: 8,
    notify_on_completion: false,
  },
];

/**
 * Seed default playbooks into Memorizer.
 * Creates new playbooks and updates existing ones if instructions have changed.
 */
export async function seedPlaybooks(
  orchestrator: OrchestratorClient,
  agentId: string,
  trace?: TraceContext
): Promise<number> {
  const { skills: existing } = await orchestrator.listSkills(agentId, 'event', undefined, trace);
  const existingByName = new Map(existing.map((s) => [s.name as string, s]));

  let seeded = 0;
  let updated = 0;

  for (const playbook of DEFAULT_PLAYBOOKS) {
    const existingSkill = existingByName.get(playbook.name);

    if (existingSkill) {
      // Update if instructions changed
      if ((existingSkill.instructions as string) !== playbook.instructions) {
        const updateResponse = await orchestrator.executeTool(
          'memory_update_skill',
          {
            skill_id: existingSkill.id as number,
            instructions: playbook.instructions,
            description: playbook.description,
            required_tools: playbook.required_tools,
            max_steps: playbook.max_steps,
          },
          trace
        );
        if (updateResponse.success) {
          updated++;
        } else {
          logger.error(`Failed to update playbook "${playbook.name}"`, updateResponse.error);
        }
      }
      continue;
    }

    const response = await orchestrator.executeTool(
      'memory_store_skill',
      {
        agent_id: agentId,
        name: playbook.name,
        description: playbook.description,
        trigger_type: playbook.trigger_type,
        trigger_config: playbook.trigger_config,
        instructions: playbook.instructions,
        required_tools: playbook.required_tools,
        max_steps: playbook.max_steps,
        notify_on_completion: playbook.notify_on_completion,
      },
      trace
    );

    if (response.success) {
      seeded++;
    } else {
      logger.error(`Failed to seed playbook "${playbook.name}"`, response.error);
    }
  }

  if (seeded > 0 || updated > 0) {
    logger.info(`Playbooks: ${seeded} seeded, ${updated} updated (${existing.length} total)`);
  }

  return seeded + updated;
}
