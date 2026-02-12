# Prompt Creation & Tool Injection

How the Thinker agent's system prompt is assembled, how dynamic context is injected per message, and how tools are selected and passed to the LLM.

---

## Table of Contents

1. [Overview](#overview)
2. [System Prompt Priority Chain](#system-prompt-priority-chain)
3. [Dynamic Prompt Layers (Interactive Messages)](#dynamic-prompt-layers-interactive-messages)
4. [Proactive Task Prompt (Skills)](#proactive-task-prompt-skills)
5. [How Tools Are Passed to the LLM](#how-tools-are-passed-to-the-llm)
6. [Per-Agent Customization (Orchestrator Side)](#per-agent-customization-orchestrator-side)
7. [Playbook & Skill Injection Details](#playbook--skill-injection-details)
8. [Conversation History as Context](#conversation-history-as-context)
9. [Fact Extraction Prompt (Separate Pipeline)](#fact-extraction-prompt-separate-pipeline)
10. [Suggestions for Improvement](#suggestions-for-improvement)

---

## Overview

Prompt creation spans two services: the **Orchestrator** (which configures and spawns agents) and the **Thinker** (which assembles the final prompt per message). There are two distinct prompt paths:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        INTERACTIVE MESSAGE PATH                      │
│                                                                      │
│  Orchestrator                          Thinker                       │
│  ┌──────────────────────┐              ┌─────────────────────────┐   │
│  │ Agent config          │   spawn     │ initialize()            │   │
│  │ - systemPrompt field  │ ──────────▶ │ - Load custom prompt    │   │
│  │ - write to temp file  │   (env      │ - Load persona file     │   │
│  │ - set env vars        │    vars)    │ - Discover tools        │   │
│  └──────────────────────┘              └───────────┬─────────────┘   │
│                                                     │                 │
│                                           per message                │
│                                                     ▼                 │
│                                        ┌──────────────────────────┐  │
│                                        │ buildContext()            │  │
│                                        │                          │  │
│                                        │ 1. Select base prompt    │  │
│                                        │    (custom > persona     │  │
│                                        │     > default)           │  │
│                                        │                          │  │
│                                        │ 2. Profile override?     │  │
│                                        │                          │  │
│                                        │ 3. Append dynamic layers │  │
│                                        │    - Playbooks           │  │
│                                        │    - Available skills    │  │
│                                        │    - Date/time           │  │
│                                        │    - Chat ID             │  │
│                                        │    - Compaction summary  │  │
│                                        │    - Relevant memories   │  │
│                                        └───────────┬──────────────┘  │
│                                                     │                 │
│                                                     ▼                 │
│                                        ┌──────────────────────────┐  │
│                                        │ generateText()           │  │
│                                        │                          │  │
│                                        │  system: assembled prompt│  │
│                                        │  messages: history       │  │
│                                        │  tools: selected subset  │  │
│                                        └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        PROACTIVE TASK PATH                           │
│                                                                      │
│  Same base prompt selection (custom > persona > default)             │
│  + Date/time + "## Current Task" header + relevant memories          │
│  NO: playbooks, available skills, chat ID, compaction summary        │
│  Task instructions = sole user message (no conversation history)     │
└─────────────────────────────────────────────────────────────────────┘
```

### Key source files

| File | Role |
|------|------|
| `Thinker/src/agent/loop.ts` | `DEFAULT_SYSTEM_PROMPT`, `buildContext()`, `processProactiveTask()`, `initialize()` |
| `Orchestrator/src/agents/agent-manager.ts` | `spawnAgent()`, `buildAgentEnv()` — writes prompt file, sets env vars |
| `Orchestrator/src/config/agents.ts` | `AgentDefinition` schema, channel bindings |
| `Orchestrator/src/tools/spawn-subagent.ts` | Subagent prompt: `task` → `systemPrompt` |
| `Thinker/src/agent/playbook-classifier.ts` | `classifyMessage()` — keyword matching |
| `Thinker/src/agent/playbook-cache.ts` | Merges database + file-based playbooks |
| `Thinker/src/agent/skill-loader.ts` | Parses `~/.annabelle/skills/*/SKILL.md` |
| `Thinker/src/agent/fact-extractor.ts` | Post-conversation fact extraction prompt |
| `Thinker/src/orchestrator/tools.ts` | Wraps MCP tools → Vercel AI SDK tools |

---

## System Prompt Priority Chain

On `Agent.initialize()`, two static prompt sources are loaded. Then on every message, the base is selected from three candidates:

```
Priority 1 ─── Custom file prompt (THINKER_SYSTEM_PROMPT_PATH env var)
    │               Written by AgentManager to ~/.annabelle/agent-prompts/{agentId}.txt
    │               Set when agent config has a non-empty systemPrompt field
    │
    ├── If not set ──▶ Priority 2 ─── Persona file
    │                       Loaded from ~/.annabelle/agents/{agentId}/instructions.md
    │                       Each agent ID has its own persona directory
    │                       Configurable via THINKER_PERSONA_DIR env var
    │
    ├── If not found ──▶ Priority 3 ─── Built-in DEFAULT_SYSTEM_PROMPT
    │                       ~160 lines hardcoded in loop.ts (lines 34-157)
    │                       Defines the "Annabelle" persona: memory usage,
    │                       proactive learning, email/calendar/search,
    │                       external service tool guidance (discover-then-act),
    │                       action-first rule, response format rules
    │
    └── Profile Override ─── After selecting the base, if the user's Memorizer
                              profile has persona.system_prompt set, that value
                              REPLACES the selected base entirely.
                              Allows runtime persona changes via memory system.
```

### How the custom prompt flows from Orchestrator to Thinker

```
agents.json                  AgentManager                      Thinker
┌─────────────────┐          ┌─────────────────────────┐       ┌──────────────────┐
│ {                │          │ spawnAgent(definition)   │       │ initialize()     │
│   "agentId":     │          │                          │       │                  │
│     "annabelle", │  load    │  1. Write systemPrompt   │ env   │  Read file at    │
│   "systemPrompt":│ ──────▶ │     to temp file:         │ var   │  THINKER_SYSTEM_ │
│     "You are..." │          │     ~/.annabelle/         │ ────▶│  PROMPT_PATH     │
│ }                │          │     agent-prompts/        │       │                  │
└─────────────────┘          │     annabelle.txt         │       │  Store as        │
                              │                          │       │  this.custom-    │
                              │  2. buildAgentEnv()       │       │  SystemPrompt    │
                              │     sets THINKER_SYSTEM_  │       └──────────────────┘
                              │     PROMPT_PATH           │
                              └─────────────────────────┘
```

If the agent config has an **empty `systemPrompt`** (the default), no temp file is written, the env var is not set, and Thinker falls through to the persona file or built-in default.

---

## Dynamic Prompt Layers (Interactive Messages)

`buildContext()` (`loop.ts:386-486`) appends six dynamic layers onto the base prompt. Each layer is simple string concatenation. The order matters — later layers appear at the end of the system prompt.

### Layer 1: Matched Playbooks (lines 413-425)

```typescript
// Refresh cached playbooks (5-min TTL for DB, file-based loaded at startup)
await this.playbookCache.refreshIfNeeded(trace);

// Classify user message against all playbooks via keyword substring match
const matchedPlaybooks = classifyMessage(userMessage, this.playbookCache.getPlaybooks());

// Inject matching playbooks' instructions
if (matchedPlaybooks.length > 0) {
  const section = matchedPlaybooks
    .map((pb) => `### Playbook: ${pb.name}\n${pb.instructions}`)
    .join('\n\n');
  systemPrompt += `\n\n## Workflow Guidance\nFollow these steps when relevant:\n\n${section}`;
}
```

Multiple playbooks can match simultaneously. They are sorted by priority (highest first). Required tools from matched playbooks are collected and later force-injected into the tool set (see [How Tools Are Passed](#how-tools-are-passed-to-the-llm)).

### Layer 2: Available Skills — Progressive Disclosure (lines 427-437)

File-based skills (`~/.annabelle/skills/*/SKILL.md`) that have **no keywords** are injected as XML descriptions. This tells the LLM what capabilities exist without injecting full instructions:

```xml
<available_skills>
  <skill>
    <name>code-review</name>
    <description>Reviews code for quality, security, and best practices</description>
  </skill>
</available_skills>
```

Skills **with keywords** participate in playbook classification (Layer 1) and inject their full instructions when matched.

### Layer 3: Date/Time (lines 439-452)

```
## Current Date & Time
Wednesday, February 12, 2026, 14:30 (America/New_York)
```

Timezone comes from the `USER_TIMEZONE` env var. Formatted with `Intl.DateTimeFormat`.

### Layer 4: Chat ID (lines 454-455)

```
## Current Chat
chat_id: 123456789
```

Injected so the LLM passes the correct `chat_id` parameter when calling tools like `send_telegram` or `store_fact`.

### Layer 5: Compaction Summary (lines 457-460)

If the conversation history was previously compacted (older turns summarized by an LLM), the summary is injected:

```
## Previous Conversation Context
[LLM-generated summary of earlier turns]
```

This only appears for long-running sessions where history exceeded the compaction threshold.

### Layer 6: Relevant Memories (lines 462-468)

Up to 5 facts retrieved from the Memorizer MCP via `orchestrator.retrieveMemories()`. The retrieval query is the user's message text:

```
Relevant memories about the user:
- Prefers dark mode (preference)
- Lives in Krakow (background)
- Working on MCP orchestrator project (project)
```

### What the assembled prompt looks like

```
[Base prompt: ~150 lines of persona/instructions]

## Workflow Guidance
Follow these steps when relevant:

### Playbook: email-triage
1. Call gmail_get_new_emails...
2. For each email...

<available_skills>
  <skill>
    <name>code-review</name>
    <description>Reviews code for quality, security, and best practices</description>
  </skill>
</available_skills>

## Current Date & Time
Wednesday, February 12, 2026, 14:30 (America/New_York)

## Current Chat
chat_id: 123456789

## Previous Conversation Context
[Earlier conversation summary, if compacted]

Relevant memories about the user:
- Prefers dark mode (preference)
- Lives in Krakow (background)
```

---

## Proactive Task Prompt (Skills)

`processProactiveTask()` (`loop.ts:1137-1246`) builds a simpler prompt for scheduled/cron skill executions.

### What's the same

- Same base prompt priority chain: `customSystemPrompt || personaPrompt || DEFAULT_SYSTEM_PROMPT`
- Current date/time appended with the same formatter
- Relevant memories (top 5) retrieved and appended

### What's different

| Aspect | Interactive | Proactive Task |
|--------|------------|----------------|
| Profile persona override | Yes — replaces base if set | **No** — uses base as-is |
| Playbook injection | Yes — keyword-matched | **No** |
| Available skills | Yes — progressive disclosure | **No** |
| Chat ID | Yes — injected | **No** |
| Compaction summary | Yes — if available | **No** |
| `## Current Task` header | No | **Yes** — appended with instructions |
| Conversation history | Last 50 messages (repaired, truncated) | **None** — task instructions as sole user message |

### Proactive task system prompt structure

```
[Base prompt]

## Current Date & Time
Wednesday, February 12, 2026, 14:30 (Europe/Warsaw)

## Current Task
You are executing an autonomous scheduled task. There is no user message —
follow the instructions below as your goal. Complete the task step by step,
using your available tools. When done, provide a brief summary of what you
accomplished.

Relevant memories:
- [fact 1]
- [fact 2]
```

The task instructions are then passed as the sole user message:

```typescript
const result = await generateText({
  model: this.modelFactory.getModel(),
  system: systemPromptWithContext,
  messages: [{ role: 'user', content: taskInstructions }],
  tools: selectedTools,
  maxSteps,
});
```

---

## How Tools Are Passed to the LLM

Tools are **not listed in the system prompt text**. They are passed as structured JSON schemas to the Vercel AI SDK's `generateText()` call via the `tools` parameter. The LLM sees them as callable functions.

For complete tool selection details (embedding-based, regex-based, required_tools, merging, caps), see [tools.md](tools.md).

### Tool choice strategy

The `toolChoice` parameter is always set to `'auto'`. Previously, the system tried conditional `'required'` enforcement (based on embedding scores > 0.7 or action verb detection), but this caused crashes with Groq/Llama on multi-step calls — `'required'` forces tool calls on **every** step, which fails when the model needs to summarize results with text on step 2+. The playbook instructions, system prompt, and embedding-selected tools provide sufficient guidance for the model to call tools voluntarily.

Temperature is dynamically lowered to `min(config.temperature, 0.3)` when the embedding tool selector has a top score > 0.6 — this improves tool calling reliability for high-confidence matches.

### Interactive message tool flow

```
buildContext()                     processMessage()
    │                                   │
    │ collects                          │
    │ playbookRequiredTools             │
    │                                   ▼
    │                          selectToolsWithFallback()
    │                                   │
    │                          ┌────────┴────────┐
    │                          │ Embedding + Regex│
    │                          │ (see tools.md)   │
    │                          └────────┬────────┘
    │                                   │ ~15-25 tools
    │                                   ▼
    │                          Force-inject playbook
    └─────────────────────────▶ required_tools
                                        │
                                        ▼
                               generateText({
                                 tools: selectedTools,
                                 toolChoice: 'auto'
                               })
```

After tool selection (`loop.ts:554-565`), any tools required by matched playbooks are force-injected:

```typescript
for (const name of context.playbookRequiredTools) {
  if (!selectedTools[name] && this.tools[name]) {
    selectedTools[name] = this.tools[name];
  }
}
```

### Proactive task tool flow

Three paths (`loop.ts:1221-1237`):

1. `noTools === true` → no tools passed
2. `requiredTools` array provided → resolve those exact tools from the tool map (bypass all selection)
3. Neither → fall back to `selectToolsWithFallback()` (same as interactive)

In all cases, `send_telegram` is always removed — notifications are handled post-completion.

### Tool wrapping (MCP → Vercel AI SDK)

`Thinker/src/orchestrator/tools.ts` wraps each Orchestrator tool into a Vercel AI SDK `tool()`:
- Uses `jsonSchema()` to pass the MCP's original JSON Schema directly (avoids lossy Zod roundtrip)
- Relaxes numeric/boolean types to also accept strings (workaround for Groq/Llama sending `"5"` instead of `5`)
- Coerces string booleans (`"true"` → `true`) at call time
- Tools starting with `_` or named `health` are skipped

Three **essential tools** (`send_telegram`, `store_fact`, `search_memories`) are defined with native Zod schemas and override dynamic tools with the same name.

---

## Per-Agent Customization (Orchestrator Side)

### Agent Definition Fields

Defined in `Orchestrator/src/config/agents.ts`:

| Field | Type | Effect on Prompt/Tools |
|-------|------|----------------------|
| `agentId` | string | Determines persona file path (`~/.annabelle/agents/{agentId}/instructions.md`) |
| `systemPrompt` | string | Written to temp file, loaded as Priority 1 base prompt. Empty = skip. |
| `allowedTools` | string[] | Glob patterns for tool whitelist. Empty = all tools. |
| `deniedTools` | string[] | Glob patterns for tool blacklist. Deny overrides allow. |
| `llmProvider` | string | `groq` / `ollama` / `lmstudio` — determines model provider |
| `model` | string | Provider-specific model name |
| `temperature` | number | Per-agent LLM temperature |
| `maxSteps` | number | Max ReAct steps per message (default 8) |
| `costControls` | object | Anomaly-based rate limiting (see [cost-controls.md](cost-controls.md)) |

### Environment Variable Flow

`buildAgentEnv()` (`agent-manager.ts:396-455`) builds the env for each Thinker process:

```
Agent Config                  →    Environment Variable
──────────────────────────────────────────────────────────
agentId                       →    THINKER_AGENT_ID
port                          →    THINKER_PORT
llmProvider                   →    THINKER_LLM_PROVIDER
model (if groq)               →    GROQ_MODEL
model (if ollama)             →    OLLAMA_MODEL
model (if lmstudio)           →    LMSTUDIO_MODEL
temperature                   →    THINKER_TEMPERATURE
systemPrompt (file path)      →    THINKER_SYSTEM_PROMPT_PATH
costControls.enabled          →    THINKER_COST_CONTROL_ENABLED
costControls.*                →    THINKER_COST_* vars
(always)                      →    THINKER_POLLING_ENABLED=false
(always)                      →    THINKER_SEND_RESPONSE_DIRECTLY=false
(always)                      →    ORCHESTRATOR_URL (if not already set)
```

Parent env is inherited (for `GROQ_API_KEY`, etc.), then overridden with agent-specific values.

### Channel Bindings

The `bindings` array in agent config maps channels/chats to specific agents:

```json
[
  { "channel": "telegram", "chatId": "123456", "agentId": "work-assistant" },
  { "channel": "telegram", "chatId": "*", "agentId": "annabelle" }
]
```

First match wins — specific bindings go before wildcards. The matched agent gets spawned (if not already running) and receives the message. Each agent is a separate Thinker process with its own prompt chain.

### Subagent Prompts

When `spawn_subagent` is called, the `task` parameter becomes the subagent's `systemPrompt`:

```typescript
// agent-manager.ts:486
const subDef: AgentDefinition = {
  ...parentDef,
  agentId: subId,
  port: 0,  // dynamic
  systemPrompt: opts.task,  // ← task instructions become the system prompt
  allowedTools: /* subset of parent */,
  deniedTools: [...parentDef.deniedTools, 'spawn_subagent'],
};
```

The subagent then goes through the same prompt priority chain, but since `systemPrompt` is set, it becomes the custom file prompt (Priority 1). The subagent:
- Gets the task as its system prompt
- Receives the same task text again as the user message (via `processMessage`)
- Has a subset of the parent's tools (deny list includes `spawn_subagent`)
- Cannot spawn its own subagents (single-level)
- Auto-kills after configurable timeout (default 5 min)

---

## Playbook & Skill Injection Details

### Two Sources

1. **Database playbooks** (Memorizer MCP) — 14 seeded defaults covering email, calendar, search, memory, etc. Stored in the `skills` table with `trigger_type: 'event'`.

2. **File-based skills** (`~/.annabelle/skills/*/SKILL.md`) — follow the [agentskills.io](https://agentskills.io/specification) specification with Annabelle extensions in the `metadata` block.

Both sources are merged by `PlaybookCache` (`playbook-cache.ts`) into a single `CachedPlaybook[]` array.

### Keyword Classification

`classifyMessage()` (`playbook-classifier.ts`) performs simple lowercase substring matching:

```typescript
for (const pb of playbooks) {
  if (pb.keywords.some((kw) => lower.includes(kw))) {
    matched.push(pb);
  }
}
return matched.sort((a, b) => b.priority - a.priority);
```

- Multiple playbooks can match a single message
- Results sorted by priority (highest first)
- All matching playbooks' instructions are injected into the prompt
- All matching playbooks' `requiredTools` are collected and force-injected into the tool set

### Progressive Disclosure

File-based skills **without keywords** are not eligible for playbook classification. Instead, they are injected as brief `<available_skills>` XML descriptions (Layer 2). This tells the LLM what capabilities exist without bloating the prompt with full instructions.

### PlaybookCache Refresh

- **File-based skills**: Loaded once at startup via `SkillLoader.scan()`
- **Database playbooks**: Refreshed every 5 minutes from Memorizer MCP
- **Cache invalidation**: Forced when skill-modifying tools are called (`memory_store_skill`, `memory_update_skill`, `memory_delete_skill`)

### SKILL.md Format

```yaml
---
name: code-review
description: Reviews code for quality, security, and best practices
metadata:
  keywords: [review, code review, audit]
  priority: 5
  required_tools: [filer_read_file, codexec_execute_code]
---

## Instructions

1. Read the specified file using filer_read_file
2. Analyze the code for...
```

- `name` must match the directory name
- `metadata.keywords` → participates in playbook classification
- `metadata.required_tools` → force-injected when playbook matches
- No `keywords` → progressive disclosure only (description in `<available_skills>`)

---

## Conversation History as Context

For interactive messages, conversation history is a major context component alongside the system prompt.

### Processing Pipeline

```
state.messages (full session history)
        │
        ▼
slice(-50)                          ← keep last 50 messages
        │
        ▼
repairConversationHistory()          ← fix structural issues
        │                              - Remove orphan tool results
        │                              - Add placeholder results for missing tool calls
        │                              - Fix mismatched tool-call/result pairs
        │
        ▼
truncateHistoryToolResults(msg, 2)   ← reduce token waste
        │                              - Tool results [0..N-2]: replaced with
        │                                "[toolName: truncated, was X chars]"
        │                              - Tool results [N-1..N]: kept verbatim
        │                                (last 2 exchanges preserved)
        │
        ▼
Passed as `messages` to generateText()
```

### Retry Context Preservation

When a tool call fails mid-loop (e.g., a tool executes successfully but the follow-up LLM call errors), the system retries with context from captured steps. Each step's tool calls and tool results are recorded via an `onStepFinish` callback. On retry, `buildRetryMessages()` reconstructs the message array including:

1. The original conversation history
2. The user message
3. For each captured step: an `assistant` message with tool-call content + a `tool` message with tool-result content

This means the retry LLM call sees what already happened and can continue from where it left off rather than re-executing the same tool calls from scratch.

```text
First attempt:
  history + user msg → LLM → tool call A ✓ → tool call B ✗ (error)
                                   │
                        captured: step with A's call + result

Retry:
  history + user msg + [assistant: call A] + [tool: result A] → LLM → continues from B
```

A second retry (with rephrased message) also includes all captured steps from both previous attempts.

### Session Compaction

When a session exceeds a configurable threshold, older messages are summarized by a cheap LLM model. The summary is injected into the system prompt as `## Previous Conversation Context` (Layer 5), and the summarized messages are removed from the history array.

For full session management details, see [sessions.md](sessions.md).

---

## Fact Extraction Prompt (Separate Pipeline)

`Thinker/src/agent/fact-extractor.ts` is a completely independent prompt pipeline that runs **after** a conversation goes idle (default 5 minutes of no messages). It uses a cheap LLM model (from `ModelFactory.getCompactionModel()`) to extract facts the main agent may have missed.

### How it works

1. Triggered by idle timer (configurable via `THINKER_FACT_EXTRACTION_IDLE_MS`)
2. Takes recent conversation turns (minimum 4 messages / 2 exchanges)
3. Retrieves already-known facts for deduplication
4. Builds a structured extraction prompt:
   - Lists known facts under "DO NOT extract these again"
   - Formats the conversation as `User: ... / Assistant: ...`
   - Defines fact categories: `preference`, `background`, `pattern`, `project`, `contact`, `decision`
   - Asks for JSON output with confidence scores
5. Validates response with Zod schema
6. Filters by confidence threshold (default 0.7)
7. Stores extracted facts via `store_fact` tool

### Key differences from main prompt

- No system prompt — just a single user message with the extraction instructions
- No tools — pure text-to-JSON extraction
- Uses cheap/fast model, not the main agent model
- Maximum 5 facts per extraction
- Configurable via `THINKER_FACT_EXTRACTION_ENABLED`, `THINKER_FACT_EXTRACTION_IDLE_MS`, `THINKER_FACT_EXTRACTION_MAX_TURNS`

---

## Suggestions for Improvement

### 1. Profile Persona Override Missing from Proactive Tasks

**Issue:** `buildContext()` checks `profile.profile_data.persona.system_prompt` and replaces the base prompt for interactive messages. But `processProactiveTask()` does not — it always uses the raw base prompt.

**Impact:** If an operator changes the persona at runtime via the profile system, interactive messages reflect the change but scheduled skills do not.

**Location:** `loop.ts:407-409` (interactive) vs `loop.ts:1177` (proactive)

### ~~2. DEFAULT_SYSTEM_PROMPT Hardcoded in loop.ts~~ :white_check_mark:

~~**Issue:** The ~150-line default system prompt is a string constant at the top of `loop.ts`. Editing it requires modifying TypeScript source, rebuilding, and restarting.~~

**Done:** Extracted to `Thinker/prompts/default-system-prompt.md`, loaded at startup in `initialize()`. Hardcoded constant kept as ultimate fallback. Configurable via `THINKER_DEFAULT_SYSTEM_PROMPT_PATH` env var.

### ~~3. No Validation of Playbook required_tools~~ :white_check_mark:

~~**Issue:** When playbooks declare `required_tools`, those tools are force-injected after selection (`loop.ts:554-565`). But there's no validation that the tool actually exists in `this.tools`. If a playbook references a tool that's not currently registered (e.g., the MCP is down), the tool is silently skipped.~~

**Done:** Added `logger.warn()` when a required tool is not found in `this.tools` — logs `[playbook-tools] Required tool '{name}' not found (MCP may be down)`.

### ~~4. Fact Extraction Prompt Not Parameterized~~ :white_check_mark:

~~**Issue:** The fact extraction prompt in `fact-extractor.ts` is hardcoded. Unlike the main prompt (which has a priority chain with file overrides), the extraction prompt can only be changed by editing source code.~~

**Done:** Template extracted to `Thinker/prompts/fact-extraction-prompt.md` with `{{KNOWN_FACTS}}` / `{{CONVERSATION}}` placeholders. Loaded at startup via `loadExtractionPromptTemplate()`. Falls back to hardcoded prompt if file not found. Configurable via `THINKER_FACT_EXTRACTION_PROMPT_PATH` env var.

### ~~5. No Observability on Assembled Prompt Size~~ :white_check_mark:

~~**Issue:** The system logs tool selection results (count, method, scores) but does not log the total assembled system prompt size in tokens. This makes it harder to debug token budget issues.~~

**Done:** Added `[prompt-size]` log line after prompt assembly in both `buildContext()` and `processProactiveTask()`. Logs approximate token count (`chars / 4`) and character count.

### ~~6. Playbook Keyword Matching is Brittle~~ :white_check_mark:

~~**Issue:** `classifyMessage()` uses simple `message.toLowerCase().includes(keyword)` substring matching. This can produce false positives — e.g., the keyword `"file"` matches "profile", "meanwhile", etc.~~

**Done:** `classifyMessage()` now uses word-boundary regex matching (`\bkeyword\b`) via `matchesKeyword()`. Falls back to `includes()` for keywords starting/ending with non-word characters (e.g. `"c++"`, `".net"`) or if regex construction fails. Prevents false positives like `"file"` matching `"profile"`.

### 7. Subagent Prompt Double-Delivery

**Issue:** When a subagent is spawned, the `task` string is used as both the system prompt (via `systemPrompt` → temp file → `THINKER_SYSTEM_PROMPT_PATH`) AND the user message (via `client.processMessage({ text: task })`). The LLM sees the same text twice in different roles.

**Impact:** Minor token waste and potential confusion. The LLM may treat the user message as redundant with its system prompt.

**Suggestion:** Consider using a minimal system prompt for subagents (e.g., "You are a focused subagent. Complete the task in the user message.") and pass the full instructions only as the user message.

---

## File Reference

| Component | File | Key Functions/Lines |
|-----------|------|-------------------|
| Default system prompt | `Thinker/src/agent/loop.ts:34-150` | `DEFAULT_SYSTEM_PROMPT` constant |
| Prompt loading (init) | `Thinker/src/agent/loop.ts:218-240` | `initialize()` — loads custom + persona prompts |
| Context building | `Thinker/src/agent/loop.ts:386-486` | `buildContext()` — all 6 dynamic layers |
| Proactive prompt | `Thinker/src/agent/loop.ts:1137-1246` | `processProactiveTask()` — skill prompt assembly |
| Playbook injection | `Thinker/src/agent/loop.ts:554-565` | Force-inject playbook required tools |
| Agent spawning | `Orchestrator/src/agents/agent-manager.ts:187-295` | `spawnAgent()` — write prompt, set env, spawn |
| Agent env vars | `Orchestrator/src/agents/agent-manager.ts:396-455` | `buildAgentEnv()` |
| Subagent definition | `Orchestrator/src/agents/agent-manager.ts:478-500` | `spawnSubagent()` — task → systemPrompt |
| Agent config schema | `Orchestrator/src/config/agents.ts` | `AgentDefinition` type, `loadAgentsFromFile()` |
| Spawn subagent tool | `Orchestrator/src/tools/spawn-subagent.ts` | Task dispatch to subagent |
| Playbook classifier | `Thinker/src/agent/playbook-classifier.ts` | `classifyMessage()` — keyword matching |
| Playbook cache | `Thinker/src/agent/playbook-cache.ts` | DB + file skill merging, 5-min refresh |
| Playbook seeds | `Thinker/src/agent/playbook-seed.ts` | 14 default playbook definitions |
| Skill loader | `Thinker/src/agent/skill-loader.ts` | `SkillLoader.scan()` — parse SKILL.md files |
| History repair | `Thinker/src/agent/history-repair.ts` | `repairConversationHistory()`, `truncateHistoryToolResults()` |
| Fact extraction | `Thinker/src/agent/fact-extractor.ts` | `extractFactsFromConversation()` — separate prompt pipeline |
| Tool wrapping | `Thinker/src/orchestrator/tools.ts` | `createToolsFromOrchestrator()`, `createEssentialTools()` |
| Thinker config | `Thinker/src/config.ts` | All env var definitions and defaults |
