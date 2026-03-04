# Tool Reduction Report

Generated: 2026-03-04T14:24:01.769Z
Model: qwen3.5:4b-q4_K_M
Total tools in catalog: 144

## Summary

| # | Message | LLM Pick | Default | Reduced | Saved |
|---|---------|----------|---------|---------|-------|
| 1 | search for AI news | `searcher_news_search` | 16 | 15 | -1 |
| 2 | send an email to bob about the project update | _null_ | 25 | 25 | 0 |
| 3 | what meetings do I have tomorrow | `gmail_list_events` | 22 | 16 | -6 |
| 4 | read the file report.txt | `filer_read_file` | 25 | 15 | -10 |
| 5 | remember I like dark mode | `memory_store_fact` | 25 | 16 | -9 |
| 6 | show me pictures of cats | _null_ | 25 | 25 | 0 |
| 7 | what do you know about me | `memory_get_profile` | 25 | 15 | -10 |
| 8 | check my password vault for github | `onepassword_list_vaults` | 19 | 16 | -3 |
| 9 | navigate to google.com and take a screenshot | `web_browser_navigate` | 22 | 16 | -6 |
| 10 | run the python script | _null_ | 24 | 24 | 0 |
| 11 | delete the spam email from my inbox | `gmail_list_emails` | 25 | 15 | -10 |
| 12 | create a new calendar event for Friday at 3pm | _null_ | 19 | 19 | 0 |
| 13 | send a message to the family group on telegram | `telegram_list_chats` | 25 | 16 | -9 |
| 14 | what is the weather in Warsaw | `searcher_web_search` | 18 | 15 | -3 |
| 15 | save this note to my workspace | _null_ | 25 | 25 | 0 |
| 16 | hello how are you | _null_ | 25 | 25 | 0 |
| 17 | remind me every morning to check email | `memory_store_skill` | 25 | 16 | -9 |
| 18 | find a picture of sunset and send it to the group | `searcher_image_search` | 25 | 16 | -9 |
| 19 | who is the president of France | _null_ | 18 | 18 | 0 |
| 20 | browse to amazon.com and search for headphones | `web_browser_navigate` | 23 | 15 | -8 |

**LLM picks:** 13/20 (65%)
**Average tools — default:** 22.8, **reduced:** 18.1, **reduction:** 20.4%

## Detailed Tool Lists (Reduced Pipeline → sent to Groq)

> **Core tools** = always-included safety-net tools (e.g. `send_telegram`, `searcher_web_search`)
>
> **Regex + Embedding tools** = contextual tools selected by keyword regex matching and vector embedding similarity, sorted by embedding similarity score (highest first)
>
> Score in parentheses = cosine similarity to the user message (mock keyword-hash embeddings)

### 1. "search for AI news"

- **LLM Pick (4B):** `searcher_news_search`
- **Total tools sent to Groq:** 15

**LLM Pick (4B):** `searcher_news_search` (0.722)

**Core tools (3):** `search_memories`, `searcher_web_search`, `send_telegram`

**Regex + Embedding tools (11):**
- `searcher_image_search` (0.577)
- `filer_search_files` (0.516)
- `web_browser_tab_select` (0.492)
- `telegram_search_messages` (0.483)
- `codexec_list_sessions` (0.408)
- `memory_backfill_embeddings` (0.402)
- `telegram_search_users` (0.387)
- `memory_store_fact` (0.376)
- `memory_get_memory_stats` (0.365)
- `memory_update_skill` (0.365)
- `memory_delete_fact` (0.311)

**Dropped vs default (4):** ~~`get_status`~~, ~~`searcher_web_fetch`~~, ~~`spawn_subagent`~~, ~~`store_fact`~~

---

### 2. "send an email to bob about the project update"

- **LLM Pick (4B):** _null (no reduction applied)_
- **Total tools sent to Groq:** 25

**Core tools (6):** `get_status`, `search_memories`, `searcher_web_search`, `send_telegram`, `spawn_subagent`, `store_fact`

