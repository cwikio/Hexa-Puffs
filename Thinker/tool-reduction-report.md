# Tool Reduction Report

Generated: 2026-03-04T17:18:43.765Z
Model: qwen3.5:4b-q4_K_M
Total tools in catalog: 144

## Summary

| # | Message | LLM Pick | Confirmed | Default | Reduced | Saved |
|---|---------|----------|-----------|---------|---------|-------|
| 1 | search for AI news | `searcher_news_search` | yes | 13 | 11 | -2 |
| 2 | send an email to bob about the project update | `memory_list_contacts` | no | 20 | 12 | -8 |
| 3 | what meetings do I have tomorrow | `gmail_list_events` | yes | 16 | 11 | -5 |
| 4 | read the file report.txt | `filer_read_file` | yes | 20 | 11 | -9 |
| 5 | remember I like dark mode | `memory_store_fact` | no | 20 | 12 | -8 |
| 6 | show me pictures of cats | `searcher_image_search` | yes | 20 | 11 | -9 |
| 7 | what do you know about me | `memory_get_profile` | yes | 20 | 11 | -9 |
| 8 | check my password vault for github | `onepassword_list_vaults` | yes | 13 | 11 | -2 |
| 9 | navigate to google.com and take a screenshot | `web_browser_navigate` | yes | 16 | 11 | -5 |
| 10 | run the python script | `codexec_list_scripts` | yes | 19 | 11 | -8 |
| 11 | delete the spam email from my inbox | `gmail_list_emails` | yes | 20 | 11 | -9 |
| 12 | create a new calendar event for Friday at 3pm | `gmail_quick_add_event` | yes | 14 | 11 | -3 |
| 13 | send a message to the family group on telegram | `telegram_list_chats` | no | 20 | 12 | -8 |
| 14 | what is the weather in Warsaw | `searcher_web_search` | yes | 14 | 11 | -3 |
| 15 | save this note to my workspace | _null_ | - | 20 | 20 | 0 |
| 16 | hello how are you | _null_ | - | 20 | 20 | 0 |
| 17 | remind me every morning to check email | `memory_store_skill` | no | 20 | 12 | -8 |
| 18 | find a picture of sunset and send it to the group | `searcher_image_search` | yes | 20 | 11 | -9 |
| 19 | who is the president of France | _null_ | - | 13 | 13 | 0 |
| 20 | browse to amazon.com and search for headphones | `web_browser_navigate` | yes | 20 | 11 | -9 |

**LLM picks:** 17/20 (85%)
**Average tools — default:** 17.9, **reduced:** 12.2, **reduction:** 31.8%

## Detailed Tool Lists (Reduced Pipeline → sent to Groq)

> **Core tools** = always-included safety-net tools (e.g. `send_telegram`, `searcher_web_search`)
>
> **Regex + Embedding tools** = contextual tools selected by keyword regex matching and vector embedding similarity, sorted by embedding similarity score (highest first)
>
> Score in parentheses = cosine similarity to the user message (nomic-embed-text via Ollama)

### 1. "search for AI news"

- **LLM Pick (4B):** `searcher_news_search` — confirmed by embeddings
- **Total tools sent to Groq:** 11

**Core tools (4):** `search_memories`, `searcher_web_search`, `send_telegram`, `store_fact`

**Regex + Embedding tools (6):**
- `searcher_image_search` (0.632)
- `telegram_download_media` (0.630)
- `filer_search_files` (0.623)
- `telegram_get_chat` (0.608)
- `telegram_search_messages` (0.607)
- `gmail_get_event` (0.604)

**Dropped vs default (3):** ~~`get_status`~~, ~~`searcher_web_fetch`~~, ~~`spawn_subagent`~~

---

### 2. "send an email to bob about the project update"

- **LLM Pick (4B):** `memory_list_contacts` — NOT in embedding results (injected)
- **Total tools sent to Groq:** 12

**Core tools (2):** `searcher_web_search`, `send_telegram`

**Regex + Embedding tools (9):**
- `memory_update_project` (0.644)
- `gmail_update_draft` (0.626)
- `memory_update_contact` (0.608)
- `gmail_update_event` (0.591)
- `memory_update_project_source_status` (0.580)
- `gmail_get_new_emails` (0.574)
- `memory_create_project` (0.562)
- `gmail_send_email` (0.557)
- `gmail_send_draft` (0.546)

