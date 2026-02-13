# ~~Tool Calling Analysis: Annabelle vs OpenClaw~~ ✅

## Summary

The Thinker agent system has persistent tool calling failures. After comparing with OpenClaw's architecture and reading the actual code, the root cause is NOT the model (Llama 3.3 70B) — it's how tools are presented to the model. The #1 issue is **playbook instructions using wrong tool names**, compounded by **conflicting instructions between persona file and playbooks**.

---

## Issue 1 (PRIMARY): Playbook Instructions Use Wrong Tool Names

13 out of 15 playbooks reference tool names that don't match the actual tools the model sees in schemas. The Orchestrator prefixes all tools (`gmail_list_emails`, `filer_create_file`, etc.), but playbook instructions use unprefixed or completely wrong names.

**File:** `Thinker/src/agent/playbook-seed.ts`

### CRITICAL — Complete Wrong Names

| Playbook | Instructions say | Actual tool name | Notes |
|---|---|---|---|
| **web-browsing** | `web_browser_navigate` | `browser_navigate` | ALL 9 browser tools wrong prefix |
| **web-browsing** | `web_browser_snapshot` | `browser_snapshot` | |
| **web-browsing** | `web_browser_click` | `browser_click` | |
| **web-browsing** | `web_browser_type` | `browser_type` | |
| **web-browsing** | `web_browser_take_screenshot` | `browser_take_screenshot` | |
| **web-browsing** | `web_browser_tabs` | `browser_tabs` | |
| **web-browsing** | `web_browser_fill_form` | `browser_fill_form` | |
| **web-browsing** | `web_browser_navigate_back` | `browser_navigate_back` | |
| **web-browsing** | `web_browser_close` | `browser_close` | |
| **schedule-meeting** | required_tools: `memory_list_events` | `gmail_list_events` | Tools DON'T EXIST |
| **schedule-meeting** | required_tools: `memory_find_free_time` | `gmail_find_free_time` | Tools DON'T EXIST |
| **schedule-meeting** | required_tools: `memory_create_event` | `gmail_create_event` | Tools DON'T EXIST |
| **message-cleanup** | `get_telegram_messages` | `telegram_get_messages` | Prefix in wrong position |

### Unprefixed Names (model must guess prefix)

| Playbook | Instructions say | Actual tool name |
|---|---|---|
| **email-triage** | `list_emails` | `gmail_list_emails` |
| **email-triage** | `get_email` | `gmail_get_email` |
| **email-compose** | `create_draft` | `gmail_create_draft` |
| **email-compose** | `send_draft` | `gmail_send_draft` |
| **email-compose** | `reply_email` | `gmail_reply_email` |
| **email-compose** | `retrieve_memories` | `memory_retrieve_memories` |
| **schedule-meeting** | `retrieve_memories` | `memory_retrieve_memories` |
| **schedule-meeting** | `send_message` | `telegram_send_message` |
| **research-and-share** | `web_fetch` | `searcher_web_fetch` |
| **research-and-share** | `web_search` | `searcher_web_search` |
| **research-and-share** | `news_search` | `searcher_news_search` |
| **telegram-conversation** | `get_new_messages` | `telegram_get_new_messages` |
| **telegram-conversation** | `get_messages` | `telegram_get_messages` |
| **telegram-conversation** | `retrieve_memories` | `memory_retrieve_memories` |
| **telegram-conversation** | `send_message` | `telegram_send_message` |
| **telegram-conversation** | `store_conversation` | `memory_store_conversation` |
| **memory-recall** | `list_facts` | `memory_list_facts` |
| **memory-recall** | `get_profile` | `memory_get_profile` |
| **memory-recall** | `search_conversations` | `memory_search_conversations` |
| **file-operations** | `list_files` | `filer_list_files` |
| **file-operations** | `read_file` | `filer_read_file` |
| **file-operations** | `create_file` | `filer_create_file` |
| **file-operations** | `update_file` | `filer_update_file` |
| **file-operations** | `search_files` | `filer_search_files` |
| **file-operations** | `check_grant` | `filer_check_grant` |
| **file-operations** | `request_grant` | `filer_request_grant` |
| **daily-briefing** | `list_emails` | `gmail_list_emails` |
| **daily-briefing** | `list_events` | `gmail_list_events` |
| **daily-briefing** | `news_search` | `searcher_news_search` |
| **contact-lookup** | `list_contacts` | `telegram_list_contacts` |
| **contact-lookup** | `search_users` | `telegram_search_users` |