**Regex + Embedding tools (19):**
- `memory_store_fact` (0.583)
- `gmail_delete_email` (0.544)
- `gmail_update_event` (0.493)
- `queue_task` (0.457)
- `memory_create_project` (0.445)
- `memory_store_skill` (0.436)
- `memory_update_project_source_status` (0.433)
- `memory_list_project_sources` (0.426)
- `codexec_send_to_session` (0.422)
- `gmail_update_draft` (0.408)
- `gmail_reply_email` (0.392)
- `gmail_send_email` (0.363)
- `gmail_mark_read` (0.354)
- `gmail_get_attachment` (0.316)
- `gmail_send_draft` (0.298)
- `gmail_modify_labels` (0.278)
- `gmail_get_new_emails` (0.232)
- `gmail_list_attachments` (0.211)
- `gmail_list_emails` (0.195)

---

### 3. "what meetings do I have tomorrow"

- **LLM Pick (4B):** `gmail_list_events`
- **Total tools sent to Groq:** 16

**LLM Pick (4B):** `gmail_list_events` (0.136)

**Core tools (2):** `searcher_web_search`, `send_telegram`

**Regex + Embedding tools (13):**
- `gmail_quick_add_event` (0.445)
- `searcher_image_search` (0.433)
- `searcher_news_search` (0.433)
- `telegram_delete_messages` (0.408)
- `memory_query_timeline` (0.399)
- `codexec_search_scripts` (0.387)
- `memory_import_memory` (0.369)
- `memory_search_conversations` (0.367)
- `filer_update_file` (0.365)
- `gmail_create_filter` (0.348)
- `memory_retrieve_memories` (0.346)
- `telegram_search_messages` (0.345)
- `memory_update_fact` (0.312)

**Dropped vs default (10):** ~~`get_status`~~, ~~`gmail_create_event`~~, ~~`gmail_delete_event`~~, ~~`gmail_find_free_time`~~, ~~`gmail_get_event`~~, ~~`gmail_list_calendars`~~, ~~`gmail_update_event`~~, ~~`search_memories`~~, ~~`spawn_subagent`~~, ~~`store_fact`~~

---

### 4. "read the file report.txt"

- **LLM Pick (4B):** `filer_read_file`
- **Total tools sent to Groq:** 15

**LLM Pick (4B):** `filer_read_file` (0.424)

**Core tools (3):** `get_status`, `searcher_web_search`, `send_telegram`

**Regex + Embedding tools (11):**
- `web_browser_select_option` (0.527)
- `web_browser_hover` (0.447)
- `filer_create_file` (0.447)
- `web_browser_drag` (0.405)
- `web_browser_fill` (0.373)
- `filer_get_audit_log` (0.365)
- `gmail_create_label` (0.365)
- `web_browser_network_requests` (0.358)
- `onepassword_read_secret` (0.351)
- `web_browser_file_upload` (0.351)
- `memory_query_timeline` (0.340)

**Dropped vs default (13):** ~~`filer_check_grant`~~, ~~`filer_copy_file`~~, ~~`filer_delete_file`~~, ~~`filer_get_workspace_info`~~, ~~`filer_list_files`~~, ~~`filer_list_grants`~~, ~~`filer_move_file`~~, ~~`filer_request_grant`~~, ~~`filer_search_files`~~, ~~`filer_update_file`~~, ~~`search_memories`~~, ~~`spawn_subagent`~~, ~~`store_fact`~~

---

### 5. "remember I like dark mode"

- **LLM Pick (4B):** `memory_store_fact`
- **Total tools sent to Groq:** 16

**LLM Pick (4B):** `memory_store_fact` (0.082)

**Core tools (2):** `searcher_web_search`, `send_telegram`

**Regex + Embedding tools (13):**
- `memory_get_profile` (0.443)
- `telegram_subscribe_chat` (0.434)
- `memory_list_facts` (0.408)
- `memory_import_memory` (0.405)
- `codexec_list_scripts` (0.372)
- `filer_get_workspace_info` (0.365)
- `web_browser_console_messages` (0.359)
- `memory_search_conversations` (0.352)
- `guardian_scan_content` (0.345)
- `memory_query_timeline` (0.340)
- `gmail_mark_read` (0.316)
- `web_browser_close` (0.316)
- `gmail_get_event` (0.300)

**Dropped vs default (12):** ~~`get_status`~~, ~~`gmail_get_email`~~, ~~`gmail_list_emails`~~, ~~`gmail_modify_labels`~~, ~~`memory_backfill_extract_facts`~~, ~~`memory_list_contacts`~~, ~~`memory_list_skills`~~, ~~`memory_retrieve_memories`~~, ~~`memory_store_conversation`~~, ~~`search_memories`~~, ~~`spawn_subagent`~~, ~~`store_fact`~~

---

