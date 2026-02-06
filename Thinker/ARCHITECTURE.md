# Thinker MCP - Architecture Plan

## Overview

Thinker is a standalone AI reasoning engine (sidecar) that processes Telegram messages autonomously, using Groq (default) or local LLM (LM Studio/Ollama), and can trigger any tool across the MCP ecosystem.

**Key Decisions:**
- **Sidecar architecture** - runs alongside existing stack
- **Mode flag** - only Thinker OR Claude Desktop active at a time (env switch)
- Access tools **via Orchestrator using MCP SDK over HTTP**
- **Solid foundation** with proper abstractions
- **Env-based LLM switching** (Groq/LM Studio/Ollama)
- **Centralized tracing** with trace_id in Shared library
- **Persona stored in Memorizer** profiles
- **Own setInterval** for polling (not Inngest)
- **Port 8006** for health checks
- **TypeScript** consistent with other MCPs
- **Cost safeguards** - circuit breaker, rate limiting, reduced maxSteps (see Safety section)

**Tech Stack:**
- **Vercel AI SDK** (`ai`, `@ai-sdk/openai`) - ReAct agent with `maxSteps`, unified provider interface
- **Zod** - Schema validation (consistent with Vercel AI SDK tools)
- **Shared/Types** - `StandardResponse<T>`, error classes for all function returns
- **Future UI:** Next.js 15+, Tailwind CSS, shadcn/ui
- **No tests initially** - will add after implementation complete

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              THINKER                                     │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  LLM Abstraction Layer                                            │   │
│  │  ├─ interface LLMProvider { chat(), functionCall() }              │   │
│  │  ├─ GroqProvider (default, cloud)                                 │   │
│  │  ├─ LMStudioProvider (local, OpenAI-compatible)                   │   │
│  │  └─ OllamaProvider (local, flexible)                              │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Message Source Abstraction                                       │   │
│  │  ├─ interface MessageSource { poll(), ack() }                     │   │
│  │  ├─ TelegramSource (polls via Orchestrator)                       │   │
│  │  └─ [Future: Discord, Slack, HTTP API]                            │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Tool Executor                                                    │   │
│  │  ├─ Discovers tools from Orchestrator on startup                  │   │
│  │  ├─ Executes via HTTP POST to Orchestrator                        │   │
│  │  └─ Handles tool results, errors, retries                         │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Context Manager                                                  │   │
│  │  ├─ Loads persona from Memory MCP profile                         │   │
│  │  ├─ Retrieves relevant facts for context                          │   │
│  │  ├─ Tracks conversation per chat_id                               │   │
│  │  └─ Builds system prompt dynamically                              │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Agent Loop (ReAct-style)                                         │   │
│  │  ├─ Observe: Poll messages, get context                           │   │
│  │  ├─ Think: LLM reasoning with tools                               │   │
│  │  ├─ Act: Execute tool calls                                       │   │
│  │  ├─ Loop: Feed results back to LLM until done                     │   │
│  │  └─ Respond: Send via Telegram, store in Memory                   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Trace Logger                                                     │   │
│  │  ├─ Creates trace_id for each request                             │   │
│  │  ├─ Logs all events to ~/.annabelle/logs/traces.jsonl             │   │
│  │  └─ Propagates trace_id to all MCP calls                          │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                           ORCHESTRATOR (:8000)                           │
│  ├─ /tools - List all available tools                                   │
│  ├─ /execute - Execute a tool call                                      │
│  └─ Security scanning via Guardian                                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            ↓                       ↓                       ↓
    ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
    │  Telegram   │         │  Memorizer  │         │   Filer     │
    │   (:8002)   │         │   (:8005)   │         │  (:8004)    │
    └─────────────┘         └─────────────┘         └─────────────┘
```

---

## Dependencies

```json
{
  "dependencies": {
    "ai": "^4.0.0",
    "@ai-sdk/openai": "^1.0.0",
    "zod": "^3.23.0",
    "express": "^4.21.0",
    "nanoid": "^5.0.0",
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0",
    "@types/express": "^4.17.0"
  }
}
```

**Note:** Link to `../Shared` for shared types via `npm link` or tsconfig paths.

---

## Configuration

### Environment Variables

```bash
# Master switch (mode flag - when true, Thinker handles Telegram; when false, Claude Desktop does)
THINKER_ENABLED=true

