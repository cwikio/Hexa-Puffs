# Thinker MCP Testing Plan

## Overview

This document outlines the integration testing strategy for the Thinker MCP - the AI reasoning engine for the Annabelle MCP ecosystem.

**Service:** Thinker MCP
**Default Port:** 8006
**Dependencies:** Orchestrator MCP (port 8000)

## Testing Philosophy

We focus on **integration tests against a real running Thinker server** rather than unit tests because:

1. The Thinker's value is in coordinating LLM calls with the Orchestrator
2. HTTP endpoint testing verifies the actual server behavior
3. Integration tests catch configuration and connectivity issues early
4. LLM completion tests verify the full provider chain works

---

## Test Environment Setup

### Prerequisites

- Thinker MCP running locally on port 8006
- Orchestrator MCP running locally on port 8000 (recommended)
- Valid LLM provider configuration:
  - **Groq:** `GROQ_API_KEY` environment variable set
  - **LM Studio:** Local server running on port 1234
  - **Ollama:** Local server running on port 11434

### Environment Variables

```bash
THINKER_URL=http://localhost:8006
ORCHESTRATOR_URL=http://localhost:8000

# LLM Provider (one of: groq, lmstudio, ollama)
THINKER_LLM_PROVIDER=groq
GROQ_API_KEY=your-api-key
```

---

## Level 2: Integration Tests

### Test Categories

| Category | Description | Tests |
|----------|-------------|-------|
| Health Check | Verify server is running and responsive | 3 tests |
| Root Endpoint | Verify service info endpoint | 2 tests |
| Orchestrator Connectivity | Verify Orchestrator connection | 2 tests |
| LLM Provider Configuration | Verify LLM settings | 3 tests |
| LLM Completion | Verify actual LLM calls work | 2 tests |
| Tracing System | Verify tracing is operational | 2 tests |
| Error Handling | Verify graceful error responses | 2 tests |
| Lifecycle Summary | End-to-end verification | 1 test |

**Total: 17 tests across 8 sections**

### Test Cases

#### Health Check Tests

| Test | Input | Expected |
|------|-------|----------|
| Health endpoint responds | `GET /health` | `200 OK` with status: 'ok' |
| Response structure valid | `GET /health` | Contains service, version, uptime, config |
| Uptime increases | Two calls 1s apart | Second uptime >= first |

#### Root Endpoint Tests

| Test | Input | Expected |
|------|-------|----------|
| Root responds | `GET /` | `200 OK` with service info |
| Structure valid | `GET /` | Contains service, description, endpoints |

#### Orchestrator Connectivity Tests

| Test | Input | Expected |
|------|-------|----------|
| URL configured | Check health response | orchestratorUrl present |
| Orchestrator reachable | Fetch Orchestrator health | `200 OK` (skipped if unavailable) |

#### LLM Provider Tests

| Test | Input | Expected |
|------|-------|----------|
| Provider configured | Check health response | groq, lmstudio, or ollama |
| Model configured | Check health response | Non-empty model string |
| Poll interval valid | Check health response | 1000-60000ms |

#### LLM Completion Tests

| Test | Input | Expected |
|------|-------|----------|
| Provider properly configured | Load config | Provider validation passes |
| Simple prompt completion | "Say hello" | Non-empty response within 30s |

#### Tracing Tests

| Test | Input | Expected |
|------|-------|----------|
| Log directory exists | Check ~/.annabelle/logs/ | Directory exists (or created on first use) |
| Trace entries readable | Read traces.jsonl | Valid JSONL with trace_id, ts, mcp, event |

---

## Running Tests

### Prerequisites

Start the Thinker MCP:

```bash
cd /path/to/Thinker
npm run dev
# Or: npm start
```

Optionally start Orchestrator for full testing:

```bash
cd /path/to/Orchestrator
npm run dev
```

### Commands

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with verbose output (default)
npm run test
```

### Test Output Example

```
=== Thinker MCP Tests (http://localhost:8006) ===

[12:34:56.789] i Checking health at http://localhost:8006/health
[12:34:56.812] + Health check passed (23ms)
[12:34:56.813] > Status: ok, Version: 0.1.0

...

=== LIFECYCLE TEST SUMMARY ===

[12:34:57.123] + Health endpoint: PASS
[12:34:57.145] + Root endpoint: PASS
[12:34:57.167] + LLM provider configured: PASS
[12:34:57.189] + Orchestrator URL configured: PASS
[12:34:58.234] + LLM completion works: PASS

=== Results: 5/5 passed ===
```

---

## Future: Level 3 Tests

Once Level 2 is solid, expand to:

**Orchestrator Integration:**

- Tool discovery from Orchestrator
- Message polling via Orchestrator
- Tool execution through Orchestrator

**Agent Loop Testing:**

- Mock message injection
- Response validation
- Tool call verification

**Tracing Verification:**

- Verify trace entries created for each operation
- Validate trace ID propagation to Orchestrator

---

## Success Criteria

Level 2 tests should verify:

- [x] Health endpoint returns 200 OK
- [x] Health response includes all required fields
- [x] Root endpoint returns service information
- [x] LLM provider is one of: groq, lmstudio, ollama
- [x] Model is configured for the provider
- [x] Orchestrator URL is configured
- [x] LLM completion works with simple prompt
- [x] Server responds within 5 seconds
- [x] Invalid endpoints return 404
