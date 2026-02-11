# Tool Calling Improvements (OpenClaw Research)

Based on research into the [OpenClaw](https://github.com/openclaw/openclaw) codebase — a production multi-agent system with robust tool calling.

## Problem

Groq/Llama models hallucinate actions (claim they did something without calling a tool) and ignore tools entirely (respond with text when they should call a tool).

---

## ~~Suggestion 1: Conversation History Validation (HIGH IMPACT)~~ ✅

**The problem**: When a tool call fails mid-execution (timeout, crash, API error), the conversation history ends up with an orphaned tool call (assistant message with `tool_calls`) but no matching tool result. When the LLM sees this broken sequence in its next turn, it learns "tools are broken" and switches to text-only mode.

**What OpenClaw does** (`session-transcript-repair.ts`):

- Before every LLM call, scans the full message history
- Validates every tool call has a matching tool result directly after it
- Inserts synthetic error results for orphaned calls: `"Tool result unavailable (recovered)"`
- Removes duplicate results, repositions misplaced ones

**Where to add in Annabelle**: `loop.ts:554-564` — right before the `generateText()` call. Add a function that walks `context.conversationHistory` and:

1. Finds any assistant messages with `tool_calls` array
2. Checks that the next message is a `tool` role with matching `tool_call_id`
3. If missing: insert a synthetic `{ role: 'tool', content: 'Error: tool result unavailable', tool_call_id: ... }`
4. If a tool result has no matching call: remove it

Also at `loop.ts:919-926` — when pushing `result.response.messages` to state, validate the structure is well-formed before persisting.

**Why high impact**: This is likely the single biggest reason tools stop working in longer conversations. One bad tool call/result pair poisons subsequent turns.

---

## Suggestion 2: Tool Result Truncation (HIGH IMPACT)

**The problem**: A single tool result (e.g., `searcher_web_search` returning 10 results with full snippets, or `gmail_list_emails` returning 20 emails) can be 10K-50K tokens. This pushes the system prompt and tool definitions out of the model's effective attention window. Groq/Llama models are especially sensitive to this — their context handling is weaker than Claude/GPT-4.

**What OpenClaw does** (`tool-result-truncation.ts`):

- Single result: max 30% of context window
- Hard ceiling: 400K chars
- Minimum preserved: 2K chars (always keep the start)
- Breaks at newline boundaries
- Appends `[truncated — showing first X of Y chars]`

**Where to add in Annabelle**: Two places:

1. `tools.ts:76-95` — in the `execute` wrapper, truncate the result before returning it to the AI SDK
2. `loop.ts:919-926` — when persisting response messages, truncate any tool result content in the message array before pushing to `state.messages`

**Suggested constants**: `MAX_TOOL_RESULT_CHARS = 8000`, `MAX_HISTORY_TOOL_CHARS = 32000` (total across all historical results).

---

## Suggestion 3: Smarter Tool Count Reduction for Groq/Llama (HIGH IMPACT)

**The problem**: The tool selector currently selects 15-30 tools per message. Groq/Llama models have a known weakness — the more tools you give them, the more likely they are to either (a) ignore them all or (b) pick the wrong one.

**What OpenClaw does**:

- Dynamic tool pruning when approaching context limits
- `makeToolPrunablePredicate()` decides which tools can be removed
- Tool definitions for removed tools are stripped entirely from the request

**Current state**: `tool-selection.ts` has `topK: 15` and `minTools: 5`. The keyword selector can add more on top.

**Suggestions**:

1. **Reduce `topK` to 8-10 for Groq** — check `config.llmProvider` and use a tighter budget
2. **Limit total tool count** — after embedding + keyword merge, hard-cap at 12 tools for Groq. When over limit, keep core tools + highest-scoring embedding matches, drop lowest-scoring keyword additions
3. **Simplify tool descriptions** — Groq/Llama models get confused by long descriptions. Consider a `shortDescription` field (1 sentence) used only for Groq

---

## ~~Suggestion 4: Hallucination Guard Improvements (MEDIUM IMPACT)~~ ✅

**Current state**: `loop.ts:790-834` has a regex that catches "I've created/sent/scheduled..." without tool calls and retries with `toolChoice: 'required'`.

**What's missing**:

1. **Broader patterns** — The current regex misses common Llama hallucination phrases:
   - "Here's the email I sent" / "I've gone ahead and..."
   - "I searched for..." / "I looked up..." / "I checked your calendar..."
   - "The results show..." (without actually searching)
   - Polish equivalents: "Wysłałem...", "Znalazłem...", "Sprawdziłem..."

2. **Pre-emptive enforcement** — Instead of only detecting hallucinations after the fact, for messages that clearly need tools (detected by keyword/embedding), start with `toolChoice: 'required'` on the first attempt, not just as a retry. OpenClaw uses policy-based tool enforcement rather than reactive detection.

   At `loop.ts:559` — instead of always `toolChoice: 'auto'`:
   ```typescript
   const toolChoiceMode = (selectionStats?.topScore ?? 0) > 0.7 ? 'required' : 'auto';
   ```

3. **Action verb detection on input** — Before calling the LLM, check if the user's message is an action request (imperative: "send", "create", "search", "find", "check", "delete", etc.). If yes, use `toolChoice: 'required'` from the start.

---

## Suggestion 5: Tool Schema Simplification for Groq (MEDIUM IMPACT)

**The problem**: `tools.ts:15-34` already relaxes numeric types (smart move). But Groq/Llama also struggle with:

- Complex nested objects in parameters
- Optional fields (they often skip required fields and fill optional ones)
- Enum types with many values

**Suggestions**:

1. For tools with complex schemas, add a hint in the description that restates the required params: `"Search the web. REQUIRED: query (string). OPTIONAL: count (number, default 10)"`
2. Consider creating Groq-specific simplified schemas for most-used tools (web_search, send_telegram, store_fact) that strip out optional parameters entirely

---

## Suggestion 6: Response Message Persistence Fix (MEDIUM IMPACT)

**The problem**: `loop.ts:919-926` pushes `result.response.messages` directly to `state.messages`. But the session loading code at `loop.ts:348` types messages as `Array<{ role: 'user' | 'assistant'; content: string }>` — it strips tool call/result structure on reload.

After a Thinker restart, the restored conversation has flattened tool calls that the LLM can't interpret correctly.

**Suggestion**: Either:

1. Persist the full `CoreMessage` structure in JSONL (including tool calls/results) and restore it faithfully, OR
2. On session restore, don't include tool call messages at all — just keep user/assistant text pairs and rely on the compaction summary for context

Option 2 is simpler and probably sufficient.

---

## Suggestion 7: Fewer Tools in Default Groups (LOW IMPACT)

**Current**: `tool-selector.ts:14-18` — the `email` group has 18 tools, `calendar` has 8. When a user says "check my email", ALL 18 email tools get included.

**Suggestion**: Create "lite" subgroups for common operations:

- `email_lite`: `gmail_list_emails`, `gmail_get_email`, `gmail_send_email`, `gmail_reply_email` (4 tools)
- `email_full`: all 18 (only triggered by specific keywords like "draft", "filter", "label", "attachment")
- Same for calendar: `calendar_lite` (list, create, quick_add) vs `calendar_full`

---

## Priority Summary

| # | Suggestion | Impact | Effort | Priority |
|---|---|---|---|---|
| 1 | Conversation history validation | HIGH | Medium | Do first |
| 2 | Tool result truncation | HIGH | Low | Do first |
| 3 | Tool count reduction for Groq | HIGH | Low | Do first |
| 4 | Hallucination guard improvements | MEDIUM | Low | Quick win |
| 5 | Tool schema simplification | MEDIUM | Medium | When time allows |
| 6 | Response message persistence fix | MEDIUM | Medium | When time allows |
| 7 | Fewer tools in default groups | LOW | Low | When time allows |

The top 3 together should dramatically improve Groq/Llama tool calling reliability. #1 fixes "tools stop working after a while", #2 prevents context flooding, #3 gives the model a fighting chance to pick the right tool.
