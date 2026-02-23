# Hexa Puffs Test Plan

Last updated: 2026-02-22

## Overview

This test plan tracks test coverage across all packages in the Hexa Puffs MCP monorepo. Tests use **vitest** and follow a unit/integration/lifecycle structure.

## Test Inventory

### Shared (15 test files)

| Test File | Type | Covers |
|-----------|------|--------|
| `agent-contract.test.ts` | Unit | Zod schemas for Orchestrator-Thinker contract |
| `config.test.ts` | Unit | Shared configuration utilities |
| `cosine-similarity.test.ts` | Unit | Vector similarity math |
| `discovery-format.test.ts` | Unit | MCP discovery manifest format |
| `dual-transport.test.ts` | Unit | Stdio + HTTP dual transport |
| `embedding-factory.test.ts` | Unit | Embedding provider factory |
| `errors.test.ts` | Unit | Error types and helpers |
| `external-loader.test.ts` | Unit | External MCP loader |
| `huggingface-provider.test.ts` | Unit | HuggingFace embedding provider |
| `jsonl-logger.test.ts` | Unit | JSONL structured logging |
| `logger.test.ts` | Unit | Logger class |
| `register-tool.test.ts` | Unit | Tool registration helper |
| `scanner-channel.test.ts` | Unit | Scanner channel abstraction |
| `scanner.test.ts` | Unit | MCP scanner |
| `standard-response.test.ts` | Unit | StandardResponse builder |

### Orchestrator (50 test files)

**Unit (22 files):**

| Test File | Covers |
|-----------|--------|
| `agent-manager.test.ts` | Agent lifecycle management |
| `channel-manager.test.ts` | Channel registration and routing |
| `cron-validation.test.ts` | Cron expression validation |
| `executor.test.ts` | Task executor |
| `external-watcher.test.ts` | External MCP file watcher |
| `generic-channel-adapter.test.ts` | Generic channel adapter |
| `graduated-backoff.test.ts` | Graduated backoff strategy |
| `guarded-client.test.ts` | Guardian-wrapped MCP client |
| `guardian-overrides.test.ts` | Guardian override rules |
| `halt-manager.test.ts` | Halt/resume state machine, disk persistence, error resilience |
| `health-check.test.ts` | Health check endpoint |
| `http-client.test.ts` | HTTP MCP client |
| `message-router.test.ts` | Message routing logic |
| `notification-service.test.ts` | Telegram notification service (startup, hot-reload, validation errors) |
| `one-shot-schedule.test.ts` | One-shot scheduling |
| `project-recognition.test.ts` | Project auto-detection |
| `required-tools-validation.test.ts` | Required tools validation |
| `scanner-channel.test.ts` | Scanner channel |
| `scanner.test.ts` | MCP scanner |
| `skill-normalizer.test.ts` | Skill name normalization |
| `slash-commands.test.ts` | Slash command parsing |
| `startup-diff.test.ts` | MCP startup diff computation |
| `stdio-guardian.test.ts` | Stdio guardian client |
| `tier-router.test.ts` | Tier-based routing |
| `tool-blocking.test.ts` | Destructive tool blocking |
| `tool-catalog.test.ts` | Tool catalog |
| `tool-policy.test.ts` | Tool policy enforcement |

**Integration (22 files):**

| Test File | Covers |
|-----------|--------|
| `filer.test.ts` | Filer MCP integration |
| `guardian-passthrough.test.ts` | Guardian passthrough flow |
| `memory.test.ts` | Memory integration |
| `multi-channel.test.ts` | Multi-channel messaging |
| `orchestrator.test.ts` | Full orchestrator lifecycle |
| `searcher.test.ts` | Searcher MCP integration |
| `skill-tiers-e2e.test.ts` | Skill tier system E2E |
| `stdio-mode.test.ts` | Stdio mode operation |
| `telegram.test.ts` | Telegram channel |
| `tool-catalog.test.ts` | Tool catalog integration |
| `workflow-cron-scheduling.test.ts` | Cron scheduling workflow |
| `workflow-direct-execution.test.ts` | Direct execution workflow |
| `workflow-filer-memory.test.ts` | Filer + memory workflow |
| `workflow-guardian-gmail.test.ts` | Guardian + Gmail workflow |
| `workflow-guardian-searcher.test.ts` | Guardian + Searcher workflow |
| `workflow-guardian-telegram.test.ts` | Guardian + Telegram workflow |
| `workflow-guardian-thinker.test.ts` | Guardian + Thinker workflow |
| `workflow-lazy-spawn.test.ts` | Lazy MCP spawn workflow |
| `workflow-onepassword-memory.test.ts` | 1Password + memory workflow |
| `workflow-scheduler-e2e.test.ts` | Scheduler E2E |
| `workflow-skill-normalizer.test.ts` | Skill normalizer workflow |
| `workflow-skills.test.ts` | Skills workflow |
| `workflow-subagent.test.ts` | Subagent workflow |
| `workflow-tool-validation.test.ts` | Tool validation workflow |