### Correct (only 2 of 15 playbooks)

| Playbook | Status |
|---|---|
| **email-classify** | All tool names correct |
| **vercel-deployments** | All tool names correct |

---

## Issue 1b: Persona File and Playbooks Contradict Each Other

**File:** `~/.annabelle/agents/annabelle/instructions.md` (145 lines, ~2,700 tokens)

The persona file already contains detailed tool guidance with CORRECT prefixed names:

```text
## Email (Gmail)
- gmail_send_email: Send a new email (to, subject, body required)
- gmail_reply_email: Reply to an existing email
- gmail_list_emails: List/search emails

## Calendar (Google Calendar)
- gmail_list_events: List upcoming events
- gmail_create_event: Create a new event

## Your Memory System
- memory_retrieve_memories or search_memories
- memory_list_facts
- memory_search_conversations
```

But the playbooks inject DIFFERENT instructions about the SAME operations with WRONG names. The model sees BOTH in a single system prompt:

1. From instructions.md: "use `gmail_list_emails`" (correct)
2. From email-triage playbook: "1. `list_emails` with query 'is:unread'" (wrong)

This is a direct conflict. The model has to choose between two contradictory instructions about the same operation.

### Section-by-Section Analysis of instructions.md

**OVERLAPS WITH PLAYBOOKS — candidates for removal:**

| Section | Lines | Overlapping playbook | What to do |
|---|---|---|---|
| `## Your Memory System` | 19-27 | `memory-recall` playbook | REMOVE tool catalog. The "when to use" behavioral trigger is covered by playbook keywords. |
| `## Handling "About Me" Questions` | 29-35 | `memory-recall` playbook (same "never ask what specifically" rule) | REMOVE — fully duplicated. |
| `## Web Search Tool` | 70-75 | `research-and-share` playbook + tool description already has params | REMOVE — parameter list is in the tool schema. |
| `## Email (Gmail)` | 97-104 | `email-triage`, `email-compose` playbooks | REMOVE — tool catalog, once playbook names are fixed this is pure duplication. |
| `## Calendar (Google Calendar)` | 106-116 | `schedule-meeting` playbook | REMOVE — but move ISO 8601 format hint into playbook instructions. |

**UNIQUE — must keep (no playbook covers these):**

| Section | Lines | Why it's unique |
|---|---|---|
| `## TOOL CALLING RULES` | 1-12 | Core behavioral rules (also note: partially duplicates TOOL_PREAMBLE in loop.ts, but adds rules 5-8 which are unique) |
| Persona (lines 15-17) | 15-17 | Identity and tone |
| `## Proactive Learning` | 37-46 | No playbook — behavioral rule about when to store facts |
| `## Status Queries` | 48-52 | Overlaps `system-health-check` but adds format example |
| `## Subagents` | 54-61 | No playbook — unique capability guidance |
| `## Tool Use Guidelines` | 63-68 | Meta-behavioral rules about tool use in general |
| `## Image Search` | 77-83 | No playbook — and includes critical `telegram_send_media` workflow |
| `## Source Citations (MANDATORY)` | 85-95 | More detailed than playbook mention — cross-cutting rule |
| `## Data Authority` | 118-122 | No playbook — critical rule: tool results override memory |
| `## Handling New Contact Info` | 124-136 | No playbook — Email Processor integration |
| `## Ignoring Email Senders` | 131-136 | No playbook — Email Processor integration |
| `## New Project / Company Discovery` | 138-144 | No playbook — Email Processor integration |

### Additional Conflict: TOOL_PREAMBLE vs instructions.md

The system prompt starts with TOOL_PREAMBLE (from `loop.ts:39-43`):
```text
Always use the structured function calling API. NEVER write tool calls as text/JSON/XML.
You CANNOT perform actions without calling tools — text claims without tool calls are lies.
If a tool fails, retry once or explain honestly.
ONLY call tools that are in the provided tool list. Do NOT invent or hallucinate tool names.
```

Then the persona file starts with `## TOOL CALLING RULES` (lines 1-12) which restates the same 4 rules PLUS adds 4 more unique ones (rules 5-8). The model sees both. They don't contradict, but they're redundant — the TOOL_PREAMBLE rules are a strict subset of the instructions.md rules.