**Dropped vs default (10):** ~~`get_status`~~, ~~`gmail_create_draft`~~, ~~`gmail_delete_email`~~, ~~`gmail_get_email`~~, ~~`gmail_list_drafts`~~, ~~`gmail_list_emails`~~, ~~`gmail_reply_email`~~, ~~`search_memories`~~, ~~`spawn_subagent`~~, ~~`store_fact`~~

---

### 3. "what meetings do I have tomorrow"

- **LLM Pick (4B):** `gmail_list_events` — confirmed by embeddings
- **Total tools sent to Groq:** 11

**Core tools (3):** `search_memories`, `searcher_web_search`, `send_telegram`

**Regex + Embedding tools (7):**
- `telegram_list_chats` (0.627)
- `codexec_list_sessions` (0.617)
- `gmail_update_event` (0.614)
- `gmail_list_calendars` (0.611)
- `gmail_quick_add_event` (0.610)
- `gmail_get_event` (0.608)
- `gmail_create_event` (0.571)

**Dropped vs default (5):** ~~`get_status`~~, ~~`gmail_delete_event`~~, ~~`gmail_find_free_time`~~, ~~`spawn_subagent`~~, ~~`store_fact`~~

---

### 4. "read the file report.txt"

- **LLM Pick (4B):** `filer_read_file` — confirmed by embeddings
- **Total tools sent to Groq:** 11

**Core tools (2):** `searcher_web_search`, `send_telegram`

**Regex + Embedding tools (8):**
- `filer_list_files` (0.596)
- `filer_get_audit_log` (0.594)
- `filer_update_file` (0.591)
- `memory_export_memory` (0.586)
- `filer_search_files` (0.578)
- `filer_copy_file` (0.572)
- `filer_check_grant` (0.569)
- `filer_delete_file` (0.555)

**Dropped vs default (9):** ~~`filer_create_file`~~, ~~`filer_get_workspace_info`~~, ~~`filer_list_grants`~~, ~~`filer_move_file`~~, ~~`filer_request_grant`~~, ~~`get_status`~~, ~~`search_memories`~~, ~~`spawn_subagent`~~, ~~`store_fact`~~

---

### 5. "remember I like dark mode"

- **LLM Pick (4B):** `memory_store_fact` — NOT in embedding results (injected)
- **Total tools sent to Groq:** 12

**Core tools (2):** `searcher_web_search`, `send_telegram`

**Regex + Embedding tools (9):**
- `web_browser_navigate_back` (0.535)
- `web_browser_press_key` (0.519)
- `memory_list_skills` (0.518)
- `memory_retrieve_memories` (0.517)
- `memory_get_profile` (0.514)
- `memory_update_profile` (0.511)
- `memory_list_facts` (0.507)
- `memory_update_skill` (0.505)
- `memory_export_memory` (0.502)

**Dropped vs default (9):** ~~`get_status`~~, ~~`memory_get_skill`~~, ~~`memory_list_projects`~~, ~~`memory_query_timeline`~~, ~~`memory_search_conversations`~~, ~~`memory_store_conversation`~~, ~~`search_memories`~~, ~~`spawn_subagent`~~, ~~`store_fact`~~

---

### 6. "show me pictures of cats"

- **LLM Pick (4B):** `searcher_image_search` — confirmed by embeddings
- **Total tools sent to Groq:** 11

**Core tools (3):** `searcher_web_search`, `send_telegram`, `store_fact`

**Regex + Embedding tools (7):**
- `web_browser_take_screenshot` (0.518)
- `telegram_send_media` (0.515)
- `web_browser_snapshot` (0.507)
- `memory_list_project_sources` (0.505)
- `get_tool_catalog` (0.503)
- `telegram_download_media` (0.489)
- `telegram_get_chat` (0.482)

**Dropped vs default (9):** ~~`get_status`~~, ~~`search_memories`~~, ~~`searcher_news_search`~~, ~~`spawn_subagent`~~, ~~`telegram_add_contact`~~, ~~`telegram_get_messages`~~, ~~`telegram_list_chats`~~, ~~`telegram_list_contacts`~~, ~~`telegram_subscribe_chat`~~

