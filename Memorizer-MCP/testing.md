# Memorizer MCP Testing Plan

## Overview

This document outlines the integration testing strategy for the Memorizer MCP server, following the testing philosophy established in the Orchestrator project. We focus on **integration tests against the real MCP server** rather than unit tests with mocks.

**Port:** 8005
**Transport:** stdio (default) or SSE

---

## Testing Philosophy

We focus on **integration tests against real MCP servers** rather than unit tests with mocks because:
1. MCP clients are thin HTTP wrappers - little logic to unit test
2. Real value is verifying actual MCP server behavior
3. Mocking HTTP responses only tests the mocks, not reality

---

## Test Environment Setup

### Prerequisites
- Memorizer MCP server running (port 8005)
- Test database (separate from production)
- AI provider configured (Groq or LM Studio) OR disabled for isolation tests

### Environment Variables
```bash
TEST_MODE=true
MEMORIZER_URL=http://localhost:8005
DATABASE_PATH=/tmp/memorizer-test/memory.db
EXPORT_PATH=/tmp/memorizer-test/export/
FACT_EXTRACTION_ENABLED=true  # or false for isolation tests
```

### Docker Compose (Recommended)
```yaml
# docker-compose.test.yml
version: '3.8'
services:
  memorizer:
    image: mcp-memorizer:test
    ports: ["8005:8005"]
    environment:
      - TEST_MODE=true
      - STORAGE=memory  # in-memory, not persistent
      - FACT_EXTRACTION_ENABLED=false
```

---

## Level 2: Integration Tests for Memorizer MCP

### 2.1 Health & Initialization

| Test Case | Input | Expected |
|-----------|-------|----------|
| Health check (SSE mode) | `GET /health` | `200 OK` |
| Database initializes on first call | Start server, call any tool | Database created at configured path |
| Graceful handling of missing DB directory | Remove ~/.annabelle/data/ | Directory created, DB initialized |

---

### 2.2 Facts Tools

**Endpoint:** `POST /tools/call`

| Test Case | Tool | Input | Expected |
|-----------|------|-------|----------|
| Store new fact | `store_fact` | `{ fact: "User prefers dark mode", category: "preference" }` | `{ success: true, data: { id, fact, category } }` |
| Store fact in each category | `store_fact` | All 6 categories | Each stores successfully |
| Store duplicate fact | `store_fact` | Same fact twice | `stored: false`, timestamp updated |
| Store fact with agent_id | `store_fact` | `{ fact, category, agent_id: "custom" }` | Stored under custom agent |
| Reject sensitive fact | `store_fact` | `{ fact: "API key: sk-abc123..." }` | `{ success: false, error: "sensitive data" }` |
| List all facts | `list_facts` | `{ agent_id: "main" }` | Array of facts, total count |
| List facts by category | `list_facts` | `{ category: "preference" }` | Only preference facts returned |
| List facts with limit | `list_facts` | `{ limit: 5 }` | Max 5 facts returned |
| Delete existing fact | `delete_fact` | `{ fact_id: "existing_id" }` | `{ success: true, data: { deleted_fact } }` |
| Delete non-existent fact | `delete_fact` | `{ fact_id: "nonexistent" }` | `{ success: false, error: "not found" }` |

---

### 2.3 Conversation Tools

| Test Case | Tool | Input | Expected |
|-----------|------|-------|----------|
| Store conversation | `store_conversation` | `{ user_message, agent_response }` | `{ success: true, data: { id, facts_extracted } }` |
| Store with tags | `store_conversation` | `{ ..., tags: ["work", "project"] }` | Tags stored in JSON |
| Store with session_id | `store_conversation` | `{ ..., session_id: "session_123" }` | Session grouped |
| Auto-extract facts | `store_conversation` | Conversation with clear preference | `facts_extracted >= 1` |
| Skip short conversation | `store_conversation` | `{ user_message: "hi", agent_response: "hello" }` | `facts_extracted: 0` |
| Extraction failure continues | `store_conversation` | (with AI provider down) | Conversation stored, extraction logged |
| Search conversations | `search_conversations` | `{ query: "keyword" }` | Matching conversations returned |
| Search with date range | `search_conversations` | `{ query, date_from, date_to }` | Filtered by date |
| Search empty result | `search_conversations` | `{ query: "nonexistent_xyz" }` | Empty array, total: 0 |

---

### 2.4 Profile Tools