# LLM Provider (groq | lmstudio | ollama)
THINKER_LLM_PROVIDER=groq

# Groq (cloud, fast, cheap - DEFAULT)
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile

# LM Studio (local, free, private)
LMSTUDIO_BASE_URL=http://localhost:1234/v1
LMSTUDIO_MODEL=                          # Auto-detected if empty

# Ollama (local, flexible)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2

# Orchestrator connection (MCP SDK over HTTP)
ORCHESTRATOR_URL=http://localhost:8000

# Thinker HTTP server (for health checks)
THINKER_PORT=8006

# Polling (own setInterval, not Inngest)
TELEGRAM_POLL_INTERVAL_MS=30000          # 30 seconds (reduced from 10s for cost control)

# Agent
THINKER_AGENT_ID=thinker                 # Agent ID for Memory MCP profile

# Logging
LOG_LEVEL=info
TRACE_LOG_PATH=~/.annabelle/logs/traces.jsonl
```

---

## Core Components

### 1. LLM Providers (Vercel AI SDK)

**Using Vercel AI SDK** (`ai` package) for unified provider interface with built-in ReAct support.

**Key packages:**
- `ai` - Core SDK with `generateText`, `tool()`, ReAct via `maxSteps`
- `@ai-sdk/openai` - OpenAI-compatible provider (works with Groq, LM Studio)
- `@ai-sdk/anthropic` - Optional, for Claude fallback

**Provider setup:**

```typescript
import { createOpenAI } from '@ai-sdk/openai';

// Groq (default) - OpenAI-compatible
const groq = createOpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY,
});

// LM Studio - OpenAI-compatible on localhost
const lmstudio = createOpenAI({
  baseURL: process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1',
  apiKey: 'lm-studio', // LM Studio ignores API key
});

// Ollama - OpenAI-compatible mode
const ollama = createOpenAI({
  baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
  apiKey: 'ollama', // Ollama ignores API key
});
```

**Provider factory:**

```typescript
function getModel() {
  switch (process.env.THINKER_LLM_PROVIDER) {
    case 'groq': return groq(process.env.GROQ_MODEL || 'llama-3.3-70b-versatile');
    case 'lmstudio': return lmstudio(process.env.LMSTUDIO_MODEL || 'local-model');
    case 'ollama': return ollama(process.env.OLLAMA_MODEL || 'llama3.2');
    default: return groq('llama-3.3-70b-versatile');
  }
}
```

| Provider | Setup | Tool support |
|----------|-------|--------------|
| Groq | `@ai-sdk/openai` with Groq baseURL | Yes (function calling) |
| LM Studio | `@ai-sdk/openai` with localhost:1234 | Depends on model |
| Ollama | `@ai-sdk/openai` with localhost:11434/v1 | Yes (with supported models) |

### 2. Message Source

**Interface:**

```typescript
interface MessageSource {
  poll(): Promise<IncomingMessage[]>;
  ack(messageIds: string[]): Promise<void>;
  send(chatId: string, text: string, replyTo?: string): Promise<void>;
}
```

**TelegramSource:**
- Polls Orchestrator's `get_new_telegram_messages` tool
- Sends via `send_telegram` tool
- Filters by configured chat subscriptions

### 3. Tool Executor

**On startup:**
1. GET `{ORCHESTRATOR_URL}/tools` → list of all tools
2. Convert to LLM function definitions
3. Cache for runtime use

**On tool call:**
1. POST `{ORCHESTRATOR_URL}/execute` with tool name and params
2. Include `X-Trace-Id` header
3. Return result to LLM or handle error

### 4. Context Manager

**Loads from Memory MCP:**
- Profile for `agent_id: "thinker"` (contains persona)
- Relevant facts based on user message
- Recent conversation history for this chat

**Builds system prompt:**

```
{persona.system_prompt}

User Profile:
{formatted_user_profile}

Relevant Memories:
{formatted_facts}

Recent Conversation:
{last_5_messages_in_this_chat}

