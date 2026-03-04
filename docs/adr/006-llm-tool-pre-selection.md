# ADR-006: LLM-Based Tool Pre-Selection with Local 4B Model

**Status:** Accepted
**Date:** 2026-03-04

## Context

The Thinker agent selects tools for each message using a two-layer approach: embedding similarity (nomic-embed-text) plus keyword regex matching. This pipeline runs every turn and produces 13-20 tools for the LLM (Groq). While effective, it has two problems:

1. **No intelligent gating** — every message goes through the full embedding+regex pipeline, even greetings ("hello how are you") that need zero tools. These messages still get 20 tools sent to Groq, wasting context window and adding latency.
2. **No primary tool signal** — the embedding pipeline ranks tools by similarity but cannot identify a single "most appropriate" tool with confidence. Groq receives a flat list and must decide from scratch.

Options considered:

1. **Heuristic gating** — pattern-match greetings/chat to skip tool selection. Brittle, doesn't generalize.
2. **Ask Groq to pre-filter** — extra API call to the paid LLM. Adds cost and latency.
3. **Local 4B model as pre-selector** — use a small, fast, local model (Qwen3.5-4B via Ollama) to see all 144 tools and pick the best one before the pipeline runs.

## Decision

**Use a local Qwen3.5-4B model via Ollama as a tool pre-selector** that runs before the embedding+regex pipeline. The model sees all 144 tool schemas and makes one of three decisions:

- **Pick a specific tool** → reduce the pipeline (fewer core tools, tighter cap) and inject the pick
- **Call `_No_Tool_Needed`** (pseudo-tool) → skip the pipeline entirely, send only 2 core tools
- **No tool call at all** → ambiguous/failed, fall back to the full pipeline (safe default)

The `_No_Tool_Needed` pseudo-tool is appended to the schema list sent to the 4B model. Its description explicitly excludes action requests and real-time data queries, directing the model to only use it for greetings, thanks, general knowledge, and casual conversation.

### Three-outcome discriminated union

```typescript
type LlmToolSelectionOutcome =
  | { kind: 'tool_selected'; toolName: string; args: Record<string, unknown> }
  | { kind: 'no_tool_needed' }
  | null  // error, unavailable, ambiguous
```

This replaces the previous `LlmToolSelectionResult | null` return type, which couldn't distinguish "no tools needed" from "system failure".

## Consequences

**Benefits:**
- Average tools sent to Groq reduced from 17.9 (no pre-selector) to 11.2 (37% reduction across 20 test messages)
- Greetings/chat messages drop from 20 tools to 2 (90% reduction for those messages)
- 90% tool pick rate — the pseudo-tool forces the 4B to make explicit decisions, reducing ambiguous null returns (e.g., "who is the president of France" now correctly picks `searcher_web_search`)
- Zero API cost — the 4B model runs locally via Ollama (~100ms per call)
- Circuit breaker pattern: 3 consecutive failures → 5-minute cooldown → automatic recovery
- Graceful degradation: if Ollama is down, the full pipeline runs unchanged

**Trade-offs:**
- Requires Ollama running locally with `qwen3.5:4b-q4_K_M` model (~2.5GB VRAM)
- Adds ~100ms latency per message for the local LLM call
- The 4B model occasionally picks suboptimal tools (e.g., `memory_list_contacts` instead of `gmail_send_email` for "send an email to bob") — mitigated by the embedding+regex pipeline still running underneath
- One remaining null case: "save this note to my workspace" — the 4B can't identify the right filer tool, but correctly does NOT misclassify it as `_No_Tool_Needed`

## Related

- [ADR-005](005-vercel-ai-sdk-for-thinker.md) — Vercel AI SDK for agent loop (this feature builds on top)
- [Tools](../tools.md) — Tool selection architecture (updated with LLM pre-selection layer)
- `Thinker/src/agent/components/llm-tool-selector.ts` — LLM pre-selector implementation
- `Thinker/src/agent/loop.ts` — Integration point (lines ~502-537)
- `Thinker/tool-reduction-report.md` — Benchmark results across 20 test messages