### 6. "show me pictures of cats"

- **LLM Pick (4B):** _null (no reduction applied)_
- **Total tools sent to Groq:** 25

**Core tools (6):** `get_status`, `search_memories`, `searcher_web_search`, `send_telegram`, `spawn_subagent`, `store_fact`

**Regex + Embedding tools (19):**
- `codexec_list_scripts` (0.496)
- `gmail_get_email` (0.408)
- `gmail_create_filter` (0.381)
- `get_job_status` (0.378)
- `filer_get_workspace_info` (0.365)
- `filer_copy_file` (0.346)
- `guardian_scan_content` (0.345)
- `codexec_list_sessions` (0.335)
- `memory_store_conversation` (0.333)
- `telegram_get_messages` (0.218)
- `telegram_mark_read` (0.158)
- `telegram_search_messages` (0.151)
- `telegram_delete_messages` (0.149)
- `telegram_create_group` (0.141)
- `telegram_get_chat` (0.141)
- `telegram_search_users` (0.141)
- `telegram_add_contact` (0.120)
- `telegram_list_chats` (0.120)
- `telegram_send_message` (0.118)

---

### 7. "what do you know about me"

- **LLM Pick (4B):** `memory_get_profile`
- **Total tools sent to Groq:** 15

**LLM Pick (4B):** `memory_get_profile` (0.400)

**Core tools (2):** `searcher_web_search`, `send_telegram`

**Regex + Embedding tools (12):**
- `telegram_get_chat` (0.559)
- `memory_retrieve_memories` (0.510)
- `codexec_run_script` (0.476)
- `codexec_get_script` (0.471)
- `codexec_save_script` (0.433)
- `memory_update_fact` (0.386)
- `codexec_save_and_run_script` (0.386)
- `memory_store_skill` (0.347)
- `memory_query_timeline` (0.345)
- `system_health_check` (0.328)
- `filer_update_file` (0.316)
- `gmail_send_draft` (0.316)

**Dropped vs default (12):** ~~`get_status`~~, ~~`gmail_create_filter`~~, ~~`gmail_list_labels`~~, ~~`gmail_update_draft`~~, ~~`memory_search_conversations`~~, ~~`memory_store_conversation`~~, ~~`memory_unlink_project_source`~~, ~~`memory_update_profile`~~, ~~`memory_update_skill`~~, ~~`search_memories`~~, ~~`spawn_subagent`~~, ~~`store_fact`~~

---

### 8. "check my password vault for github"

- **LLM Pick (4B):** `onepassword_list_vaults`
- **Total tools sent to Groq:** 16

**LLM Pick (4B):** `onepassword_list_vaults` (0.000)

**Core tools (2):** `searcher_web_search`, `send_telegram`

**Regex + Embedding tools (13):**
- `memory_store_fact` (0.526)
- `codexec_install_package` (0.500)
- `telegram_subscribe_chat` (0.495)
- `gmail_find_free_time` (0.417)
- `telegram_download_media` (0.408)
- `gmail_update_event` (0.403)
- `telegram_send_media` (0.400)
- `filer_search_files` (0.387)
- `telegram_search_users` (0.387)
- `memory_update_project_source_status` (0.379)
- `system_health_check` (0.379)
- `get_tool_catalog` (0.379)
- `memory_update_contact` (0.375)

**Dropped vs default (7):** ~~`get_status`~~, ~~`onepassword_get_item`~~, ~~`onepassword_list_items`~~, ~~`onepassword_read_secret`~~, ~~`search_memories`~~, ~~`spawn_subagent`~~, ~~`store_fact`~~

---

### 9. "navigate to google.com and take a screenshot"

- **LLM Pick (4B):** `web_browser_navigate`
- **Total tools sent to Groq:** 16

**LLM Pick (4B):** `web_browser_navigate` (0.377)

**Core tools (2):** `searcher_web_search`, `send_telegram`

**Regex + Embedding tools (13):**
- `memory_delete_fact` (0.593)
- `gmail_reply_email` (0.555)
- `memory_list_facts` (0.552)
- `web_browser_snapshot` (0.543)
- `web_browser_take_screenshot` (0.523)
- `memory_retrieve_memories` (0.510)
- `codexec_delete_script` (0.500)
- `web_browser_close` (0.500)
- `web_browser_tab_close` (0.487)
- `web_browser_file_upload` (0.485)
- `gmail_send_email` (0.481)
- `telegram_add_contact` (0.472)
- `telegram_send_message` (0.468)