Available Tools:
{tool_descriptions}
```

### 5. Agent Loop (Vercel AI SDK with maxSteps)

**No manual loop needed!** Vercel AI SDK handles ReAct automatically:

```typescript
import { generateText, tool } from 'ai';
import { z } from 'zod';
import { createSuccess, createError, StandardResponse } from '@shared/Types/StandardResponse';

async function processMessage(
  userMessage: string,
  chatId: string,
  context: Context
): Promise<StandardResponse<{ response: string; toolsUsed: string[] }>> {
  try {
    const result = await generateText({
      model: getModel(),
      system: context.systemPrompt,
      messages: [
        ...context.conversationHistory,
        { role: 'user', content: userMessage }
      ],
      tools: {
        send_telegram: tool({
          description: 'Send a message to Telegram',
          parameters: z.object({
            chat_id: z.string(),
            message: z.string(),
          }),
          execute: async ({ chat_id, message }) => {
            return orchestrator.callTool('send_telegram', { chat_id, message });
          },
        }),
        store_fact: tool({
          description: 'Store a fact in memory',
          parameters: z.object({
            fact: z.string(),
            category: z.enum(['preference', 'background', 'pattern', 'project', 'decision']),
          }),
          execute: async ({ fact, category }) => {
            return orchestrator.callTool('store_fact', { agent_id: 'thinker', fact, category });
          },
        }),
        // ... dynamically loaded tools from Orchestrator
      },
      maxSteps: 3,  // ReAct loop limit (reduced from 10 for cost control)
    });

    // Send final response to Telegram
    await orchestrator.callTool('send_telegram', {
      chat_id: chatId,
      message: result.text,
    });

    // Store conversation in Memory
    await orchestrator.callTool('store_conversation', {
      agent_id: 'thinker',
      user_message: userMessage,
      agent_response: result.text,
    });

    const toolsUsed = result.steps
      .flatMap(step => step.toolCalls?.map(tc => tc.toolName) || []);

    return createSuccess({ response: result.text, toolsUsed });
  } catch (error) {
    return createError(error instanceof Error ? error.message : 'Unknown error');
  }
}
```

**How `maxSteps` works:**
1. LLM generates response (may include tool calls)
2. SDK executes tools automatically via `execute` functions
3. Results fed back to LLM as tool results
4. Loop continues until LLM returns text without tools OR maxSteps reached
5. Final `result.text` contains the response to send

### 6. Trace Logger (Shared Library)

**Lives in:** `Shared/Tracing/` - reusable across ALL MCPs

**Every request:**
1. Generate `trace_id: tr_{nanoid()}`
2. Log all events with trace_id
3. Pass trace_id in HTTP headers (`X-Trace-Id`) to all MCP calls

**Shared library interface:**

```typescript
// Shared/Tracing/context.ts
export interface TraceContext {
  traceId: string;
  startedAt: number;
}

