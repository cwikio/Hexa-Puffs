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

1. **Base persona** — Loaded from `~/.annabelle/agents/{agentId}/instructions.md`
2. **Profile section** — User profile from Memorizer (`get_profile`)
3. **Matched playbooks** — If message matches a playbook pattern, its instructions are appended
4. **Skill descriptions** — Available skills added as XML for progressive disclosure
5. **Date/time** — Current date/time in user's timezone
6. **Chat context** — `chat_id: {chatId}` so tool calls can target the right chat
7. **Compaction summary** — If session was previously compacted, the summary is included
8. **Relevant facts** — Top 5 facts from `retrieve_memories` formatted as bullet list

### Conversation History

After the system prompt, the last **50 messages** from the session are included:

1. Load from session JSONL (or in-memory cache if already loaded)
2. **Repair** via `repairConversationHistory()` — fixes broken message chains
3. **Truncate** old tool results via `truncateHistoryToolResults()` — preserves last 2, summarizes older ones

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
- Turn count >= `compactionMinTurns` (default: 15)
- Time since last compaction >= `compactionCooldownMs` (default: 5 minutes)
- Total characters > `compactionThresholdChars` (default: 50,000 ≈ 12,500 tokens)

### Process

1. **Split messages:** Keep last `compactionKeepRecentTurns × 2` messages (default: 10 turns = 20 messages)
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
| `compactionThresholdChars` | 50,000 | Total character trigger (~12,500 tokens) |
| `compactionKeepRecentTurns` | 10 | Turns preserved after compaction |
| `compactionCooldownMs` | 300,000 | Minimum 5 min between compactions |
| `compactionMinTurns` | 15 | Minimum turns before first compaction |
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

## Session Cleanup

Old session files are cleaned up based on `maxAgeDays` (default: 7 days). The cleanup runs periodically and deletes session files + clears in-memory state for expired sessions.

## Key Files

| File | Purpose |
|------|---------|
| `Thinker/src/session/store.ts` | JSONL read/write, compaction, shouldCompact() |
| `Thinker/src/session/types.ts` | SessionHeader, SessionTurn, SessionCompaction types |
| `Thinker/src/agent/loop.ts` | buildContext(), scheduleFactExtraction(), runFactExtraction() |
| `Thinker/src/agent/history-repair.ts` | repairConversationHistory(), truncateHistoryToolResults() |
| `Thinker/src/agent/fact-extractor.ts` | extractFactsFromConversation() |
| `Thinker/src/agent/types.ts` | AgentState (messages, lastActivity, compactionSummary) |
| `Thinker/src/config.ts` | SessionConfig, FactExtractionConfig defaults |