---

### 7. "what do you know about me"

- **LLM Pick (4B):** `memory_get_profile` — confirmed by embeddings
- **Total tools sent to Groq:** 11

**Core tools (3):** `searcher_web_search`, `send_telegram`, `store_fact`

**Regex + Embedding tools (7):**
- `telegram_get_me` (0.596)
- `telegram_get_chat` (0.524)
- `memory_query_timeline` (0.517)
- `memory_store_fact` (0.483)
- `memory_list_contacts` (0.482)
- `memory_store_conversation` (0.480)
- `memory_retrieve_memories` (0.479)

**Dropped vs default (9):** ~~`get_status`~~, ~~`memory_create_contact`~~, ~~`memory_get_skill`~~, ~~`memory_list_projects`~~, ~~`memory_list_skills`~~, ~~`memory_search_conversations`~~, ~~`memory_update_profile`~~, ~~`search_memories`~~, ~~`spawn_subagent`~~

---

### 8. "check my password vault for github"

- **LLM Pick (4B):** `onepassword_list_vaults` — confirmed by embeddings
- **Total tools sent to Groq:** 11

**Core tools (3):** `get_status`, `searcher_web_search`, `send_telegram`

**Regex + Embedding tools (7):**
- `guardian_get_scan_log` (0.585)
- `onepassword_list_items` (0.584)
- `onepassword_read_secret` (0.584)
- `filer_check_grant` (0.559)
- `guardian_scan_content` (0.559)
- `codexec_search_scripts` (0.547)
- `onepassword_get_item` (0.462)

**Dropped vs default (3):** ~~`search_memories`~~, ~~`spawn_subagent`~~, ~~`store_fact`~~

---

### 9. "navigate to google.com and take a screenshot"

- **LLM Pick (4B):** `web_browser_navigate` — confirmed by embeddings
- **Total tools sent to Groq:** 11

**Core tools (2):** `searcher_web_search`, `send_telegram`

**Regex + Embedding tools (8):**
- `web_browser_take_screenshot` (0.729)
- `web_browser_snapshot` (0.591)
- `searcher_image_search` (0.588)
- `web_browser_click` (0.582)
- `web_browser_type` (0.568)
- `guardian_get_scan_log` (0.565)
- `web_browser_navigate_back` (0.558)
- `searcher_web_fetch` (0.530)

**Dropped vs default (6):** ~~`get_status`~~, ~~`search_memories`~~, ~~`searcher_news_search`~~, ~~`spawn_subagent`~~, ~~`store_fact`~~, ~~`web_browser_close`~~

---

### 10. "run the python script"

- **LLM Pick (4B):** `codexec_list_scripts` — confirmed by embeddings
- **Total tools sent to Groq:** 11

**Core tools (2):** `searcher_web_search`, `send_telegram`

**Regex + Embedding tools (8):**
- `codexec_run_script` (0.628)
- `codexec_save_and_run_script` (0.619)
- `codexec_save_script` (0.588)
- `codexec_delete_script` (0.550)
- `codexec_get_script` (0.547)
- `codexec_install_package` (0.497)
- `codexec_execute_code` (0.491)
- `codexec_search_scripts` (0.488)

**Dropped vs default (8):** ~~`codexec_close_session`~~, ~~`codexec_list_sessions`~~, ~~`codexec_send_to_session`~~, ~~`codexec_start_session`~~, ~~`get_status`~~, ~~`search_memories`~~, ~~`spawn_subagent`~~, ~~`store_fact`~~

---

### 11. "delete the spam email from my inbox"

- **LLM Pick (4B):** `gmail_list_emails` — confirmed by embeddings
- **Total tools sent to Groq:** 11

**Core tools (2):** `searcher_web_search`, `send_telegram`

**Regex + Embedding tools (8):**
- `gmail_delete_email` (0.689)
- `gmail_delete_filter` (0.621)
- `gmail_delete_draft` (0.619)
- `gmail_delete_label` (0.618)
- `telegram_delete_messages` (0.609)
- `gmail_modify_labels` (0.606)
- `gmail_get_new_emails` (0.598)
- `gmail_get_email` (0.597)