export function createTrace(): TraceContext;
export function logTrace(ctx: TraceContext, mcp: string, event: string, data: object): void;
export function getTraceFromHeaders(headers: Record<string, string>): TraceContext | null;
```

**Log format (JSONL):**

```json
{"trace_id":"tr_abc123","ts":"2026-02-02T10:30:00.123Z","mcp":"thinker","event":"message_received","data":{"chat_id":"123","text":"Hello"}}
{"trace_id":"tr_abc123","ts":"2026-02-02T10:30:00.234Z","mcp":"thinker","event":"context_loaded","data":{"facts":5,"profile":true}}
{"trace_id":"tr_abc123","ts":"2026-02-02T10:30:01.456Z","mcp":"thinker","event":"llm_call","data":{"provider":"groq","model":"llama-3.3-70b","input_tokens":1200}}
{"trace_id":"tr_abc123","ts":"2026-02-02T10:30:02.789Z","mcp":"orchestrator","event":"tool_executed","data":{"tool":"send_telegram"}}
{"trace_id":"tr_abc123","ts":"2026-02-02T10:30:03.012Z","mcp":"thinker","event":"complete","data":{"duration_ms":2889}}
```

**All MCPs will be updated to:**
1. Accept `X-Trace-Id` header
2. Use Shared/Tracing for logging
3. Propagate trace_id to downstream calls

---

## Persona Configuration

Stored in Memory MCP as profile for `agent_id: "thinker"`:

```json
{
  "agent_id": "thinker",
  "profile_data": {
    "persona": {
      "name": "Annabelle",
      "style": "technical assistant",
      "tone": "direct, concise, no fluff",
      "system_prompt": "You are Annabelle, a technical AI assistant. You help the user accomplish tasks efficiently. Be direct and technical. Focus on getting things done. Don't be verbose or add unnecessary pleasantries. When you need to use tools, do so without asking for permission unless the action is destructive or irreversible."
    },
    "capabilities": {
      "can_send_telegram": true,
      "can_manage_files": true,
      "can_store_memories": true,
      "can_schedule_tasks": true
    },
    "proactive_behaviors": {
      "morning_summary": false,
      "task_reminders": false,
      "acknowledge_messages": true
    }
  }
}
```

**User can edit via:**
- `~/.annabelle/memory-export/profiles/thinker.md`
- Or directly via Memory MCP tools

---

## Proactive Behaviors (Inngest Integration)

### Current MVP: Reactive Only
- Thinker polls Telegram queue
- Processes messages as they arrive
- No unprompted actions

### Future: Proactive via Inngest

**Morning Summary Job:**

```typescript
inngest.createFunction(
  { id: "thinker-morning-summary" },
  { cron: "0 8 * * *" },  // 8am daily
  async () => {
    const tasks = await memoryMCP.search({ query: "task", category: "project" });
    const prompt = `Generate a morning summary for the user. Open tasks: ${tasks}`;
    const summary = await thinker.generate(prompt);
    await telegramMCP.send(userChatId, summary);
  }
);
```

**Task Reminder Job:**

```typescript
inngest.createFunction(
  { id: "thinker-task-reminders" },
  { cron: "0 18 * * *" },  // 6pm daily
  async () => {
    const deadlines = await memoryMCP.search({ query: "deadline" });
    // Filter for tomorrow's deadlines
    // Send reminder via Telegram
  }
);
```

---

## File Structure

### Thinker MCP

```
Thinker/
├── src/
│   ├── index.ts                 # Entry point, main loop, HTTP server
│   ├── config.ts                # Environment config loader (Zod)
│   │
│   ├── llm/
│   │   ├── types.ts             # LLMProvider interface
│   │   ├── groq.ts              # Groq implementation
│   │   ├── lmstudio.ts          # LM Studio implementation (OpenAI-compatible)
│   │   ├── ollama.ts            # Ollama implementation
│   │   └─ factory.ts           # Provider factory based on env
│   │
│   ├── sources/
│   │   ├── types.ts             # MessageSource interface
│   │   └── telegram.ts          # Telegram via Orchestrator MCP tools
│   │
│   ├── orchestrator/
│   │   ├── client.ts            # MCP SDK client to Orchestrator
│   │   ├── tools.ts             # Tool discovery and execution
│   │   └── types.ts             # Tool definitions
│   │
│   ├── context/
│   │   ├── manager.ts           # Context assembly
│   │   ├── persona.ts           # Persona loading from Memory profile
│   │   └── memory.ts            # Memory MCP interactions
│   │
│   └── agent/
│       ├── loop.ts              # ReAct agent loop
│       └── types.ts             # Agent state types
│
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

### Shared Library Addition

```
Shared/
├── ... (existing)
├── Tracing/
│   ├── index.ts                 # Exports
│   ├── context.ts               # TraceContext, createTrace(), getTraceFromHeaders()
│   ├── logger.ts                # logTrace() - JSONL writer
│   └── types.ts                 # Trace types
└── package.json                 # Update exports
```

---

## Message Flow

### Telegram → Thinker → Response

```
1. Telegram user sends message
   └─→ GramJS captures instantly
   └─→ Stored in Telegram MCP queue

2. Thinker polls (every 30s)
   └─→ GET new_telegram_messages via Orchestrator
   └─→ Receives: [{id, chatId, senderId, text, date}]

3. For each message:
   └─→ Create trace_id
   └─→ Load persona from Memory MCP
   └─→ Retrieve relevant facts
   └─→ Build conversation context

4. LLM call (Groq default)
   └─→ System prompt + context + user message
   └─→ Available tools as functions
   └─→ Response: content and/or tool_calls

5. If tool_calls:
   └─→ Execute each via Orchestrator
   └─→ Collect results
   └─→ Feed back to LLM
   └─→ Repeat until final response

6. Send response:
   └─→ Via send_telegram tool
   └─→ Store conversation in Memory MCP
   └─→ Log trace complete
```