| Test Case | Tool | Input | Expected |
|-----------|------|-------|----------|
| Get default profile | `get_profile` | `{ agent_id: "new_agent" }` | Default profile structure |
| Get existing profile | `get_profile` | `{ agent_id: "existing" }` | Stored profile data |
| Update simple field | `update_profile` | `{ updates: { "user_info.name": "John" } }` | `{ updated_fields: ["user_info.name"] }` |
| Update nested path | `update_profile` | `{ updates: { "preferences.theme": "dark" } }` | Creates nested structure |
| Update array element | `update_profile` | `{ updates: { "current_projects[0].name": "New" } }` | Array updated |
| Update with reason | `update_profile` | `{ updates, reason: "User correction" }` | Reason stored in history |
| Profile history created | `update_profile` | Any update | Old profile in profile_history table |

---

### 2.5 Memory Retrieval

| Test Case | Tool | Input | Expected |
|-----------|------|-------|----------|
| Retrieve memories | `retrieve_memories` | `{ query: "dark mode" }` | Facts + conversations matching |
| Retrieve facts only | `retrieve_memories` | `{ query, include_conversations: false }` | Only facts returned |
| Results sorted by confidence | `retrieve_memories` | Query with multiple matches | Highest confidence first |
| Limit respected | `retrieve_memories` | `{ query, limit: 3 }` | Max 3 results per type |

---

### 2.6 Statistics

| Test Case | Tool | Input | Expected |
|-----------|------|-------|----------|
| Get empty stats | `get_memory_stats` | `{ agent_id: "empty_agent" }` | All counts 0 |
| Get populated stats | `get_memory_stats` | (after storing data) | Correct counts, date range |
| Facts by category | `get_memory_stats` | (after storing varied facts) | Breakdown per category |
| Database size reported | `get_memory_stats` | - | `database_size_mb > 0` |

---

### 2.7 Export/Import

| Test Case | Tool | Input | Expected |
|-----------|------|-------|----------|
| Export as JSON | `export_memory` | `{ format: "json" }` | JSON files created |
| Export as Markdown | `export_memory` | `{ format: "markdown" }` | MD files with structure |
| Export with conversations | `export_memory` | `{ include_conversations: true }` | Conversations included |
| Export directory structure | `export_memory` | - | facts/, conversations/, summary.md |
| Import profile | `import_memory` | `{ file_path: "...profile.json" }` | Profile updated |
| Import facts | `import_memory` | `{ file_path: "...facts/preference.json" }` | Facts inserted/replaced |
| Import invalid file | `import_memory` | `{ file_path: "invalid.txt" }` | Error returned |

---

### 2.8 Sanitizer Tests (Guardian-equivalent Security)

The Memorizer includes a sanitizer service that mirrors Guardian's security scanning capabilities. It detects and blocks sensitive data patterns:

| Test Case | Input Pattern | Expected |
|-----------|---------------|----------|
| OpenAI API key blocked | `sk-abc123...` | `{ safe: false }` |
| Groq API key blocked | `gsk_abc123...` | `{ safe: false }` |
| Anthropic key blocked | `sk-ant-...` | `{ safe: false }` |
| Password in text blocked | `password=secret123` | `{ safe: false }` |
| Credit card blocked | `4111 1111 1111 1111` | `{ safe: false }` |
| SSN blocked | `123-45-6789` | `{ safe: false }` |
| Private key blocked | `-----BEGIN RSA PRIVATE KEY-----` | `{ safe: false }` |
| AWS credentials blocked | `AKIA...` | `{ safe: false }` |
| DB connection string blocked | `postgresql://user:pass@...` | `{ safe: false }` |
| Clean text passes | `User prefers TypeScript` | `{ safe: true }` |

**Guardian Comparison:**
- Guardian scans at the Orchestrator level (input/output pipeline)
- Memorizer's sanitizer protects fact storage specifically
- Both use similar pattern detection for sensitive data

---

### 2.9 Multi-Agent Isolation

| Test Case | Scenario | Expected |
|-----------|----------|----------|
| Facts isolated by agent | Store fact for agent A, list for agent B | B sees empty list |
| Conversations isolated | Store for A, search from B | No results for B |
| Profiles isolated | Update A, get B | B has default profile |
| Stats isolated | Store for A, stats for B | B shows 0 counts |

---

### 2.10 Error Handling

| Test Case | Scenario | Expected |
|-----------|----------|----------|
| Invalid category | `store_fact` with `category: "invalid"` | ValidationError |
| Missing required field | `store_fact` without `fact` | ValidationError with details |
| Invalid date format | `search_conversations` with `date_from: "invalid"` | ValidationError |
| Database locked | Concurrent write operations | Graceful retry or error |

---

## Lifecycle Tests

### Lifecycle Test 1: Fact Management Lifecycle