**Dropped vs default (10):** ~~`get_status`~~, ~~`search_memories`~~, ~~`searcher_image_search`~~, ~~`searcher_news_search`~~, ~~`searcher_web_fetch`~~, ~~`spawn_subagent`~~, ~~`store_fact`~~, ~~`web_browser_click`~~, ~~`web_browser_navigate_back`~~, ~~`web_browser_type`~~

---

### 10. "run the python script"

- **LLM Pick (4B):** _null (no reduction applied)_
- **Total tools sent to Groq:** 24

**Core tools (6):** `get_status`, `search_memories`, `searcher_web_search`, `send_telegram`, `spawn_subagent`, `store_fact`

**Regex + Embedding tools (18):**
- `codexec_save_script` (0.583)
- `codexec_get_script` (0.544)
- `gmail_update_draft` (0.500)
- `codexec_run_script` (0.471)
- `memory_get_profile` (0.462)
- `memory_update_project_source_status` (0.455)
- `system_health_check` (0.455)
- `memory_update_fact` (0.445)
- `codexec_save_and_run_script` (0.445)
- `codexec_delete_script` (0.433)
- `codexec_search_scripts` (0.258)
- `codexec_send_to_session` (0.129)
- `codexec_execute_code` (0.120)
- `codexec_install_package` (0.083)
- `codexec_close_session` (0.000)
- `codexec_list_scripts` (0.000)
- `codexec_list_sessions` (0.000)
- `codexec_start_session` (0.000)

---

### 11. "delete the spam email from my inbox"

- **LLM Pick (4B):** `gmail_list_emails`
- **Total tools sent to Groq:** 15

**LLM Pick (4B):** `gmail_list_emails` (0.398)

**Core tools (3):** `searcher_web_search`, `send_telegram`, `spawn_subagent`

**Regex + Embedding tools (11):**
- `memory_update_fact` (0.495)
- `gmail_update_draft` (0.463)
- `memory_store_fact` (0.418)
- `codexec_delete_script` (0.401)
- `memory_backfill_extract_facts` (0.387)
- `web_browser_snapshot` (0.387)
- `gmail_find_free_time` (0.386)
- `memory_update_project_source_status` (0.351)
- `memory_update_contact` (0.347)
- `memory_update_project` (0.347)
- `gmail_quick_add_event` (0.330)

**Dropped vs default (13):** ~~`get_status`~~, ~~`gmail_delete_email`~~, ~~`gmail_delete_filter`~~, ~~`gmail_delete_label`~~, ~~`gmail_get_email`~~, ~~`gmail_list_attachments`~~, ~~`gmail_list_drafts`~~, ~~`gmail_modify_labels`~~, ~~`gmail_reply_email`~~, ~~`gmail_send_draft`~~, ~~`gmail_send_email`~~, ~~`search_memories`~~, ~~`store_fact`~~

---

### 12. "create a new calendar event for Friday at 3pm"

- **LLM Pick (4B):** _null (no reduction applied)_
- **Total tools sent to Groq:** 19

**Core tools (6):** `get_status`, `search_memories`, `searcher_web_search`, `send_telegram`, `spawn_subagent`, `store_fact`

**Regex + Embedding tools (13):**
- `gmail_create_draft` (0.589)
- `gmail_quick_add_event` (0.582)
- `gmail_create_event` (0.566)
- `memory_store_skill` (0.546)
- `memory_store_fact` (0.491)
- `gmail_delete_event` (0.447)
- `telegram_add_contact` (0.445)
- `gmail_update_event` (0.438)
- `filer_move_file` (0.422)
- `gmail_list_events` (0.278)
- `gmail_list_calendars` (0.167)
- `gmail_find_free_time` (0.136)
- `gmail_get_event` (0.075)

---

### 13. "send a message to the family group on telegram"

- **LLM Pick (4B):** `telegram_list_chats`
- **Total tools sent to Groq:** 16

**LLM Pick (4B):** `telegram_list_chats` (0.178)

**Core tools (3):** `searcher_web_search`, `send_telegram`, `spawn_subagent`

