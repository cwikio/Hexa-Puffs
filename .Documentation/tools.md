# Tool System Architecture

This document describes how tools are registered, discovered, selected, executed, and optimized across the Annabelle MCP ecosystem.

---

## Table of Contents

1. [Overview](#overview)
2. [Tool Registration and Discovery](#tool-registration-and-discovery)
3. [Tool Naming and Prefixing](#tool-naming-and-prefixing)
4. [Tool Selection](#tool-selection)
   - [Regex-Based Selection](#regex-based-selection)
   - [Embedding-Based Selection](#embedding-based-selection)
   - [Selection Merge Logic](#selection-merge-logic)
   - [Sticky Tools (Sliding Window)](#sticky-tools-sliding-window)
   - [Required Tools (Skill Shortcut)](#required-tools-skill-shortcut)
5. [Tool Execution Flow](#tool-execution-flow)
   - [Hallucination Guard](#hallucination-guard)
6. [Skills and Scheduled Tool Use](#skills-and-scheduled-tool-use)
   - [Skill Execution in Thinker](#skill-execution-in-thinker)
   - [Required Tools Data Flow](#required-tools-data-flow)
7. [Context and Token Budget](#context-and-token-budget)
8. [Cost Controls](#cost-controls)
9. [Tool Refresh at Runtime](#tool-refresh-at-runtime)

---

## Overview

The system has three layers involved in tool management:

```
┌────────────────────────────────────────────────────────────┐
│                        MCPs                                │
│  Guardian, Gmail, Memorizer, Filer, Searcher, Telegram,    │
│  1Password, CodeExec, Browser                              │
│  Each exposes tools via MCP protocol (stdio or HTTP)       │
└──────────────────────────┬─────────────────────────────────┘
                           │ tool registration
                           ▼
┌────────────────────────────────────────────────────────────┐
│                    Orchestrator (:8010)                     │
│  - Discovers MCPs at startup (auto-discovery)              │
│  - Registers all MCP tools in ToolRouter                   │
│  - Prefixes tool names to avoid conflicts                  │
│  - Routes tool calls to the correct MCP                    │
│  - Exposes GET /tools/list and POST /tools/call            │
└──────────────────────────┬─────────────────────────────────┘
                           │ HTTP API
                           ▼
┌────────────────────────────────────────────────────────────┐
│                      Thinker (:8006)                       │
│  - Fetches available tools from Orchestrator               │
│  - Selects relevant subset per message (tool selection)    │
│  - Passes selected tools to LLM via Vercel AI SDK          │
│  - LLM calls tools → Thinker proxies to Orchestrator      │
│  - Tracks token usage and cost                             │
└────────────────────────────────────────────────────────────┘
```

---

## Tool Registration and Discovery

### MCP Auto-Discovery

At startup, the Orchestrator's scanner reads sibling directories looking for packages with an `"annabelle"` manifest in their `package.json`:

```
Shared/Discovery/scanner.ts
```

Each MCP declares:

| Field | Required | Description |
|-------|----------|-------------|
| `mcpName` | Yes | Logical name used by Orchestrator (e.g., `"gmail"`, `"filer"`) |
| `transport` | No | `"stdio"` (default) or `"http"` |
| `httpPort` | No | Port for HTTP MCPs |
| `role` | No | `"guardian"` or `"channel"` for special MCPs |
| `sensitive` | No | Marks tools that handle sensitive data |
| `timeout` | No | Override default timeout |

Example `package.json` excerpt:

```json
{
  "annabelle": {
    "mcpName": "filer",
    "transport": "stdio"
  }
}
```

Environment-based disable: `${NAME}_MCP_ENABLED=false` (e.g., `FILER_MCP_ENABLED=false`).

### ToolRouter Registration

```
Orchestrator/src/routing/tool-router.ts
```

After discovery, the Orchestrator:

1. Initializes Guardian first (identified by `role: "guardian"`)
2. Registers all stdio MCPs via `toolRouter.registerMCP(name, client)`
3. Registers all HTTP MCPs via `HttpMCPClient`
4. Calls `toolRouter.discoverTools()` to build the routing table

`discoverTools()` iterates over registered MCPs, calls `client.listTools()`, and builds a map of exposed tool names to routes (MCP client + original tool name).

---

## Tool Naming and Prefixing

The ToolRouter uses `alwaysPrefix: true` with `separator: '_'`:

```
Original (MCP-internal)    →    Exposed (ToolRouter)
─────────────────────────────────────────────────────
execute_code (CodeExec)    →    codexec_execute_code
create_file (Filer)        →    filer_create_file
web_search (Searcher)      →    searcher_web_search
list_emails (Gmail)        →    gmail_list_emails
send_message (Telegram)    →    telegram_send_message
```

This means:
- Every tool gets a prefix: `{mcpName}_{originalName}`
- Glob patterns like `codexec_*` match all tools from a given MCP
- No naming conflicts between MCPs that might use the same internal name

The Orchestrator also enhances tool descriptions with service/group tags:
```
[Searcher | Search] Search the web for information
```

---

## Tool Selection

When a message arrives at the Thinker, it doesn't send all 70+ tools to the LLM. Instead, it selects a relevant subset. There are three selection methods, used in different contexts:

```
                    ┌─────────────────────────┐
                    │   Message arrives        │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  Is this a skill with   │
                    │  required_tools?        │
                    └────────┬───────┬────────┘
                        Yes  │       │  No
                             ▼       ▼
              ┌──────────────┐   ┌──────────────────┐
              │ Direct       │   │ Is embedding      │
              │ resolution   │   │ selector ready?   │
              │ (3-5 tools)  │   └──────┬─────┬──────┘
              └──────────────┘      Yes │     │ No
                                       ▼     ▼
                            ┌──────────┐ ┌──────────┐
                            │ Embedding│ │ Regex    │
                            │ + Regex  │ │ only     │
                            │ merge    │ │(fallback)│
                            └──────────┘ └──────────┘
```

### Regex-Based Selection

```
Thinker/src/agent/tool-selector.ts
```

Tools are organized into **groups**:

| Group | Tools | Pattern |
|-------|-------|---------|
| `core` | `send_telegram`, `store_fact`, `search_memories`, `get_status`, `spawn_subagent` | Always included |
| `search` | `searcher_web_search`, `searcher_news_search`, `searcher_image_search`, `searcher_web_fetch` | Explicit list |
| `memory` | All `memory_*` tools | Glob |
| `email` | 20 Gmail email tools | Explicit list |
| `calendar` | 8 Gmail calendar tools | Explicit list |
| `telegram` | All `telegram_*` tools | Glob |
| `files` | All `filer_*` tools | Glob |
| `passwords` | All `onepassword_*` tools | Glob |
| `browser` | 9 browser automation tools | Explicit list |
| `jobs` | Job management + skill tools | Explicit list |
| `codexec` | All `codexec_*` tools | Glob |

**Keyword routes** map regex patterns against the user message to activate groups:

```
/weather|search|who is|what is/    →  search
/email|inbox|compose/              →  email
/calendar|meeting|schedule/        →  calendar
/remember|memory|fact/             →  memory
/photo|picture|image/              →  search + telegram
/browse|website|https?:\/\//       →  browser + search
/cron|remind me|recurring/         →  jobs
```

When **no keywords match**, the default groups `['search', 'memory']` are activated.

Glob patterns (e.g., `memory_*`) are expanded against the full tool map at runtime by converting to regex (`memory_.*`).

After selection (both regex-only and embedding+regex paths), a **hard cap** is applied (default 25, configurable via `TOOL_SELECTOR_MAX_TOOLS`). If the merged result exceeds the cap, tools are dropped using tiered priority:

1. **Tier 1** (always kept): Core tools — `send_telegram`, `store_fact`, `search_memories`, `get_status`, `spawn_subagent`
2. **Tier 2** (kept by score): Tools with embedding scores, sorted descending
3. **Tier 3** (kept last): Regex-only tools (no embedding score), alphabetical

### Embedding-Based Selection

```
Thinker/src/agent/embedding-tool-selector.ts
```

Uses semantic similarity to find relevant tools:

**Initialization:**
1. For each tool, build a text representation: `"toolName: description"`
2. Generate embeddings via Ollama (`nomic-embed-text`) or LM Studio
3. Cache embeddings to disk (JSON with base64-encoded Float32Arrays)
4. Cache is keyed by provider + model — automatically invalidated on change

**Selection algorithm:**
1. Embed the user message
2. Compute cosine similarity between message embedding and each tool embedding
3. Sort tools by similarity descending
4. Build selected set:
   - Always include core tools (5 tools)
   - Include top `minTools` (default 5) regardless of threshold
   - Include up to `topK` (default 15) tools above `similarityThreshold` (default 0.3)

**Configuration** (environment variables):
- `TOOL_SELECTOR_THRESHOLD` — similarity threshold (default 0.3)
- `TOOL_SELECTOR_TOP_K` — max tools to select (default 15)
- `TOOL_SELECTOR_MIN_TOOLS` — min tools to include (default 5)
- `EMBEDDING_PROVIDER` — `ollama` or `lmstudio`

### Selection Merge Logic

```
Thinker/src/agent/tool-selection.ts
```

When embedding selection is available, both methods run and results are merged:

```
┌───────────────────┐     ┌───────────────────┐
│ Embedding selector│     │  Regex selector    │
│ (semantic)        │     │  (keyword)         │
│ ~15 tools         │     │  ~10-25 tools      │
└────────┬──────────┘     └────────┬───────────┘
         │                         │
         └──────────┬──────────────┘
                    ▼
         ┌──────────────────┐
         │  Merged result   │
         │  Union of both   │
         │  ~15-30 tools    │
         └──────────────────┘
```

Rationale: Regex encodes curated domain knowledge that pure semantic similarity can miss. For example, image requests need both `search` (to find images) AND `telegram` (to send them) — a semantic model might only catch the search aspect.

The merge is additive — embedding results take priority, regex results fill gaps. After merging, the tool cap is applied if the total exceeds `MAX_TOOLS` (default 25).

**Logging:**
```
Tool selection: method=embedding+regex, embedding=15, regex added=8, total=23/72, topScore=0.682
Tool cap: kept 25/35, dropped 10: extra_tool_1, extra_tool_2, ...
```

### Sticky Tools (Sliding Window)

```
Thinker/src/agent/loop.ts
```

When users send follow-up messages like "what about the other one?" or "send it to John too", the embedding selector may not match the same tools that were used in the previous turn. Sticky tools solve this by injecting recently-used tools into the current selection.

**How it works:**

After each turn, non-core tools that were called are recorded in a sliding window (`state.recentToolsByTurn[]`). Before the next LLM call, these tools are injected into the selected set — ensuring follow-up messages can still call them even when the embedding selector picks different tools.

```
Turn 1: User says "search for AI news"
  → Embedding selects: searcher_web_search, searcher_news_search
  → Tools used: searcher_news_search
  → Recorded: [{ turnIndex: 1, tools: ['searcher_news_search'] }]

Turn 2: User says "send me the second one"
  → Embedding selects: telegram_send_message (no search tools matched)
  → Sticky injection: searcher_news_search (from turn 1)
  → LLM can now call both telegram_send_message AND searcher_news_search
```

**Algorithm:**

1. After each turn: collect non-core tools from `result.steps[].toolCalls` (plus recovered leaked calls)
2. Append to `state.recentToolsByTurn[]` with incrementing `turnIndex`
3. Trim array to `STICKY_TOOLS_LOOKBACK` most recent entries (default: 3 turns)
4. Before next LLM call: iterate newest-first, collect tool names not already selected and not in core set
5. Inject up to `STICKY_TOOLS_MAX` (default: 8) sticky tools into `selectedTools`

**Configuration:**

| Variable | Default | Description |
|----------|---------|-------------|
| `THINKER_STICKY_TOOLS_LOOKBACK` | 3 | How many recent turns to track |
| `THINKER_STICKY_TOOLS_MAX` | 8 | Max sticky tools to inject per turn |

**Logging:**
```
[sticky-tools] Injected 2 tool(s) from recent turns: searcher_news_search, searcher_web_fetch
```

### Required Tools (Skill Shortcut)

```
Thinker/src/agent/loop.ts — processProactiveTask()
```

Skills declare a `required_tools` array in the database (e.g., `["gmail_get_new_emails", "memory_list_contacts", "memory_list_projects"]`). When a skill executes, these tool names are resolved directly against the Thinker's tool map — **bypassing both embedding and regex selection entirely**.

This was introduced to solve a token waste problem: when keyword selection ran against skill instruction text (which mentions tool names like "gmail_get_new_emails"), it triggered multiple keyword routes (`email`, `memory`, etc.), pulling in 72+ tools. With `required_tools`, a skill that needs 3 tools gets exactly 3 tools.

```
Before (keyword selection on instructions):
  Email Processor instructions mention "gmail", "memory", "email" →
  Regex matches: email (20 tools) + memory (15 tools) + core (5 tools) +
  calendar (8 tools, "schedule" keyword) + ...
  Result: 72 tools → ~14K tokens of tool definitions

After (required_tools):
  required_tools: ['gmail_get_new_emails', 'memory_list_contacts', 'memory_list_projects']
  Result: 3 tools → ~600 tokens of tool definitions
```

**Logging:**
```
Tool selection: method=required_tools, resolved=3/3
```

---

## Tool Argument Normalization

When the LLM calls a tool, the arguments pass through a normalization pipeline in the Thinker before reaching the Orchestrator. This fixes common LLM quirks (especially with Groq/Llama models).

```
Thinker/src/orchestrator/tools.ts
```

```
LLM tool call args
        │
        ▼
coerceStringBooleans()      ← "true" → true, "false" → false
        │
        ▼
stripNullValues()           ← removes keys with null values
        │                      (LLMs send null instead of omitting optional params)
        │
        ▼
stripHallucinatedParams()   ← removes known hallucinated params
        │                      (e.g., teamId/slug on vercel_* tools)
        │
        ▼
injectChatId()              ← fixes telegram_send_message chat_id
        │                      replaces missing, non-string, or
        │                      suspiciously long (>20 char) values
        │                      with real primary chat_id from channel manager
        │
        ▼
POST /tools/call → Orchestrator → MCP
```

Additionally, `relaxSchemaTypes()` modifies the JSON Schema definitions sent to the LLM:

- Numeric types accept strings too (`"type": "number"` → `"type": ["number", "string"]`)
- Boolean types accept strings too
- Optional properties also accept `null`

This prevents schema validation failures when the LLM sends `"5"` instead of `5` or `null` for an optional param.

---

## Tool Execution Flow

### Interactive Messages (User via Telegram)

```
┌──────────┐    ┌──────────────┐    ┌─────────────┐
│ Telegram │───▶│ Orchestrator │───▶│   Thinker   │
│  User    │    │   (:8010)    │    │   (:8006)   │
└──────────┘    └──────────────┘    └──────┬──────┘
                                          │
                                   1. Build context
                                      (memories, history,
                                       system prompt)
                                          │
                                   2. Select tools
                                      (embedding + regex)
                                          │
                                   3. Call LLM with
                                      selected tools
                                          │
                              ┌───────────▼───────────┐
                              │    LLM (Groq/etc.)    │
                              │  Decides which tools  │
                              │  to call (if any)     │
                              └───────────┬───────────┘
                                          │
                              For each tool call:
                                          │
                              ┌───────────▼───────────┐
                              │  Thinker sends        │
                              │  POST /tools/call     │
                              │  to Orchestrator      │
                              └───────────┬───────────┘
                                          │
                              ┌───────────▼───────────┐
                              │  ToolRouter resolves  │
                              │  prefixed name →      │
                              │  MCP client + orig    │
                              │  tool name            │
                              └───────────┬───────────┘
                                          │
                              ┌───────────▼───────────┐
                              │  MCP executes tool    │
                              │  (stdio or HTTP)      │
                              └───────────┬───────────┘
                                          │
                              Result flows back:
                              MCP → Orchestrator →
                              Thinker → LLM (next step)
                                          │
                              ┌───────────▼───────────┐
                              │  After all steps:     │
                              │  - Sanitize response  │
                              │  - Track cost         │
                              │  - Save session       │
                              │  - Send to Telegram   │
                              └───────────────────────┘
```

**Key details:**
- The Vercel AI SDK manages the multi-step loop (`maxSteps: 8` for interactive, configurable for skills)
- Each step can include multiple tool calls (the model decides)
- After tool results return, the SDK feeds them back to the LLM for the next step
- `onStepFinish` callback tracks each step for logging

### Skill Execution (Proactive Tasks)

```
┌───────────┐     ┌──────────────┐     ┌──────────────┐     ┌───────────┐
│  Inngest  │────▶│ Orchestrator │────▶│ ThinkerClient│────▶│  Thinker  │
│ Scheduler │     │ (functions)  │     │  (HTTP POST) │     │  (:8006)  │
│  (1 min)  │     │              │     │              │     │           │
└───────────┘     └──────────────┘     └──────────────┘     └─────┬─────┘
                                                                  │
                                                    processProactiveTask()
                                                                  │
                                                    1. No conversation history
                                                       (instructions as
                                                        single user message)
                                                                  │
                                                    2. Tool selection via
                                                       required_tools
                                                       (direct resolution)
                                                                  │
                                                    3. LLM executes with
                                                       3-5 tools, not 72+
                                                                  │
                                                    4. Post-completion:
                                                       - Store summary
                                                       - Skip trivial results
                                                       - Notify via Telegram
                                                       - Update skill status
```

Differences from interactive flow:
- No conversation history — task instructions are the sole user message
- `send_telegram` is always stripped from available tools (notifications handled post-completion)
- Tool selection uses `required_tools` directly (no keyword/embedding matching)
- Results classified as trivial (e.g., "no new emails") skip Telegram notification

### Hallucination Guard

```
Thinker/src/agent/loop.ts (lines 936-980)
```

LLMs sometimes claim they performed an action ("I've sent the email", "Event created for Monday") without actually calling any tools. The hallucination guard detects this and forces a retry.

**Detection:**

After the LLM responds, the guard checks two conditions:

1. **No tools were used** — all steps have empty `toolCalls` arrays and no leaked tool calls were recovered
2. **Response claims an action** — matches a regex pattern covering phrases like:
   - "I've created/sent/scheduled/deleted/updated..."
   - "has been created/sent/scheduled..."
   - "Email sent", "Event details:", "Here's the email I sent"
   - "I searched for", "I looked up", "I checked your"

If both conditions are true, the model hallucinated an action.

**Retry:**

1. Re-run `generateText()` with `toolChoice: 'required'` (forces the LLM to call at least one tool)
2. Cap temperature at 0.3 (reduces creativity, increases reliability)
3. Same system prompt, conversation history, and selected tools
4. Token usage from the retry is recorded separately in the cost monitor

**Outcome:**

- If the retry calls tools → accept the retry result, discard the hallucinated response
- If the retry still doesn't call tools → replace response with: "I wasn't able to complete this action. Please try again."
- If the retry throws an error → same fallback message

**Logging:**

```
[hallucination-guard] Model claimed action without tool calls, retrying with toolChoice: required
[hallucination-guard] Retry successful — tools were called
```

---

## Skills and Scheduled Tool Use

For full details on skill creation, schema, trigger configuration, scheduling, and the two-tier execution model, see [tooling-and-skills-architecture.md](tooling-and-skills-architecture.md).

This section covers how skills interact with the **tool system** — specifically how the Thinker selects and uses tools during skill execution.

### Skill Execution in Thinker

```
Thinker/src/agent/loop.ts — processProactiveTask()
```

```
processProactiveTask(instructions, maxSteps, notifyChatId, noTools, requiredTools)
         │
         ├── 1. Cost control pause check
         │       If paused → return immediately
         │
         ├── 2. Rate limiting (min 1s between API calls)
         │
         ├── 3. Tool refresh (10-min TTL cache)
         │
         ├── 4. Build system prompt
         │       base prompt + "## Current Task" header
         │       + relevant memories (top 5)
         │
         ├── 5. Tool selection
         │       ┌─────────────────────────────────────┐
         │       │ if noTools → no tools               │
         │       │ if requiredTools → direct resolution │
         │       │ else → selectToolsWithFallback()    │
         │       │ Always remove send_telegram          │
         │       └─────────────────────────────────────┘
         │
         ├── 6. LLM call (generateText)
         │       model, system prompt, [instructions as user msg]
         │       tools, maxSteps, 90s timeout
         │
         ├── 7. Record token usage in cost monitor
         │
         ├── 8. Tool call recovery
         │       Detect leaked tool calls (LLM outputs JSON
         │       instead of structured tool use) → re-execute
         │
         └── 9. Store execution summary in memory
                  store_fact(summary, category: 'pattern')
```

### Required Tools Data Flow

The `required_tools` array flows through four files:

```
┌─────────────────────────────────────────────────────────────────┐
│ Memorizer DB                                                     │
│ skills table → required_tools: '["gmail_get_new_emails", ...]'  │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ memory_list_skills
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Orchestrator/src/jobs/skill-scheduler.ts                         │
│                                                                  │
│ Parse: JSON string or array → string[]                           │
│ Pass to: client.executeSkill(..., parsedRequiredTools)           │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ HTTP call
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Orchestrator/src/agents/thinker-client.ts                       │
│                                                                  │
│ executeSkill(..., requiredTools?: string[])                      │
│ JSON.stringify({ ..., requiredTools }) → POST /execute-skill    │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ HTTP POST
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Thinker/src/index.ts                                            │
│                                                                  │
│ const { ..., requiredTools } = req.body;                        │
│ agentRef.processProactiveTask(..., requiredTools)                │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ method call
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Thinker/src/agent/loop.ts — processProactiveTask()              │
│                                                                  │
│ if (requiredTools && requiredTools.length > 0) {                │
│   for (name of requiredTools)                                    │
│     selectedTools[name] = this.tools[name];                     │
│ }                                                                │
│ // Bypasses selectToolsWithFallback() entirely                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Context and Token Budget

Every LLM call includes several components, each consuming tokens:

```
┌─────────────────────────────────────────────────────────────┐
│                    LLM Input Composition                     │
│                                                              │
│  ┌────────────────────────────────────────────────────┐      │
│  │ System Prompt                          ~800-1200 tk│      │
│  │  - Base persona (instructions.md)                  │      │
│  │  - Current date/time                               │      │
│  │  - Chat context (chat_id)                          │      │
│  │  - Injected playbooks (if keyword match)           │      │
│  │  - Compaction summary (if history was compacted)   │      │
│  │  - Relevant memories (top 5 facts)     ~200-500 tk│      │
│  └────────────────────────────────────────────────────┘      │
│                                                              │
│  ┌────────────────────────────────────────────────────┐      │
│  │ Conversation History                  ~1000-5000 tk│      │
│  │  - Last 50 messages (slice(-50))                   │      │
│  │  - Repaired for valid alternation                  │      │
│  │  - Old tool results truncated to summaries         │      │
│  │  - Last 2 tool exchanges kept verbatim             │      │
│  └────────────────────────────────────────────────────┘      │
│                                                              │
│  ┌────────────────────────────────────────────────────┐      │
│  │ Tool Definitions                      ~500-3750 tk │      │
│  │  - JSON schemas for each selected tool             │      │
│  │  - ~100-200 tokens per tool                        │      │
│  │  - Hard cap: 25 tools max (TOOL_SELECTOR_MAX_TOOLS)│      │
│  │                                                    │      │
│  │  Interactive (capped at 25):        ~2500-3750 tk  │      │
│  │  Skill with required_tools (3-5):    ~300-600 tk   │      │
│  └────────────────────────────────────────────────────┘      │
│                                                              │
│  ┌────────────────────────────────────────────────────┐      │
│  │ User Message                            ~10-500 tk │      │
│  └────────────────────────────────────────────────────┘      │
│                                                              │
│  Total per turn:                                             │
│    Interactive:  ~4,000 - 8,000 tokens                       │
│    Skill (opt):  ~1,500 - 3,000 tokens                       │
└─────────────────────────────────────────────────────────────┘
```

### Why required_tools matters

Skills run without conversation history (just instructions as a single user message), but they were still expensive because the tool selection ran keyword matching against the instruction text. Instructions like:

> "Call gmail_get_new_emails to get unprocessed emails..."
> "Call memory_list_contacts..."

...triggered the `email` keyword route (20 tools), `memory` route (15 tools), and more — resulting in 72+ tools. Each tool definition is ~100-200 tokens of JSON schema, so 72 tools added ~7,000-14,000 tokens to every skill execution.

With `required_tools`, the Email Processor drops from 72 to 3 tools — saving ~13,000 tokens per run, or ~26,000 tokens per hour (runs every 30 minutes).

### Conversation History Management

```
Thinker/src/agent/loop.ts — buildContext()
Thinker/src/agent/history-repair.ts
```

- **Window**: Last 50 messages (`state.messages.slice(-50)`)
- **Repair**: `repairConversationHistory()` fixes orphan tool results, missing results, and mismatched tool-call/result pairs
- **Truncation**: `truncateHistoryToolResults()` replaces old tool results with one-line summaries to reduce token waste
- **Compaction**: When session exceeds a threshold, older messages are summarized by an LLM and the summary is injected into the system prompt
- **Session storage**: JSONL files in `~/.annabelle/sessions/{agentId}/`

#### History Tool Result Truncation

Tool results in conversation history can be very large (a single `web_fetch` can return 20K+ chars). The `truncateHistoryToolResults()` function reduces this by replacing old tool results with summaries while preserving the most recent exchanges.

```
History pipeline:
  state.messages.slice(-50)
    │
    ▼
  repairConversationHistory()    ← fix structural issues
    │
    ▼
  truncateHistoryToolResults(messages, preserveLastN=2)
    │
    ├── Tool results [0..N-2]:  replaced with "[toolName: truncated, was X chars]"
    └── Tool results [N-1..N]:  kept verbatim (last 2 exchanges)
```

**Token savings:** With 10 tool-result messages in a 50-message window, each historical result of ~500-5000 tokens is reduced to ~15 tokens. Potential savings: 5K-50K tokens per turn.

### Skill vs Interactive Comparison

| Dimension | Interactive | Skill (with required_tools) |
|-----------|-------------|----------------------------|
| System prompt | Full persona + injections | Persona + task header |
| History | Last 50 messages (old results truncated) | None (instructions only) |
| Tool selection | Embedding + regex (capped at 25) | Direct resolution |
| Tools passed | ~15-25 | ~3-5 |
| Tool tokens | ~1,500-3,750 | ~300-600 |
| History tokens | ~1,000-5,000 (truncated) | N/A |
| Total input | ~4,000-8,000 | ~1,500-3,000 |

---

## Cost Controls

```
Thinker/src/cost/monitor.ts
```

The cost monitor tracks token usage in a sliding 60-bucket window (one bucket per minute, covering 1 hour).

### How it works

```
┌───────────────────────────────────────────────────────────┐
│              Rolling 1-Hour Window                         │
│                                                            │
│  Minute 0   1   2   3   ...   55  56  57  58  59          │
│  ┌───┬───┬───┬───┬───────────┬───┬───┬───┬───┬───┐       │
│  │ 0 │120│ 0 │450│    ...    │800│ 0 │300│1.2k│500│       │
│  └───┴───┴───┴───┴───────────┴───┴───┴───┴───┴───┘       │
│                                    ▲                       │
│                              current minute                │
│                                                            │
│  Each bucket tracks:                                       │
│  - promptTokens                                            │
│  - completionTokens                                        │
│  - callCount                                               │
└───────────────────────────────────────────────────────────┘
```

### Threshold Checks

After every `recordUsage()` call:

1. **Hard cap**: Sum all tokens in the hour window. If >= `hardCapTokensPerHour` → pause agent.
2. **Spike detection**:
   - Compute short-window rate (last N minutes, default 5) in tokens/min
   - Compute baseline rate (remaining active buckets, excluding empty ones)
   - If baseline < `minimumBaselineTokens` → skip (prevents cold-start false positives)
   - If `shortRate > baselineRate * spikeMultiplier` → pause agent

### Pause and Resume

When paused:
- `processMessage()` returns immediately with a "paused" error
- `processProactiveTask()` returns immediately with a "paused" error
- A Telegram notification is sent to the configured chat

Resume via: `POST /cost-resume` (optionally `resetWindow: true` to zero all buckets)

### Configuration

Set per agent in `Orchestrator/agents.json` under `costControls`:

```json
{
  "costControls": {
    "enabled": true,
    "hardCapTokensPerHour": 250000,
    "shortWindowMinutes": 5,
    "spikeMultiplier": 3,
    "minimumBaselineTokens": 1000,
    "notifyChatId": "123456789"
  }
}
```

---

## Tool Refresh at Runtime

```
Thinker/src/agent/loop.ts — refreshToolsIfNeeded()
```

The Thinker detects new or removed tools without requiring a restart:

```
┌──────────────────────────────────────────────────────────┐
│                  Tool Refresh Flow                         │
│                                                            │
│  Before each message processing:                           │
│                                                            │
│  1. Call orchestrator.getCachedToolsOrRefresh()             │
│     └─ 10-minute TTL cache in OrchestratorClient           │
│     └─ If stale: GET /tools/list from Orchestrator         │
│                                                            │
│  2. Compare fresh tool names vs current tool names          │
│     └─ Set equality check (size + every element)           │
│                                                            │
│  3. If changed:                                            │
│     └─ Log added/removed tools                             │
│     └─ Rebuild dynamic tool map from Orchestrator          │
│     └─ Rebuild essential tools (send_telegram, etc.)       │
│     └─ Merge: this.tools = { ...dynamic, ...essential }   │
│     └─ Re-initialize embedding selector                    │
│        (cached embeddings make this fast for existing)     │
│                                                            │
│  Result: New MCPs auto-discovered within ~10 minutes       │
│          No restart needed                                  │
└──────────────────────────────────────────────────────────┘
```

---

## File Reference

| Component | File | Key Lines |
|-----------|------|-----------|
| MCP Auto-Discovery | `Shared/Discovery/scanner.ts` | Scanner logic |
| Tool Router | `Orchestrator/src/routing/tool-router.ts` | Registration, discovery, routing |
| HTTP Tool Endpoints | `Orchestrator/src/core/http-handlers.ts` | `/tools/list`, `/tools/call` |
| Thinker Message Endpoint | `Thinker/src/index.ts` | `/process-message`, `/execute-skill` |
| Agent Loop | `Thinker/src/agent/loop.ts` | `processMessage()`, `processProactiveTask()`, `buildContext()`, `refreshToolsIfNeeded()` |
| Embedding Tool Selector | `Thinker/src/agent/embedding-tool-selector.ts` | Initialization, selection, caching, `getLastScores()` |
| Tool Selection Merge | `Thinker/src/agent/tool-selection.ts` | `selectToolsWithFallback()`, `applyToolCap()` |
| Regex Tool Selector | `Thinker/src/agent/tool-selector.ts` | Groups, keyword routes, `selectToolsForMessage()` |
| History Repair & Truncation | `Thinker/src/agent/history-repair.ts` | `repairConversationHistory()`, `truncateHistoryToolResults()` |
| Cost Monitor | `Thinker/src/cost/monitor.ts` | Sliding window, thresholds, pause/resume |
| Tool Argument Normalization | `Thinker/src/orchestrator/tools.ts` | `relaxSchemaTypes()`, `stripNullValues()`, `injectChatId()`, `coerceStringBooleans()` |
| Inngest Skill Scheduler | `Orchestrator/src/jobs/skill-scheduler.ts` | Auto-enable, cron matching, tier routing, pre-flight checks |
| Skill Normalizer | `Orchestrator/src/utils/skill-normalizer.ts` | Input normalization, graduated backoff |
| Direct Tier Executor | `Orchestrator/src/jobs/executor.ts` | `executeWorkflow()`, `executeToolCall()` |
| Tool Catalog | `Orchestrator/src/tools/tool-catalog.ts` | `get_tool_catalog` — tool discovery for LLMs |
| Thinker Client | `Orchestrator/src/agents/thinker-client.ts` | `executeSkill()` HTTP call |
| Skill Schema | `Memorizer-MCP/src/db/schema.ts` | `SkillRow` interface, skills table |
| Skill Seeding | `_scripts/seed-cron-skills.ts` | Skill definitions, `--update` mode |
