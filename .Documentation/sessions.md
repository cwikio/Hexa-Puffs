# Session Lifecycle

> How conversations are stored, how context is built for the LLM, when compaction triggers, and how facts are extracted from conversations.

## Session Storage

**Location:** `~/.annabelle/sessions/{agentId}/{chatId}.jsonl`

Each session is a JSONL file (one JSON object per line) with three entry types:

### Header (first line)
```json
{
  "type": "header",
  "chatId": "8304042211",
  "agentId": "annabelle",
  "createdAt": "2026-02-11T01:14:59.755Z",
  "version": 1
}
```

### Turn (one per conversation exchange)
```json
{
  "type": "turn",
  "user": "What emails do I have?",
  "assistant": "You have 20 unread emails...",
  "timestamp": "2026-02-11T01:14:59.755Z",
  "toolsUsed": ["gmail_list_emails"],
  "tokens": { "prompt": 12955, "completion": 100 },
  "messages": [/* optional: full CoreMessage[] for structured tool calls */]
}
```

The `messages` field stores the full structured message chain when tools were used, preserving tool-call/result pairs for accurate history replay.

### Compaction (replaces old turns with summary)
```json
{
  "type": "compaction",
  "summary": "The user asked about their schedule and emails...",
  "compactedTurns": 25,
  "timestamp": "2026-02-11T02:30:00.000Z"
}
```

## Context Building

**File:** `Thinker/src/agent/loop.ts`, `buildContext()`

Every time Thinker processes a message, it builds a context for the LLM. This is the full composition:

### System Prompt Layers (in order)

1. **Tool preamble** — `TOOL_PREAMBLE` constant enforcing structured tool calling (prepended before everything)
2. **Base persona** — Loaded from `~/.annabelle/agents/{agentId}/instructions.md` (tool calling rules consolidated at top)
3. **Profile section** — User profile from Memorizer (`get_profile`)
4. **Date/time** — Current date/time in user's timezone
5. **Chat context** — `chat_id: {chatId}` so tool calls can target the right chat
6. **Compaction summary** — If session was previously compacted, the summary is included
7. **Matched playbooks** — If message matches a playbook pattern, its instructions are appended (placed near end for recency attention)
8. **Skill descriptions** — Available skills added as XML for progressive disclosure
9. **Relevant facts** — Top 5 facts from `retrieve_memories` formatted as bullet list (very end — strong recency attention)

### Conversation History

After the system prompt, conversation history is selected using **semantic relevance filtering**:

1. Load from session JSONL (or in-memory cache if already loaded)
2. **Candidate pool:** Last **30 messages** from session
3. **Semantic history selection** via `selectRelevantHistory()`:
   - **Always include** last 3 exchanges (6 messages) for recency
   - **Score older messages** by embedding cosine similarity to the current user message
   - **Include older exchanges** above threshold (default: 0.45, env: `HISTORY_RELEVANCE_THRESHOLD`)
   - **Cap total** at 20 messages
   - **Maintain chronological order** in final array
   - If embedding provider unavailable, falls back to `slice(-20)`
4. **Repair** via `repairConversationHistory()` — fixes broken message chains
5. **Truncate** old tool results via `truncateHistoryToolResults()` — preserves last 2, summarizes older ones

This ensures that when conversations are disjointed (many different topics in one chat), only contextually relevant older exchanges are sent to the LLM alongside recent messages. Irrelevant mid-conversation noise (different topics) is dropped.

## History Repair

**File:** `Thinker/src/agent/history-repair.ts`

LLM conversations can break when tool calls/results get out of sync. The repair function fixes three types of damage:

### Rule 1: Leading Orphan Tool Results
- Tool result messages at the start of history (no preceding tool call)
- **Action:** Remove them

### Rule 2: Missing Tool Results
- Assistant made tool calls but the next message is not a tool result
- **Action:** Insert synthetic result: `{ error: "Tool result unavailable (recovered from broken history)" }`

### Rule 3: Orphaned Tool Results
- Tool result references a tool call ID that doesn't exist in the preceding assistant message
- **Action:** Remove the orphaned result

## History Truncation

**File:** `Thinker/src/agent/history-repair.ts`, `truncateHistoryToolResults()`

Older tool results can be very large (full email bodies, search results, etc.). To save tokens:

- Keep the last **2** tool result messages intact
- Replace older tool results with summary: `[toolName: truncated, was N chars]`
- Non-destructive — creates a new array, original is preserved

## Session Compaction

**File:** `Thinker/src/session/store.ts`

When a conversation gets too long, old messages are summarized to free up context window space.

### Trigger Conditions

All must be true:
- `compactionEnabled` is true (default: true)
- Turn count >= `compactionMinTurns` (default: 8)
- Time since last compaction >= `compactionCooldownMs` (default: 2 minutes)
- Total characters > `compactionThresholdChars` (default: 20,000 ≈ 5,000 tokens)

