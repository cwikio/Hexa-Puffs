# Testing Guide

## Overview

Integration tests for the Annabelle MCP stack. All tests run against **real running servers** — no mocking.

## Architecture

```
Orchestrator (HTTP :8010) ←── Tests call POST /tools/call here
    ├── stdio → Memory MCP (Memorizer)
    ├── stdio → Filer MCP
    ├── stdio → Guardian MCP
    ├── stdio → 1Password MCP
    ├── stdio → Telegram MCP
    ├── HTTP  → Searcher MCP (:8007)
    └── HTTP  → Gmail MCP (:8008)

Thinker (HTTP :8006) ←── Proactive task tests call here
    ├── HTTP → Orchestrator (:8010)
    └── HTTP → Telegram MCP (:8002)
```

## Prerequisites

### Start the full stack

```bash
cd <repo-root>
./start-all.sh
```

This starts: Inngest (:8288), Telegram (:8002), Searcher (:8007), Gmail (:8008), Orchestrator (:8010, spawns Memory/Filer/Guardian/1Password via stdio), and Thinker (:8006).

Wait for all health checks to pass before running tests.

### Verify services are up

```bash
curl -s http://localhost:8010/health  # Orchestrator
curl -s http://localhost:8006/health  # Thinker
```

## Running Tests

### Orchestrator tests (recommended starting point)

All Orchestrator tests call the Orchestrator's HTTP API, which routes to downstream MCPs.

```bash
cd Orchestrator

# All tests
npm test

# Individual MCP tests (via Orchestrator routing)
npm run test:telegram          # Telegram tools
npm run test:filer             # File operation tools
npm run test:memory            # Memory/fact tools
npm run test:searcher          # Web search tools
npm run test:orchestrator      # Orchestrator lifecycle

# Cross-MCP workflow tests
npm run test:workflows                       # All workflows
npm run test:workflow:guardian-telegram       # Security + messaging
npm run test:workflow:filer-memory           # Files + memory
npm run test:workflow:onepassword-memory     # Credentials + memory
npm run test:workflow:jobs                   # Inngest job scheduling

# Skills pipeline (Memory → Orchestrator → Thinker)
npm run test:skills

# Stdio mode
npm run test:stdio
```

### Memorizer-MCP direct tests

These test Memory MCP directly (not through the Orchestrator). Requires a **standalone** Memory MCP on port 8005:

```bash
# Terminal 1: Start Memory MCP standalone
cd Memorizer-MCP
TRANSPORT=http PORT=8005 node dist/Memorizer-MCP/src/index.js

# Terminal 2: Run tests
cd Memorizer-MCP
npm test                    # All 150 tests (facts, conversations, profiles, skills, etc.)
npm run test:skills         # Skills CRUD only (18 tests)
```

Note: When using the full stack (`start-all.sh`), Memory MCP runs as a stdio child of the Orchestrator and is **not** available on port 8005. Use `npm run test:skills` in the Orchestrator directory instead to test skills through the Orchestrator.

### Gmail-MCP tests

Requires Gmail MCP running on port 8008 (started by `start-all.sh`):

```bash
cd Gmail-MCP
npm run test:api            # Filter CRUD tests
```

### Thinker tests

Requires both Thinker (:8006) and Orchestrator (:8010):

```bash
cd Thinker
npm run test:proactive      # Proactive task execution via /execute-skill
```

## Test Structure

```
Orchestrator/tests/
├── TESTING.md                              # This file
├── helpers/
│   ├── mcp-client.ts                       # MCPTestClient (HTTP), logging, factory functions
│   └── workflow-helpers.ts                  # parseJsonContent, parseGuardianResult, testId, etc.
├── unit/
│   └── cron-validation.test.ts             # Cron expression validation, timezone validation, due-check logic
├── integration/
│   ├── telegram.test.ts                    # Telegram MCP tools
│   ├── filer.test.ts                       # Filer MCP tools
│   ├── memory.test.ts                      # Memory MCP tools
│   ├── searcher.test.ts                    # Searcher MCP tools
│   ├── orchestrator.test.ts                # Orchestrator health, tool discovery
│   ├── stdio-mode.test.ts                  # Stdio transport tests
│   ├── workflow-guardian-telegram.test.ts   # Guardian scan → Telegram send
│   ├── workflow-filer-memory.test.ts        # File ops → memory audit
│   ├── workflow-onepassword-memory.test.ts  # 1Password → memory storage
│   ├── workflow-jobs.test.ts                # Inngest job scheduling + cron validation
│   └── workflow-skills.test.ts             # Skills pipeline (store → execute → update)
│
Memorizer-MCP/tests/
├── helpers/
│   ├── setup.ts                            # Global health check (port 8005)
│   ├── mcp-client.ts                       # McpClient with convenience methods
│   ├── db-helpers.ts                       # Direct DB access for cleanup
│   └── test-data.ts                        # Sample data, generators
├── integration/
│   ├── facts.test.ts                       # store_fact, list_facts, delete_fact
│   ├── conversations.test.ts               # store/search conversations
│   ├── profiles.test.ts                    # get/update profile
│   ├── memory.test.ts                      # retrieve_memories
│   ├── multi-agent.test.ts                 # Agent isolation
│   ├── sanitizer.test.ts                   # Sensitive data blocking
│   ├── export-import.test.ts               # Export/import
│   ├── stats.test.ts                       # get_memory_stats
│   └── skills.test.ts                      # Skills CRUD (18 tests)
├── lifecycle/
│   ├── fact-lifecycle.test.ts
│   ├── profile-history.test.ts
│   ├── conversation-extraction.test.ts
│   ├── sensitive-data.test.ts
│   └── export-import-roundtrip.test.ts
│
Gmail-MCP/tests/
└── integration/
    └── filters.test.ts                     # Gmail filter CRUD
│
Thinker/tests/
└── integration/
    └── proactive-tasks.test.ts             # POST /execute-skill endpoint
```

## Test Design

### Graceful skipping

Tests check service availability in `beforeAll` and skip when dependencies are unavailable. This means you can run the full test suite even if some services are down — relevant tests will skip with a warning instead of failing.

### Test isolation

- Each test suite uses unique agent IDs (`test-<suite>-<timestamp>`) to avoid collisions
- Cleanup runs in `afterAll` to remove test data
- Tests are ordered within suites (no shuffle) since some depend on prior state

### Response parsing

Orchestrator tool calls return MCP-format responses. Use the helpers:

```typescript
import { parseJsonContent, parseTextContent } from '../helpers/workflow-helpers.js'

const result = await client.callTool('memory_list_skills', { agent_id: 'test' })
const parsed = parseJsonContent<{ success: boolean; data: { skills: Skill[] } }>(result)
```

## Quick Reference

| What to test | Command | Requires |
| --- | --- | --- |
| Skills end-to-end | `cd Orchestrator && npm run test:skills` | Orchestrator + Thinker |
| Memory tools via Orchestrator | `cd Orchestrator && npm run test:memory` | Orchestrator |
| Memory tools direct | `cd Memorizer-MCP && npm test` | Standalone Memory MCP on :8005 |
| Gmail filters | `cd Gmail-MCP && npm run test:api` | Gmail MCP on :8008 |
| Thinker proactive tasks | `cd Thinker && npm run test:proactive` | Orchestrator + Thinker |
| All Orchestrator tests | `cd Orchestrator && npm test` | Full stack |
| All workflows | `cd Orchestrator && npm run test:workflows` | Full stack |