**Dropped vs default (9):** ~~`get_status`~~, ~~`gmail_list_attachments`~~, ~~`gmail_list_drafts`~~, ~~`gmail_reply_email`~~, ~~`gmail_send_email`~~, ~~`gmail_update_draft`~~, ~~`search_memories`~~, ~~`spawn_subagent`~~, ~~`store_fact`~~

---

### 12. "create a new calendar event for Friday at 3pm"

- **LLM Pick (4B):** `gmail_quick_add_event` — confirmed by embeddings
- **Total tools sent to Groq:** 11

**Core tools (3):** `search_memories`, `searcher_web_search`, `send_telegram`

**Regex + Embedding tools (7):**
- `gmail_create_event` (0.753)
- `gmail_update_event` (0.703)
- `gmail_list_events` (0.691)
- `gmail_delete_event` (0.689)
- `gmail_list_calendars` (0.658)
- `gmail_get_event` (0.642)
- `gmail_find_free_time` (0.596)

**Dropped vs default (3):** ~~`get_status`~~, ~~`spawn_subagent`~~, ~~`store_fact`~~

---

### 13. "send a message to the family group on telegram"

- **LLM Pick (4B):** `telegram_list_chats` — NOT in embedding results (injected)
- **Total tools sent to Groq:** 12

**Core tools (2):** `searcher_web_search`, `send_telegram`

**Regex + Embedding tools (9):**
- `telegram_send_message` (0.729)
- `telegram_send_media` (0.682)
- `telegram_create_group` (0.677)
- `telegram_search_messages` (0.656)
- `telegram_add_contact` (0.649)
- `telegram_delete_messages` (0.648)
- `telegram_get_messages` (0.643)
- `telegram_mark_read` (0.639)
- `telegram_search_users` (0.639)

**Dropped vs default (8):** ~~`get_status`~~, ~~`search_memories`~~, ~~`spawn_subagent`~~, ~~`store_fact`~~, ~~`telegram_download_media`~~, ~~`telegram_get_chat`~~, ~~`telegram_get_new_messages`~~, ~~`telegram_subscribe_chat`~~

---

### 14. "what is the weather in Warsaw"

- **LLM Pick (4B):** `searcher_web_search` — confirmed by embeddings
- **Total tools sent to Groq:** 11

**Core tools (2):** `get_status`, `send_telegram`

**Regex + Embedding tools (8):**
- `searcher_news_search` (0.606)
- `gmail_list_calendars` (0.577)
- `gmail_quick_add_event` (0.559)
- `gmail_get_filter` (0.549)
- `gmail_list_events` (0.544)
- `gmail_get_event` (0.543)
- `gmail_update_event` (0.542)
- `searcher_image_search` (0.535)

**Dropped vs default (4):** ~~`search_memories`~~, ~~`searcher_web_fetch`~~, ~~`spawn_subagent`~~, ~~`store_fact`~~

---

### 15. "save this note to my workspace"

- **LLM Pick (4B):** _null (no reduction applied)_
- **Total tools sent to Groq:** 20

**Core tools (6):** `get_status`, `search_memories`, `searcher_web_search`, `send_telegram`, `spawn_subagent`, `store_fact`

**Regex + Embedding tools (14):**
- `filer_copy_file` (0.646)
- `filer_create_file` (0.634)
- `filer_get_workspace_info` (0.625)
- `filer_move_file` (0.611)
- `codexec_save_script` (0.608)
- `filer_read_file` (0.595)
- `filer_delete_file` (0.573)
- `filer_update_file` (0.487)
- `filer_request_grant` (0.480)
- `filer_check_grant` (0.477)
- `filer_search_files` (0.449)
- `filer_list_files` (0.420)
- `filer_get_audit_log` (0.416)
- `filer_list_grants` (0.401)

---

### 16. "hello how are you"

- **LLM Pick (4B):** _null (no reduction applied)_
- **Total tools sent to Groq:** 20

**Core tools (6):** `get_status`, `search_memories`, `searcher_web_search`, `send_telegram`, `spawn_subagent`, `store_fact`