**Fix:** Remove TOOL_PREAMBLE from loop.ts and let instructions.md own all tool calling rules. OR merge instructions.md rules into TOOL_PREAMBLE and remove from instructions.md. Either way, one source of truth.

**What OpenClaw does differently:** Each prompt file has a single responsibility:
- `SOUL.md` — persona/tone ONLY (no tool guidance)
- `TOOLS.md` — tool guidance ONLY (no persona)
- `SKILL.md` — per-skill workflow ONLY (not duplicated elsewhere)

No overlap = no contradictions.

---

## Issue 2: Groq API Has Tool Calling Quirks

Provider-specific, NOT model-specific:
- `toolChoice: 'required'` crashes on step 2+ (`loop.ts:635-641`)
- Groq sometimes returns tool calls as JSON text instead of structured API calls (`recover-tool-call.ts`)

Same Llama model via different provider (Together AI, Fireworks) might not have these issues.

**Files:** `Thinker/src/agent/loop.ts`, `Thinker/src/utils/recover-tool-call.ts`

---

## Issue 3: Tool Descriptions — Actually Decent, Not the Root Cause

### What Annabelle's Tool Descriptions Actually Look Like

Initially suspected as "bare one-liners" — this was wrong. The actual descriptions are quite detailed. The ToolRouter also prepends `[Service | Group]` tags. Real examples:

**Searcher — web_search:**
> `[Web Search | Web Search] Search the web for current information, documentation, or any topic. Do NOT use for questions answerable from your own knowledge.`
> Args: query, count, freshness, safesearch
> Returns: `{ results: [{ title, url, description, age? }], total_count, query }`

**Filer — read_file:**
> `[Filer | File Management] Read a file's contents. Workspace files use relative paths. External files require absolute paths and an active grant (check with check_grant first).`

**Gmail — send_email:**
> `[Gmail | Email] Send a new email via Gmail. Use this for email — for Telegram messages use send_message instead. To reply to an existing thread, use reply_email instead of this.`

**Memorizer — retrieve_memories:**
> `[Memorizer | Memory] Search across both facts and past conversations by keyword. This is the primary memory lookup tool — use it when the user asks "do you remember"... For browsing all facts by category use list_facts. For searching only past chat transcripts with date filters use search_conversations.`

### What OpenClaw's SKILL.md Descriptions Look Like

**Slack:**
```text
react: channelId, messageId, emoji
sendMessage: to (channel:<id> or user:<id>), content
editMessage: channelId, messageId, content
```

**GitHub:**
```text
gh pr checks 55 --repo owner/repo
gh run list --repo owner/repo --limit 10
gh run view <run-id> --repo owner/repo --log-failed
```

**1Password:**
```text
## Workflow
1. Check OS + shell.
2. Verify CLI present: op --version
3. REQUIRED: create a fresh tmux session for all op commands
4. Sign in / authorize inside tmux: op signin
## Guardrails
- Never paste secrets into logs, chat, or code.
- Do not run op outside tmux
```

### Comparison

| Aspect | Annabelle | OpenClaw |
|---|---|---|
| Parameter docs | Inline in description (Args/Returns) | In SKILL.md + schema |
| Cross-tool hints | Good ("use X instead of Y") | Good (workflow steps) |
| Service tagging | `[Service \| Group]` prefix | Not needed (stable set) |
| Concrete examples | Minimal | Real command examples with flags |
| Disambiguation | Good ("for email use X, for telegram use Y") | Via separate skills (no overlap) |

**Verdict:** Annabelle's descriptions are good. The main gap vs OpenClaw is **concrete parameter examples** (OpenClaw shows exact commands). But this is NOT the primary failure cause — the playbook name conflicts are.

---

## Non-Issues (Previously Suspected)

### System Prompt Size — NOT a problem

Real measurements from logs:

| Component | Tokens |
|---|---|
| TOOL_PREAMBLE | ~61 |
| Persona file (instructions.md) | ~2,700 |
| Date/time + chat_id | ~40 |
| Matched playbooks (typical 1-3) | ~200-800 |
| Skills XML | ~100-500 |
| Memories (5 facts) | ~200-400 |
| **System prompt total** | **~4,200-4,600** |
| Tool schemas (25 tools x ~200 avg) | ~5,000 |
| Conversation history (20 msgs) | ~3,000 |
| **Total per request** | **~12,600 (6.3% of context window)** |

The prompt isn't too big. The problem is quality (contradictions), not quantity.

### Dynamic Tool Surface — NOT the primary problem