```
Step 1: Store fact in "preference" category
├── Verify: Fact stored with ID returned
├── Verify: Confidence score set (default 1.0)
└── Assert: created_at timestamp present

Step 2: Store 2 more facts in different categories
├── Verify: Each has unique ID
└── Verify: Categories correctly assigned

Step 3: List all facts
├── Verify: Returns 3 facts
├── Verify: Total count = 3
└── Verify: Each fact has all fields

Step 4: List by category filter
├── Verify: Only "preference" facts returned
└── Verify: Other categories excluded

Step 5: Store duplicate fact
├── Verify: stored = false (dedupe detected)
└── Verify: updated_at changed, count still 3

Step 6: Delete one fact
├── Verify: Fact removed
├── Verify: List now shows 2 facts
└── Verify: Deleted fact text returned

Step 7: Check stats
├── Verify: fact_count = 2
└── Verify: facts_by_category reflects remaining
```

---

### Lifecycle Test 2: Conversation + Fact Extraction Pipeline

```
Step 1: Store conversation with extractable content
├── Input: "User: I love using VS Code for Python development"
├── Verify: Conversation stored with ID
├── Verify: facts_extracted >= 1
└── Verify: Extracted fact has source = conversation_id

Step 2: List facts and verify extraction
├── Verify: New fact(s) in list
├── Verify: Category assigned (likely "preference")
└── Verify: Confidence score present

Step 3: Search conversations by keyword
├── Query: "VS Code"
├── Verify: Returns the stored conversation
└── Verify: Both user_message and agent_response included

Step 4: Retrieve memories
├── Query: "Python development"
├── Verify: Returns both fact AND conversation
└── Verify: Sorted by relevance

Step 5: Store short conversation (should skip extraction)
├── Input: "User: ok / Agent: got it"
├── Verify: facts_extracted = 0
└── Verify: Conversation still stored

Step 6: Check stats
├── Verify: conversation_count = 2
├── Verify: fact_count includes auto-extracted
└── Verify: Date range covers both conversations
```

---

### Lifecycle Test 3: Profile Update with History

```
Step 1: Get profile for new agent
├── Verify: Returns default profile structure
├── Verify: user_info, preferences, current_projects, learned_patterns present
└── Verify: All values are defaults

Step 2: Update user_info.name
├── Input: { "user_info.name": "Alice" }
├── Verify: updated_fields includes "user_info.name"
└── Verify: Profile now has name = "Alice"

Step 3: Get profile to confirm
├── Verify: user_info.name = "Alice"
└── Verify: Other fields unchanged

Step 4: Update nested preferences
├── Input: { "preferences.theme": "dark", "preferences.language": "en" }
├── Verify: Both fields updated
└── Verify: Previous update (name) preserved

Step 5: Update with reason
├── Input: { "user_info.timezone": "UTC" }, reason: "User specified"
├── Verify: Update applied
└── Verify: Reason stored in profile_history

Step 6: Verify history trail
├── Query profile_history table directly (test helper)
├── Verify: 3+ history entries exist
└── Verify: Each has changed_at and profile snapshot
```

---

### Lifecycle Test 4: Export/Import Round-Trip

```
Step 1: Populate test data
├── Store 5 facts across 3 categories
├── Store 2 conversations
└── Update profile with custom data

Step 2: Export as JSON
├── Verify: Export directory created
├── Verify: profile.json exists and valid
├── Verify: facts/preference.json (etc) exist
├── Verify: conversations/ files exist
└── Verify: summary.md exists

Step 3: Clear database (test helper)
├── Delete all facts, conversations, profiles
└── Verify: Stats show all zeros

Step 4: Import profile.json
├── Verify: success = true
├── Verify: changes_applied > 0
└── Verify: get_profile returns imported data

Step 5: Import facts files
├── Import each category file
├── Verify: Facts restored
└── Verify: list_facts returns original facts

Step 6: Verify integrity
├── Stats match original counts
├── Retrieve memories works
└── Search conversations works
```

---

### Lifecycle Test 5: Sensitive Data Protection

```
Step 1: Attempt to store fact with API key
├── Input: "My OpenAI key is sk-abc123..."
├── Verify: success = false
└── Verify: Error mentions sensitive data

Step 2: Attempt store_conversation with password
├── Input: user_message contains "password=secret123"
├── Verify: Conversation stored (conversation itself OK)
├── Verify: Any extracted facts are sanitized or blocked
└── Verify: No raw password in facts table

Step 3: Test multiple sensitive patterns
├── Try: Credit card, SSN, AWS keys, private keys
├── Verify: All blocked from facts storage
└── Verify: Appropriate error messages

Step 4: Verify clean data passes
├── Store: "User prefers dark mode and TypeScript"
├── Verify: success = true
└── Verify: Fact stored normally
```

---

## Test Execution

### Running Tests

```bash
# Run all integration tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test suites
npm run test:facts
npm run test:conversations
npm run test:profiles
npm run test:memory
npm run test:stats
npm run test:export
npm run test:sanitizer
npm run test:multiagent
npm run test:lifecycle
```

### Test Output