**Regex + Embedding tools (14):**
- `telegram_add_contact` (0.528)
- `telegram_get_me` (0.514)
- `telegram_get_chat` (0.498)
- `codexec_list_sessions` (0.498)
- `telegram_subscribe_chat` (0.494)
- `memory_create_contact` (0.487)
- `memory_query_timeline` (0.468)
- `searcher_news_search` (0.466)
- `memory_store_conversation` (0.460)
- `memory_update_contact` (0.459)
- `memory_list_projects` (0.456)
- `memory_list_contacts` (0.452)
- `memory_get_profile` (0.451)
- `memory_create_project` (0.450)

---

### 17. "remind me every morning to check email"

- **LLM Pick (4B):** `memory_store_skill` — NOT in embedding results (injected)
- **Total tools sent to Groq:** 12

**Core tools (2):** `searcher_web_search`, `send_telegram`

**Regex + Embedding tools (9):**
- `gmail_list_emails` (0.635)
- `gmail_get_new_emails` (0.622)
- `gmail_mark_read` (0.614)
- `gmail_reply_email` (0.609)
- `gmail_update_draft` (0.604)
- `gmail_list_drafts` (0.601)
- `gmail_list_attachments` (0.589)
- `gmail_send_email` (0.588)
- `gmail_get_email` (0.586)

**Dropped vs default (9):** ~~`get_status`~~, ~~`gmail_create_draft`~~, ~~`gmail_create_filter`~~, ~~`gmail_delete_email`~~, ~~`gmail_modify_labels`~~, ~~`gmail_send_draft`~~, ~~`search_memories`~~, ~~`spawn_subagent`~~, ~~`store_fact`~~

---

### 18. "find a picture of sunset and send it to the group"

- **LLM Pick (4B):** `searcher_image_search` — confirmed by embeddings
- **Total tools sent to Groq:** 11

**Core tools (2):** `searcher_web_search`, `send_telegram`

**Regex + Embedding tools (8):**
- `telegram_send_media` (0.608)
- `telegram_create_group` (0.554)
- `telegram_download_media` (0.550)
- `gmail_find_free_time` (0.531)
- `telegram_send_message` (0.528)
- `gmail_update_event` (0.525)
- `gmail_send_draft` (0.523)
- `telegram_get_messages` (0.517)

**Dropped vs default (10):** ~~`get_status`~~, ~~`gmail_send_email`~~, ~~`search_memories`~~, ~~`searcher_news_search`~~, ~~`spawn_subagent`~~, ~~`store_fact`~~, ~~`telegram_add_contact`~~, ~~`telegram_search_messages`~~, ~~`telegram_search_users`~~, ~~`telegram_subscribe_chat`~~

---

### 19. "who is the president of France"

- **LLM Pick (4B):** _null (no reduction applied)_
- **Total tools sent to Groq:** 13

**Core tools (6):** `get_status`, `search_memories`, `searcher_web_search`, `send_telegram`, `spawn_subagent`, `store_fact`

**Regex + Embedding tools (7):**
- `searcher_news_search` (0.624)
- `telegram_search_users` (0.593)
- `filer_search_files` (0.572)
- `gmail_get_event` (0.563)
- `searcher_image_search` (0.561)
- `telegram_add_contact` (0.557)
- `searcher_web_fetch` (0.495)

---

### 20. "browse to amazon.com and search for headphones"

- **LLM Pick (4B):** `web_browser_navigate` — confirmed by embeddings
- **Total tools sent to Groq:** 11

**Core tools (4):** `get_status`, `search_memories`, `searcher_web_search`, `send_telegram`

**Regex + Embedding tools (6):**
- `telegram_search_messages` (0.584)
- `memory_list_contacts` (0.570)
- `gmail_list_emails` (0.554)
- `telegram_get_messages` (0.544)
- `memory_list_projects` (0.535)
- `searcher_web_fetch` (0.519)

**Dropped vs default (9):** ~~`searcher_image_search`~~, ~~`searcher_news_search`~~, ~~`spawn_subagent`~~, ~~`store_fact`~~, ~~`web_browser_click`~~, ~~`web_browser_close`~~, ~~`web_browser_navigate_back`~~, ~~`web_browser_snapshot`~~, ~~`web_browser_type`~~

---
