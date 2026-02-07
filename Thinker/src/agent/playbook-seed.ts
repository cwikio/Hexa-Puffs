/**
 * PlaybookSeed - Default playbook definitions seeded on first startup.
 * Idempotent: existing playbooks are never overwritten.
 */

import type { OrchestratorClient } from '../orchestrator/client.js';
import type { TraceContext } from '../tracing/types.js';

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
1. list_emails with query "is:unread" — get unread emails
2. Scan subject lines and senders for urgency
3. For important or urgent emails, call get_email for full details
4. Present a summary: count of unread, key senders, urgent items
5. Ask if the user wants to reply, archive, or take action on any

## NOTES
- Don't read every email in full — summarize first, drill into details on request
- Group by sender or topic when there are many`,
    required_tools: ['memory_list_emails', 'memory_get_email', 'memory_reply_email'],
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
1. retrieve_memories — check for context about the recipient or topic
2. create_draft with the composed content
3. Show the draft to the user and ask for confirmation
4. send_draft only after user confirms

## NOTES
- Never send without user confirmation
- If replying, use reply_email instead of send_email
- Match tone to context (formal for work, casual for friends)`,
    required_tools: ['memory_create_draft', 'memory_send_draft', 'memory_reply_email'],
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
1. retrieve_memories — check for context about the person or recurring meetings
2. find_free_time or list_events — check current availability
3. If scheduling: create_event with the agreed time
4. If attendees involved: send_message or send_email to notify them

## NOTES
- Always confirm the time with the user before creating
- Use quick_add_event for simple natural language requests
- Check for conflicts before suggesting times`,
    required_tools: ['memory_list_events', 'memory_find_free_time', 'memory_create_event'],
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
User asks to search, research, or find information about a topic.

## STEPS
1. web_search or news_search — find relevant information
2. Summarize the key findings concisely
3. store_fact — save important findings to memory if they seem useful long-term
4. If user wants to share: send_message or send_email with the summary

## NOTES
- Use news_search with freshness="24h" for current events
- Don't overwhelm — present top 3-5 results, offer to dig deeper`,
    required_tools: ['searcher_web_search', 'searcher_news_search', 'memory_store_fact'],
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
1. get_new_messages or get_messages — fetch recent messages
2. retrieve_memories — check context about the conversation or person
3. Present messages to the user with context
4. If replying: send_message with the user's response
5. store_conversation — log the exchange

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
1. list_facts with no category filter — get ALL stored facts
2. get_profile — get the user's profile
3. search_conversations — find relevant past conversations
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
1. list_files or search_files — understand what exists
2. read_file for existing files, create_file for new ones
3. update_file for modifications
4. Confirm the result to the user

## NOTES
- Check grants before writing (check_grant / request_grant)
- Show file contents before overwriting
- Use search_files to find files by content when the name is unknown`,
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
1. list_emails with query "is:unread" — summarize unread email count and key items
2. list_events for today — show upcoming meetings and deadlines
3. news_search for top headlines — brief news overview
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
      keywords: ['who is', 'contact', 'about him', 'about her', 'colleague', 'manager', 'person'],
      priority: 10,
    },
    instructions: `## WHEN TO USE
User asks about a person — who they are, their contact info, or context.

## STEPS
1. retrieve_memories with the person's name — check stored facts
2. list_contacts or search_users — find contact details
3. search_conversations — find past conversations mentioning them
4. Present a combined profile of what you know

## NOTES
- Cross-reference across memory, contacts, and conversations
- If nothing found, say so clearly rather than guessing`,
    required_tools: ['memory_retrieve_memories', 'telegram_list_contacts', 'memory_search_conversations'],
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
    instructions: `## WHEN TO USE
User asks to classify, label, organize, sort, or categorize their emails.

## STEPS
1. list_labels — get existing labels to reuse before creating new ones
2. list_emails with query "is:unread" or a user-specified filter — get emails to classify
3. For each email, call get_email to read subject, sender, and body
4. Decide the appropriate label based on content (e.g., Work, Personal, Finance, Newsletters, Notifications, Receipts)
5. create_label only if a suitable label doesn't exist yet
6. modify_labels to apply the chosen label to each email
7. Summarize what was classified: count per label, any emails that were unclear

## NOTES
- Always check existing labels first — avoid creating duplicates
- Ask the user for their preferred categories if this is the first time
- Process in batches if there are many emails — summarize progress
- Skip emails that already have user-applied labels unless asked to reclassify`,
    required_tools: ['gmail_list_labels', 'gmail_list_emails', 'gmail_get_email', 'gmail_create_label', 'gmail_modify_labels'],
    max_steps: 10,
    notify_on_completion: false,
  },
];

/**
 * Seed default playbooks into Memorizer if they don't already exist.
 * Idempotent — never overwrites existing playbooks.
 */
export async function seedPlaybooks(
  orchestrator: OrchestratorClient,
  agentId: string,
  trace?: TraceContext
): Promise<number> {
  const { skills: existing } = await orchestrator.listSkills(agentId, 'event', undefined, trace);
  const existingNames = new Set(existing.map((s) => s.name as string));

  let seeded = 0;

  for (const playbook of DEFAULT_PLAYBOOKS) {
    if (existingNames.has(playbook.name)) continue;

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
      console.error(`Failed to seed playbook "${playbook.name}":`, response.error);
    }
  }

  if (seeded > 0) {
    console.log(`Seeded ${seeded} playbook(s) (${existing.length} already existed)`);
  }

  return seeded;
}