---

## Implementation Phases

### Phase 1: Project Setup

- [ ] Initialize TypeScript project (package.json, tsconfig.json)
- [ ] Install dependencies: `ai`, `@ai-sdk/openai`, `zod`, `express`
- [ ] Config loader with Zod validation (env vars)
- [ ] Basic HTTP server on port 8006 (health check endpoint)
- [ ] Link to Shared library for types

### Phase 2: Vercel AI SDK Integration

- [ ] Provider factory (Groq, LM Studio, Ollama via `@ai-sdk/openai`)
- [ ] Basic `generateText` call with single provider
- [ ] Tool definition pattern using `tool()` from `ai`
- [ ] Test with simple hardcoded tool

### Phase 3: Shared Library - Tracing

- [ ] Add `Shared/Tracing/` module
- [ ] TraceContext interface and helpers
- [ ] JSONL logger to `~/.annabelle/logs/traces.jsonl`
- [ ] Header propagation utilities (`X-Trace-Id`)

### Phase 4: Orchestrator Client

- [ ] HTTP client to Orchestrator for tool discovery
- [ ] Dynamic tool loading from Orchestrator's tool list
- [ ] Convert Orchestrator tools to Vercel AI SDK `tool()` format
- [ ] Tool executor that calls Orchestrator

### Phase 5: Message Processing Loop

- [ ] Telegram polling via Orchestrator's `get_new_telegram_messages`
- [ ] setInterval-based polling (30 seconds)
- [ ] `generateText` with `maxSteps: 3` for ReAct (limited for cost control)
- [ ] Response sending via `send_telegram`
- [ ] Conversation storage in Memory MCP

### Phase 6: Context & Memory

- [ ] Load persona from Memory MCP profile (`agent_id: "thinker"`)
- [ ] Retrieve relevant facts for context
- [ ] Build dynamic system prompt
- [ ] Per-chat conversation history tracking

### Phase 7: Additional Providers

- [ ] Test LM Studio provider switching
- [ ] Test Ollama provider switching
- [ ] Fallback handling when provider unavailable

### Phase 8: Proactive Features (Future)

- [ ] Time-based triggers (Inngest cron)
- [ ] Event-based triggers (webhooks)
- [ ] Context-based triggers (Memory)
- [ ] Multi-turn conversation tracking

**Note:** Tests will be added after implementation is complete.

---

## Verification Plan

### TypeScript Check (Required after every phase)

```bash
cd Thinker && npx tsc --noEmit
cd Shared && npx tsc --noEmit
```

### Manual Testing Checklist

1. **Start existing MCPs:**

   ```bash
   ./launch-all.sh
   ```

2. **Start Thinker:**

   ```bash
   cd Thinker && THINKER_ENABLED=true npm start
   ```

3. **Verify health:**

   ```bash
   curl http://localhost:8006/health
   ```

4. **Send Telegram message** to the bot/account

5. **Verify response** appears in Telegram within ~15 seconds

6. **Check trace log:**

   ```bash
   tail -f ~/.annabelle/logs/traces.jsonl
   ```

7. **Check Memory MCP** for stored conversation:

   ```bash
   curl http://localhost:8005/search_conversations -d '{"agent_id":"thinker","limit":1}'
   ```

### LLM Provider Testing

1. **Groq (default):** Set `THINKER_LLM_PROVIDER=groq`, verify response
2. **LM Studio:** Start LM Studio, set `THINKER_LLM_PROVIDER=lmstudio`, verify response
3. **Ollama:** Start Ollama, set `THINKER_LLM_PROVIDER=ollama`, verify response

**Note:** Automated tests will be added after implementation is complete.

---

## Resolved Decisions

| Question | Decision |
|----------|----------|
| Chat routing | Mode flag - Thinker handles ALL chats when enabled, Claude Desktop when disabled |
| Polling method | Own setInterval (standalone, not Inngest) |
| Orchestrator API | MCP SDK over HTTP (reuse existing protocol, no new endpoints) |
| Port | 8006 |
| Language | TypeScript |
| Persona | Technical assistant (direct, concise) |