**Regex + Embedding tools (12):**
- `telegram_download_media` (0.556)
- `telegram_send_message` (0.486)
- `memory_retrieve_memories` (0.481)
- `codexec_delete_script` (0.471)
- `memory_delete_fact` (0.457)
- `queue_task` (0.457)
- `gmail_update_event` (0.438)
- `web_browser_wait` (0.436)
- `memory_backfill_extract_facts` (0.427)
- `onepassword_list_vaults` (0.422)
- `telegram_create_group` (0.422)
- `filer_request_grant` (0.408)

**Dropped vs default (12):** ~~`get_status`~~, ~~`gmail_create_draft`~~, ~~`gmail_list_labels`~~, ~~`gmail_reply_email`~~, ~~`gmail_send_email`~~, ~~`search_memories`~~, ~~`store_fact`~~, ~~`telegram_add_contact`~~, ~~`telegram_get_me`~~, ~~`telegram_list_contacts`~~, ~~`telegram_search_messages`~~, ~~`telegram_send_media`~~

---

### 14. "what is the weather in Warsaw"

- **LLM Pick (4B):** `searcher_web_search`
- **Total tools sent to Groq:** 15

**LLM Pick (4B):** `searcher_web_search` (0.272)

**Core tools (2):** `send_telegram`, `store_fact`

**Regex + Embedding tools (12):**
- `memory_query_timeline` (0.443)
- `trigger_backfill` (0.392)
- `onepassword_list_vaults` (0.387)
- `web_browser_navigate` (0.374)
- `gmail_get_new_emails` (0.355)
- `web_browser_navigate_back` (0.354)
- `gmail_list_emails` (0.334)
- `filer_check_grant` (0.333)
- `memory_export_memory` (0.309)
- `gmail_list_calendars` (0.306)
- `searcher_web_fetch` (0.306)
- `memory_store_conversation` (0.304)

**Dropped vs default (5):** ~~`get_status`~~, ~~`search_memories`~~, ~~`searcher_image_search`~~, ~~`searcher_news_search`~~, ~~`spawn_subagent`~~

---

### 15. "save this note to my workspace"

- **LLM Pick (4B):** _null (no reduction applied)_
- **Total tools sent to Groq:** 25

**Core tools (6):** `get_status`, `search_memories`, `searcher_web_search`, `send_telegram`, `spawn_subagent`, `store_fact`

**Regex + Embedding tools (19):**
- `web_browser_pdf_save` (0.492)
- `memory_list_projects` (0.436)
- `gmail_list_filters` (0.433)
- `filer_copy_file` (0.422)
- `gmail_find_free_time` (0.417)
- `memory_update_contact` (0.375)
- `memory_update_project` (0.375)
- `gmail_list_drafts` (0.365)
- `codexec_save_and_run_script` (0.356)
- `filer_delete_file` (0.333)
- `filer_read_file` (0.258)
- `filer_list_grants` (0.183)
- `filer_get_workspace_info` (0.167)
- `filer_list_files` (0.167)
- `filer_request_grant` (0.167)
- `filer_create_file` (0.136)
- `filer_move_file` (0.129)
- `filer_check_grant` (0.000)
- `filer_get_audit_log` (0.000)

---

### 16. "hello how are you"

- **LLM Pick (4B):** _null (no reduction applied)_
- **Total tools sent to Groq:** 25

**Core tools (6):** `get_status`, `search_memories`, `searcher_web_search`, `send_telegram`, `spawn_subagent`, `store_fact`

**Regex + Embedding tools (19):**
- `web_browser_hover` (0.375)
- `web_browser_navigate` (0.305)
- `memory_create_project` (0.267)
- `telegram_list_chats` (0.267)
- `memory_retrieve_memories` (0.254)
- `memory_store_conversation` (0.224)
- `memory_backfill_extract_facts` (0.192)
- `memory_search_conversations` (0.169)
- `memory_get_profile` (0.141)
- `memory_create_contact` (0.140)
- `memory_unlink_project_source` (0.139)
- `searcher_web_fetch` (0.125)
- `memory_backfill_embeddings` (0.123)
- `memory_update_contact` (0.115)
- `memory_update_project` (0.115)
- `memory_store_skill` (0.109)
- `memory_query_timeline` (0.108)
- `memory_store_fact` (0.092)
- `memory_link_project_source` (0.070)

---

### 17. "remind me every morning to check email"

- **LLM Pick (4B):** `memory_store_skill`
- **Total tools sent to Groq:** 16

**LLM Pick (4B):** `memory_store_skill` (0.289)

**Core tools (3):** `searcher_web_search`, `send_telegram`, `spawn_subagent`