### Thinker (23 test files)

**Unit (14 files):**

| Test File | Covers |
|-----------|--------|
| `circuit-breaker.test.ts` | Circuit breaker state machine (closed/open/half-open) |
| `context-builder.test.ts` | Context building: prompt assembly, history selection, playbooks |
| `embedding-integration.test.ts` | Embedding integration |
| `embedding-tool-selector.test.ts` | Embedding-based tool selection |
| `fact-extractor.test.ts` | Fact extraction from conversations |
| `hallucination-guard.test.ts` | Regex pattern detection (action claims, tool refusals) |
| `hallucination-guard-retry.test.ts` | Retry strategies (forced tool call, tool refusal recovery) |
| `history-repair.test.ts` | Conversation history repair |
| `playbook-classifier.test.ts` | Playbook classification |
| `playbook-seed.test.ts` | Playbook seeding |
| `recover-tool-call.test.ts` | Tool call recovery (pure functions) |
| `response-generator.test.ts` | Response generation: two-phase search, leak recovery, guards |
| `skill-loader.test.ts` | Skill loader |
| `skill-loader-schedule.test.ts` | Skill loader scheduling |
| `tool-normalization.test.ts` | Tool name normalization |
| `tool-recovery-class.test.ts` | ToolRecovery class: leaked tool call handling |
| `tool-selection.test.ts` | Tool selection logic |

**Integration (3 files):**

| Test File | Covers |
|-----------|--------|
| `chat-id-injection.test.ts` | Chat ID injection into tool calls |
| `embedding-cache.test.ts` | Embedding cache |
| `history-repair-loop.test.ts` | History repair in agent loop |
| `proactive-tasks.test.ts` | Proactive task scheduling |
| `thinker.test.ts` | Full Thinker agent lifecycle |

**Root-level (2 files):**

| Test File | Covers |
|-----------|--------|
| `cost-monitor.test.ts` | Cost monitoring and spike detection |
| `history-repair.test.ts` | History repair (duplicate of unit?) |
| `tool-selection.test.ts` | Tool selection (duplicate of unit?) |
| `tool-selector.test.ts` | Tool selector |

### Filer-MCP (10 test files)

**Unit (7 files):**

| Test File | Covers |
|-----------|--------|
| `config.test.ts` | Config singleton, resetConfig(), loadConfig defaults |
| `paths.test.ts` | Path security: forbidden paths, traversal, extensions, symlinks, resolvePath |
| `audit.test.ts` | Audit entries: createAuditEntry, writeAuditEntry, readAuditLog with filters |
| `grants.test.ts` | Grant CRUD: find, create, list, revoke, checkPermission, systemGrants |
| `cleanup.test.ts` | Temp cleanup: age-based deletion, directory skipping, audit integration |
| `workspace.test.ts` | Workspace init, getWorkspaceStats, temp file counting |
| `db-index.test.ts` | JSON storage: loadGrants, saveGrants, caching, corrupt file resilience |

**Integration (3 files):**

| Test File | Covers |
|-----------|--------|
| `filer.test.ts` | All 14 tools, security edge cases, audit logging |
| `filer-lifecycle.test.ts` | Full operational cycle: init, CRUD, search, security, audit, edge cases |
| `grant-lifecycle.test.ts` | Grant journey: check denied, request, verify, permission boundary, audit |

### Memorizer-MCP (26 test files)

**Unit (8 files):**

| Test File | Covers |
|-----------|--------|
| `contacts.test.ts` | Contact operations |
| `embeddings.test.ts` | Embedding operations |
| `hybrid-search.test.ts` | Hybrid (vector + FTS) search |
| `parse-json.test.ts` | JSON parsing utilities |
| `project-sources.test.ts` | Project source management |
| `projects.test.ts` | Project operations |
| `server.test.ts` | MCP server |
| `skill-execution-plan.test.ts` | Skill execution planning |
| `vector-search.test.ts` | Vector search |

**Integration (11 files):**

| Test File | Covers |
|-----------|--------|
| `contacts.test.ts` | Contact integration |
| `conversations.test.ts` | Conversation storage |
| `export-import.test.ts` | Export/import |
| `facts.test.ts` | Fact storage and retrieval |
| `memory.test.ts` | Memory operations |
| `multi-agent.test.ts` | Multi-agent memory |
| `profiles.test.ts` | User profiles |
| `projects.test.ts` | Project integration |
| `sanitizer.test.ts` | Data sanitization |
| `skills.test.ts` | Skills |
| `stats.test.ts` | Statistics |
| `timeline.test.ts` | Timeline |

**Lifecycle (4 files):**

| Test File | Covers |
|-----------|--------|
| `conversation-extraction.test.ts` | Conversation extraction flow |
| `export-import-roundtrip.test.ts` | Export/import roundtrip |
| `fact-lifecycle.test.ts` | Fact lifecycle |
| `profile-history.test.ts` | Profile history |
| `sensitive-data.test.ts` | Sensitive data handling |