- Within a single turn, tool set is stable (all 8 maxSteps see same tools)
- Sticky tools carry forward from last 3 turns (cap 8)
- Total cap is 25 tools
- Edge case issue in 4+ domain conversations, but not the main failure mode
- The real problem: `required_tools` arrays in playbooks also have wrong names, so force-injection fails silently

---

## OpenClaw's Profile-Based Tool Sets (For Reference)

### Tool Groups (building blocks)

| Group | Tools |
|---|---|
| `group:runtime` | `exec`, `bash`, `process` |
| `group:fs` | `read`, `write`, `edit`, `apply_patch` |
| `group:sessions` | `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`, `session_status` |
| `group:memory` | `memory_search`, `memory_get` |
| `group:web` | `web_search`, `web_fetch` |
| `group:ui` | `browser`, `canvas` |
| `group:automation` | `cron`, `gateway` |
| `group:messaging` | `message` |
| `group:nodes` | `nodes` |
| `group:openclaw` | All built-in tools (excludes plugins) |

### Profiles (pre-built combos)

| Profile | What's included | Approx tool count |
|---|---|---|
| **minimal** | Only `session_status` | 1 tool |
| **coding** | `group:fs` + `group:runtime` + `group:sessions` + `group:memory` + `image` | ~15 tools |
| **messaging** | `group:messaging` + `sessions_list/history/send` + `session_status` | ~5-8 tools |
| **full** | Everything | All tools (25+ core + skill tools) |

### Configuration

```json
{
  "tools": {
    "profile": "coding",
    "allow": ["web_search"],
    "deny": ["browser"]
  }
}
```

Layering: **Profile -> Provider restrictions -> Allow/Deny**

Per-agent override:

```json
{
  "agents": {
    "list": [{
      "name": "support-bot",
      "tools": { "profile": "messaging", "deny": ["exec"] }
    }]
  }
}
```

### Key Difference

OpenClaw selects tools **once at session start** based on profile config. Set is stable for the entire session. Annabelle re-selects tools **every turn** based on embedding similarity + regex + playbook required_tools + sticky tools.

This is a design philosophy difference. Both approaches work — the critical issue is that Annabelle's dynamic selection relies on `required_tools` arrays that have wrong tool names, so force-injection of playbook tools fails silently.

---

## Recovery Code (Symptoms, Not Solutions)

The system has ~300 lines of recovery code that patches over Issues 1 and 2:

- `stripHallucinatedParams()` — removes hallucinated params (e.g. teamId/slug)
- `relaxSchemaTypes()` — accepts strings where numbers expected
- `coerceStringBooleans()` — fixes booleans sent as strings
- `recover-tool-call.ts` — recovers leaked JSON tool calls from text
- Hallucination guard — detects "I've sent/created/..." without actual tool calls
- Multi-retry cascade — 3 retries with temperature adjustment before text-only fallback

---

## TODO List

### Phase 1: Fix Names ✅

- [x] Fix all tool names in `playbook-seed.ts` — both `instructions` text AND `required_tools` arrays for all 13 broken playbooks
- [x] Remove overlapping tool catalog sections from `instructions.md` to eliminate persona/playbook contradictions
- [x] Resolve TOOL_PREAMBLE / instructions.md `## TOOL CALLING RULES` duplication (removed TOOL_PREAMBLE, instructions.md is single source of truth)
- [ ] Rebuild Thinker and restart
- [ ] Test with real messages that previously triggered failures

### Phase 2: Groq Provider Investigation (do second)

- [ ] Test same Llama 3.3 70B via Together AI or Fireworks
- [ ] Compare: do leaked tool calls still happen?
- [ ] Compare: does `toolChoice: 'required'` still crash on step 2+?
- [ ] If better: switch provider or add as fallback

### Phase 3: Tool Description Enrichment (do later)

- [ ] Add concrete parameter examples to key tool descriptions (OpenClaw SKILL.md pattern)
- [ ] Focus on tools that have complex parameters (calendar events, search, browser)

### Phase 4: Recovery Code Cleanup (do after Phase 1 results)

- [ ] After name fixes, monitor whether leaked tool calls still occur
- [ ] After name fixes, monitor whether hallucination guard still triggers
- [ ] If failures drop significantly, consider removing/simplifying recovery code
- [ ] Keep `stripHallucinatedParams()` and `coerceStringBooleans()` regardless (these are Groq-specific safety nets)
