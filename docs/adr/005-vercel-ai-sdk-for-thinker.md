# ADR-005: Vercel AI SDK for the Thinker Agent Loop

**Status:** Accepted
**Date:** 2026-02-15

## Context

The Thinker agent needs to run a ReAct-style loop: send a message to an LLM, detect tool calls in the response, execute tools, feed results back, and repeat until the LLM produces a final answer. Options considered:

1. **Manual loop** — custom `while` loop with tool call detection and re-prompting
2. **LangChain** — full framework with agents, chains, memory, extensive abstractions
3. **Vercel AI SDK** — lightweight SDK with built-in `maxSteps` ReAct support

## Decision

**Use Vercel AI SDK** (`ai` package) with `@ai-sdk/groq` and `@ai-sdk/openai` providers. The `generateText()` function with `maxSteps` handles the ReAct loop automatically.

## Consequences

**Benefits:**
- `maxSteps` automates the entire ReAct loop — no manual loop management
- `tool()` function provides type-safe tool definitions with Zod schemas
- Provider-agnostic: swap Groq, LM Studio, or Ollama with one config change
- Lightweight: ~50KB, no heavy framework overhead
- Streaming support available (not used yet, but ready)

**Trade-offs:**
- Less control over individual loop iterations compared to a manual loop
- Tool recovery (detecting tool calls leaked as text) required custom code on top
- Hallucination guard (detecting false action claims) also required custom code
- Tied to Vercel AI SDK's abstractions for provider compatibility

## Related

- `Thinker/README.md` — Architecture section
- `Thinker/src/agent/loop.ts` — Main agent loop implementation