**Regex + Embedding tools (12):**
- `gmail_create_filter` (0.483)
- `queue_task` (0.454)
- `get_tool_catalog` (0.401)
- `telegram_search_messages` (0.383)
- `telegram_download_media` (0.378)
- `web_browser_click` (0.378)
- `memory_create_contact` (0.370)
- `telegram_send_message` (0.350)
- `memory_delete_fact` (0.346)
- `gmail_quick_add_event` (0.330)
- `gmail_modify_labels` (0.315)
- `memory_unlink_project_source` (0.314)

**Dropped vs default (11):** ~~`get_status`~~, ~~`gmail_delete_email`~~, ~~`gmail_get_email`~~, ~~`gmail_list_drafts`~~, ~~`gmail_list_emails`~~, ~~`gmail_list_filters`~~, ~~`gmail_reply_email`~~, ~~`gmail_send_draft`~~, ~~`gmail_send_email`~~, ~~`search_memories`~~, ~~`store_fact`~~

---

### 18. "find a picture of sunset and send it to the group"

- **LLM Pick (4B):** `searcher_image_search`
- **Total tools sent to Groq:** 16

**LLM Pick (4B):** `searcher_image_search` (0.000)

**Core tools (3):** `get_status`, `searcher_web_search`, `send_telegram`

**Regex + Embedding tools (12):**
- `web_browser_console_messages` (0.593)
- `memory_delete_skill` (0.566)
- `gmail_get_event` (0.558)
- `onepassword_get_item` (0.558)
- `codexec_save_and_run_script` (0.545)
- `memory_create_contact` (0.544)
- `memory_get_skill` (0.524)
- `guardian_scan_content` (0.514)
- `codexec_save_script` (0.510)
- `gmail_get_email` (0.506)
- `memory_create_project` (0.482)
- `memory_list_facts` (0.469)

**Dropped vs default (12):** ~~`gmail_delete_filter`~~, ~~`gmail_get_filter`~~, ~~`gmail_reply_email`~~, ~~`gmail_send_draft`~~, ~~`search_memories`~~, ~~`spawn_subagent`~~, ~~`store_fact`~~, ~~`telegram_add_contact`~~, ~~`telegram_download_media`~~, ~~`telegram_get_new_messages`~~, ~~`telegram_search_messages`~~, ~~`telegram_send_media`~~

---

### 19. "who is the president of France"

- **LLM Pick (4B):** _null (no reduction applied)_
- **Total tools sent to Groq:** 18

**Core tools (6):** `get_status`, `search_memories`, `searcher_web_search`, `send_telegram`, `spawn_subagent`, `store_fact`

**Regex + Embedding tools (12):**
- `web_browser_click` (0.510)
- `memory_get_skill` (0.463)
- `gmail_get_email` (0.447)
- `web_browser_console_messages` (0.436)
- `guardian_get_scan_log` (0.433)
- `web_browser_type` (0.426)
- `memory_create_contact` (0.400)
- `memory_create_project` (0.382)
- `memory_update_project_source_status` (0.379)
- `searcher_news_search` (0.289)
- `searcher_image_search` (0.144)
- `searcher_web_fetch` (0.102)

---

### 20. "browse to amazon.com and search for headphones"

- **LLM Pick (4B):** `web_browser_navigate`
- **Total tools sent to Groq:** 15

**LLM Pick (4B):** `web_browser_navigate` (0.539)

**Core tools (3):** `get_status`, `searcher_web_search`, `send_telegram`

**Regex + Embedding tools (11):**
- `searcher_web_fetch` (0.530)
- `telegram_search_messages` (0.478)
- `telegram_add_contact` (0.472)
- `filer_search_files` (0.447)
- `telegram_search_users` (0.447)
- `guardian_scan_content` (0.436)
- `memory_delete_fact` (0.431)
- `web_browser_tab_select` (0.426)
- `web_browser_file_upload` (0.416)
- `trigger_backfill` (0.396)
- `gmail_get_event` (0.395)

**Dropped vs default (11):** ~~`search_memories`~~, ~~`searcher_image_search`~~, ~~`searcher_news_search`~~, ~~`spawn_subagent`~~, ~~`store_fact`~~, ~~`web_browser_click`~~, ~~`web_browser_close`~~, ~~`web_browser_navigate_back`~~, ~~`web_browser_snapshot`~~, ~~`web_browser_take_screenshot`~~, ~~`web_browser_type`~~

---