### Process

1. **Split messages:** Keep last `compactionKeepRecentTurns × 2` messages (default: 5 turns = 10 messages)
2. **Summarize old messages:** Call LLM (compaction model — Groq Llama 8B by default) with:
   - System prompt: "Summarize this conversation preserving key facts, decisions, pending tasks, and important context. Write in third person."
   - Content: Formatted old messages
   - Timeout: 30 seconds
3. **Rewrite JSONL atomically:** Write to temp file, then rename to original
   - New header
   - New compaction entry with summary
   - Recent turns re-serialized
4. **Update tracking:** Reset character counts and turn counts to recent messages only

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `compactionEnabled` | true | Master switch |
| `compactionThresholdChars` | 20,000 | Total character trigger (~5,000 tokens) |
| `compactionKeepRecentTurns` | 5 | Turns preserved after compaction |
| `compactionCooldownMs` | 120,000 | Minimum 2 min between compactions |
| `compactionMinTurns` | 8 | Minimum turns before first compaction |
| `compactionProvider` | groq | LLM provider for summarization |
| `compactionModel` | llama-3.1-8b-instant | Cheap model for summarization |

## Fact Extraction

**File:** `Thinker/src/agent/loop.ts`, `Thinker/src/agent/fact-extractor.ts`

After a conversation goes idle, Thinker automatically extracts facts and stores them in Memorizer.

### Scheduling

- Timer set on **every message** — resets on each new message
- Fires after `idleMs` (default: 5 minutes) of no activity
- Only one timer per chatId at a time

### Extraction Process

1. **Guard conditions:**
   - Need >= 4 messages (2 exchanges minimum)
   - Skip if already extracted for current activity window

2. **Gather context:**
   - Take last `maxTurns × 2` messages (default: 20 messages)
   - Fetch existing facts from Memorizer (for deduplication)

3. **LLM extraction:**
   - Uses cheap compaction model (Groq Llama 8B)
   - Prompt: "Extract CLEAR, EXPLICIT facts NOT in known list"
   - Max 5 facts per extraction
   - Confidence scoring: 0.9+ for explicit, 0.7-0.9 for strongly implied
   - 30-second timeout

4. **Store facts:**
   - Each extracted fact stored via `orchestrator.storeFact()`
   - Category assigned by LLM (preference, background, pattern, project, contact, decision)
   - Filtered by confidence threshold (default: 0.7)

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `factExtraction.enabled` | true | Master switch |
| `factExtraction.idleMs` | 300,000 | 5 min idle before extraction |
| `factExtraction.maxTurns` | 10 | Max recent turns to analyze |
| `factExtraction.confidenceThreshold` | 0.7 | Minimum confidence to store |

## Subagent Sessions

Subagents get their own temporary session directories: `~/.annabelle/sessions/annabelle-sub-{timestamp}/`

- Independent conversation history
- No shared state with parent (except via Memorizer facts)
- Auto-cleaned when subagent is killed (auto-kill timer from AgentManager)

## Clear Session API

**Endpoint:** `POST /clear-session` on Thinker (port 8006)

Wipes all conversation history for a chat, useful when a session becomes poisoned (e.g., failed tool calls teaching the model to avoid tools).

```bash
curl -X POST http://localhost:8006/clear-session \
  -H 'Content-Type: application/json' \
  -d '{"chatId":"8304042211"}'
```

**What it clears:**

- In-memory conversation state (`conversationStates` map)
- Pending fact extraction timer
- Session JSONL file on disk (auto-recreated on next message)
- SessionStore tracking maps (char counts, turn counts, compaction times)

**Files:** `Thinker/src/index.ts` (endpoint), `Thinker/src/agent/loop.ts` (`Agent.clearSession()`), `Thinker/src/session/store.ts` (`SessionStore.clearSession()`)

## Session Cleanup

Old session files are cleaned up based on `maxAgeDays` (default: 7 days). The cleanup runs periodically and deletes session files + clears in-memory state for expired sessions.

## Key Files

| File | Purpose |
|------|---------|
| `Thinker/src/session/store.ts` | JSONL read/write, compaction, shouldCompact() |
| `Thinker/src/session/types.ts` | SessionHeader, SessionTurn, SessionCompaction types |
| `Thinker/src/agent/loop.ts` | buildContext(), selectRelevantHistory(), scheduleFactExtraction(), runFactExtraction() |
| `Thinker/src/agent/embedding-tool-selector.ts` | EmbeddingToolSelector — reused for semantic history selection via getProvider() |
| `Thinker/src/agent/history-repair.ts` | repairConversationHistory(), truncateHistoryToolResults() |
| `Thinker/src/agent/fact-extractor.ts` | extractFactsFromConversation() |
| `Thinker/src/agent/types.ts` | AgentState (messages, lastActivity, compactionSummary) |
| `Thinker/src/config.ts` | SessionConfig, FactExtractionConfig defaults |