### Onepassword-MCP (2 test files)

| Test File | Type | Covers |
|-----------|------|--------|
| `server.test.ts` | Unit | MCP server |
| `tools.test.ts` | Unit | Tool operations |

### Searcher-MCP (2 test files)

| Test File | Type | Covers |
|-----------|------|--------|
| `web-fetch.test.ts` | Unit | Web fetch tool |
| `searcher.test.ts` | Integration | Searcher operations |

### Guardian-MCP (0 test files)

No tests found.

---

## Recent Architecture Changes (Items 9-15)

These components were extracted during the medium-priority architecture improvements. Coverage status:

| Component | Source | Test File | Status | Tests |
|-----------|--------|-----------|--------|-------|
| Agent Contract Schemas | `Shared/Types/agent-contract.ts` | `Shared/tests/agent-contract.test.ts` | Covered | 21 |
| CircuitBreaker | `Thinker/src/agent/circuit-breaker.ts` | `Thinker/tests/unit/circuit-breaker.test.ts` | Covered | 17 |
| HallucinationGuard (patterns) | `Thinker/src/agent/components/hallucination-guard.ts` | `Thinker/tests/unit/hallucination-guard.test.ts` | Covered | 54 |
| HallucinationGuard (retry) | `Thinker/src/agent/components/hallucination-guard.ts` | `Thinker/tests/unit/hallucination-guard-retry.test.ts` | Covered | 9 |
| NotificationService | `Orchestrator/src/core/notification-service.ts` | `Orchestrator/tests/unit/notification-service.test.ts` | Covered | 15 |
| ContextBuilder | `Thinker/src/agent/components/context-builder.ts` | `Thinker/tests/unit/context-builder.test.ts` | Covered | 16 |
| ToolRecovery | `Thinker/src/agent/components/tool-recovery.ts` | `Thinker/tests/unit/tool-recovery-class.test.ts` | Covered | 7 |
| ResponseGenerator | `Thinker/src/agent/components/response-generator.ts` | `Thinker/tests/unit/response-generator.test.ts` | Covered | 12 |
| HaltManager | `Orchestrator/src/core/halt-manager.ts` | `Orchestrator/tests/unit/halt-manager.test.ts` | Covered | 21 |
| Filer resetConfig() | `Filer-MCP/src/utils/config.ts` | `Filer-MCP/tests/unit/config.test.ts` | Covered | 4 |

**Total new tests: 176 across 10 test files.**

---

## Remaining Coverage Gaps

### P2 - Medium Priority

| Gap | Package | Notes |
|-----|---------|-------|
| Orchestrator `orchestrator.ts` | Orchestrator | Integration tests exist but no focused unit tests for the main class (NotificationService was extracted; MCP lifecycle, routing, hot-reload remain). |
| Thinker `loop.ts` | Thinker | Integration tests exist via `thinker.test.ts` but no focused unit tests for the main loop logic after extraction. |

### P3 - Low Priority (nice to have)

| Gap | Package | Notes |
|-----|---------|-------|
| `http-handlers.ts` | Orchestrator | HTTP handlers, covered indirectly by integration tests. |
| Root-level duplicate tests | Thinker | `tests/history-repair.test.ts` and `tests/tool-selection.test.ts` may duplicate unit tests — audit and consolidate. |

---

## Test Counts by Package

| Package | Unit | Integration | Lifecycle | Total |
|---------|------|-------------|-----------|-------|
| Shared | 15 | 0 | 0 | 15 |
| Orchestrator | 28 | 22 | 0 | 50 |
| Thinker | 17 | 5 | 0 | 22+ |
| Filer-MCP | 7 | 3 | 0 | 10 |
| Memorizer-MCP | 9 | 12 | 5 | 26 |
| Onepassword-MCP | 2 | 0 | 0 | 2 |
| Searcher-MCP | 1 | 1 | 0 | 2 |
| **Total** | **79** | **43** | **5** | **127+** |

---

## E2E Tests (Planned)

Full-stack tests that exercise the entire Hexa Puffs stack (Orchestrator + MCPs + Thinker). These require all services running and are documented for future implementation.

| E2E Test | What it would verify |
|----------|---------------------|
| Filer via Orchestrator | Orchestrator routes `file_read`/`file_write` to Filer MCP, verifies response |
| Grant enforcement via Orchestrator | External path request routed through Orchestrator, Filer checks grants |
| Audit trail after Thinker workflow | After Thinker uses Filer tools via Orchestrator, audit log has entries |
| Temp cleanup after scheduled job | Scheduler triggers cleanup, old temp files removed |
| Memory + Filer cross-MCP | Thinker stores fact via Memorizer, retrieves file via Filer in same conversation |

---

## Running Tests

```bash
# Full suite
./test.sh

# Single package
cd <Package> && npx vitest run

# Quick health check
./test.sh --quick

# Single test file
cd <Package> && npx vitest run tests/unit/circuit-breaker.test.ts
```