---

## Safety & Cost Controls

The agent includes multiple layers of protection against runaway API costs:

### 1. Chat Auto-Discovery (Never Monitor Bot's Own Chat)

The bot auto-discovers private chats via `list_chats` and **always excludes its own Saved Messages** (`botUserId`). This prevents the fundamental feedback loop where the bot processes its own responses.

- If explicit subscriptions exist, those are used (with bot's own ID filtered out)
- Otherwise, `listChats()` discovers all private chats, excluding the bot itself
- Chat list refreshes every 5 minutes to pick up new conversations

### 2. Timestamp Filter (Only Recent Messages)

Messages older than 2 minutes are ignored. This prevents the bot from processing old chat history on restart, which was a major source of runaway costs.

### 3. Per-Cycle Message Cap

Max 3 messages processed per poll cycle. Even if many messages queue up, the bot won't process more than 3 at a time, bounding API usage per interval.

### 4. Circuit Breaker (Hardened)

Automatically stops processing after accumulated errors. The error counter **decrements** on success instead of fully resetting, so intermittent successes don't mask a pattern of failures.

```typescript
// On error:
this.consecutiveErrors++;
if (this.consecutiveErrors >= 5) {
  this.circuitBreakerTripped = true;
}

// On success (decrement, don't reset):
if (this.consecutiveErrors > 0) this.consecutiveErrors--;
```

**Behavior:** After 5 net errors (not easily reset by a single success), the agent stops until restarted.

### 5. Rate Limiting

Enforces 1-second minimum interval between API calls.

### 6. Bot Message Pattern Filtering

Skips messages matching known bot-generated patterns (error messages, apology phrases). This is a last-resort filter; the primary protection is chat auto-discovery (layer 1).

**Critical:** Error messages are NOT sent to chat to prevent the bot from processing its own error messages.

### 7. Reduced API Call Multipliers

| Setting | Before | After | Impact |
|---------|--------|-------|--------|
| `maxSteps` | 10 | 2 | 5x fewer API calls per message |
| Retries | 3 attempts | 0 | 3x fewer API calls on errors |
| Poll interval | 10s | 30s | 3x fewer polls per minute |
| Messages per cycle | unlimited | 3 | Bounded cost per interval |

### 8. Worst-Case Cost Calculation

With all safeguards:

- Max 3 messages per cycle, max 2 steps each = 6 API calls per cycle
- 30s poll interval = 2 cycles/min = 12 API calls/min max
- Circuit breaker trips after 5 net errors
- Estimated max runaway cost before breaker trips: **~$0.05**

### Incident History

**2026-02-03:** Infinite feedback loop caused $100 in Groq API charges.

- **Root cause:** Bot processed its own error messages in Saved Messages
- **Token usage:** 66.7 million input tokens
- **Fix:** Added bot message pattern filtering, removed error sending to chat

**2026-02-05:** Second feedback loop incident, 153+ Groq API calls.

- **Root cause:** Bot monitored its own Saved Messages (fallback when no subscriptions), processed old error messages and its own responses in a loop. Circuit breaker was bypassed because it fully reset on any success.
- **Fix:** (1) Auto-discover chats via `list_chats`, always exclude bot's own ID. (2) Timestamp filter: only process messages from last 2 minutes. (3) Per-cycle cap: max 3 messages. (4) Hardened circuit breaker: decrement on success instead of full reset. (5) Reduced `maxSteps` from 3 to 2.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| LM Studio doesn't support function calling | Fallback to text-based tool selection |
| Groq rate limits | Queue messages, exponential backoff |
| Orchestrator unavailable | Retry with backoff, notify user |
| Runaway agent loop | Max iterations limit (3), circuit breaker, rate limiting |
| Infinite feedback loop | Bot message filtering, no error messages sent to chat |
| Conflicting with Claude Desktop | Clear separation via chat partitioning |

---

## Next Steps

1. ~~Approve this plan~~
2. Set up project structure
3. Implement Phase 1 (core foundation)
4. Test with simple Telegram echo
5. Add tool integration (Phase 2)
6. Iterate based on testing