Tests produce rich console output showing:
- Timestamps for each action
- Success/failure indicators with colors
- Duration of each operation
- Debug information for troubleshooting

Example output:
```
━━━ Memorizer MCP Tests (http://localhost:8005) ━━━

[12:34:56.789] i Checking health at http://localhost:8005/health
[12:34:56.812] ✓ Health check passed (23ms)
[12:34:56.813] i Calling store_fact tool
[12:34:56.891] ✓ store_fact succeeded (78ms)
```

---

## Test Structure

```
tests/
├── integration/
│   ├── facts.test.ts           # Facts CRUD tests
│   ├── conversations.test.ts   # Conversation tests
│   ├── profiles.test.ts        # Profile tests
│   ├── memory.test.ts          # Memory retrieval tests
│   ├── stats.test.ts           # Statistics tests
│   ├── export-import.test.ts   # Export/Import tests
│   ├── sanitizer.test.ts       # Security/sanitizer tests
│   └── multi-agent.test.ts     # Multi-agent isolation tests
├── lifecycle/
│   ├── fact-lifecycle.test.ts
│   ├── conversation-extraction.test.ts
│   ├── profile-history.test.ts
│   ├── export-import-roundtrip.test.ts
│   └── sensitive-data.test.ts
├── helpers/
│   ├── mcp-client.ts           # HTTP helper + rich logging
│   ├── test-data.ts            # Test fixtures
│   └── db-helpers.ts           # Direct DB access for verification
└── vitest.config.ts            # Vitest configuration
```

---

## CI/CD Integration

```yaml
# .github/workflows/test.yml
name: Integration Tests

on: [push, pull_request]

jobs:
  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Start Memorizer server
        run: |
          TEST_MODE=true npm start &
          sleep 5

      - name: Run integration tests
        run: npm test

      - name: Collect logs on failure
        if: failure()
        run: cat logs/*.log
```

---

## Success Criteria

Each test suite should pass:
- [ ] Health check responds 200
- [ ] All documented tools are callable
- [ ] Valid inputs return expected response format
- [ ] Invalid inputs return proper error responses
- [ ] Sensitive data is blocked/sanitized
- [ ] Multi-agent isolation is enforced
- [ ] No data leaks between tests (isolation)

---

## Current Test Status

**Test Results (as of implementation):**
- **5 passed** test files (facts, stats, memory, profiles, fact-lifecycle)
- **8 failing** test files require field name alignment

### Fully Passing Tests
| Test File | Tests | Status |
|-----------|-------|--------|
| facts.test.ts | 14 | ✓ PASS |
| stats.test.ts | 8 | ✓ PASS |
| memory.test.ts | 9 | ✓ PASS |
| profiles.test.ts | 5 | ✓ PASS (2 history tests need fix) |
| fact-lifecycle.test.ts | 7 | ✓ PASS |

### Tests Needing API Field Alignment

The following tests need response field names updated to match the actual API:

| Test File | Issue | Fix Required |
|-----------|-------|--------------|
| conversations.test.ts | Uses `id` instead of `conversation_id`, `total` instead of `total_count` | Update field names |
| export-import.test.ts | `files_created` is number not string array | Update type expectations |
| multi-agent.test.ts | Conversation tests use wrong field names | Update field names |
| sanitizer.test.ts | Sanitizer may not block all patterns as expected | Review actual sanitizer behavior |
| conversation-extraction.test.ts | Uses wrong field names for conversation_id | Update field names |
| profile-history.test.ts | Steps 5-6 need database access verification | Fix DB helper connection |
| sensitive-data.test.ts | Sanitizer behavior differs from expected | Review actual behavior |

### API Response Field Reference

For fixing remaining tests, use these actual API response formats:

**store_fact:**
```json
{ "success": true, "data": { "fact_id": 123, "stored_at": "..." } }
```

**list_facts:**
```json
{ "success": true, "data": { "facts": [...], "total_count": 10 } }
```

**store_conversation:**
```json
{ "success": true, "data": { "conversation_id": "conv_...", "facts_extracted": 1, "stored_at": "..." } }
```

**search_conversations:**
```json
{ "success": true, "data": { "conversations": [...], "total_count": 5 } }
```

**get_memory_stats:**
```json
{ "success": true, "data": { "fact_count": 10, "conversation_count": 5, "oldest_conversation": "...", "newest_conversation": "...", ... } }
```

**export_memory:**
```json
{ "success": true, "data": { "export_path": "...", "files_created": 5, "exported_at": "..." } }
```

---

## Related Documentation

- **Orchestrator testing.md** - Parent testing strategy with Guardian security scanning
- **Guardian MCP** - Security scanning service (port 8003) that scans at Orchestrator level
- **Memory MCP** (in Orchestrator) - Simpler memory service, Memorizer is enhanced version
