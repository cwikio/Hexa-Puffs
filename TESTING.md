# MCP Stack Testing Guide

This document provides a high-level overview of the testing strategy for the MCP stack. For detailed documentation on specific test suites, refer to the individual test files and documentation.

## Quick Start

```bash
# Run all tests across all MCPs
./test.sh

# Run quick health checks + curl tests only
./test.sh --quick

# Run vitest tests only (skip curl tests)
./test.sh --vitest
```

## Testing Architecture

The MCP stack uses a **multi-level testing strategy**:

| Level | Type | Description | Location |
|-------|------|-------------|----------|
| 1 | Unit Tests | Individual function/class tests | Each MCP's `tests/` folder |
| 2 | Integration Tests | Single MCP integration tests | Each MCP's `tests/integration/` |
| 3 | Workflow Tests | Cross-MCP coordination tests | `Orchestrator/tests/integration/workflow-*.test.ts` |

## MCP Test Suites

Each MCP has its own test suite that can be run independently:

| MCP | Transport | Test Command | Description |
|-----|-----------|--------------|-------------|
| Shared | — | `cd Shared && npm test` | Shared utilities, types, logger |
| Guardian | stdio | `cd Guardian && npm test` | Security scanning, content validation |
| Filer | stdio | `cd Filer-MCP && npm test` | File operations (CRUD, search, audit) |
| Memorizer | stdio | `cd Memorizer-MCP && npm test` | Facts, conversations, profiles |
| 1Password | stdio | `cd Onepassword-MCP && npm test` | Vault reading (read-only) |
| CodeExec | stdio | `cd CodeExec-MCP && npm test` | Sandboxed code execution |
| Telegram | stdio | `cd Telegram-MCP && npm test` | Message send/receive, chat management |
| Searcher | stdio | `cd Searcher-MCP && npm test` | Web/news/image search |
| Gmail | stdio | `cd Gmail-MCP && npm test` | Email and calendar operations |
| Orchestrator | HTTP :8010 | `cd Orchestrator && npm test` | Routing, discovery, workflows, jobs |

## Level 3 Workflow Tests

Cross-MCP workflow tests verify that multiple MCPs work together correctly. These tests are located in the Orchestrator and use a **graceful degradation** pattern - if an MCP is unavailable, tests that require it will skip rather than fail.

### Workflow Test Files

| Test File | Workflow | MCPs Involved |
|-----------|----------|---------------|
| `workflow-guardian-telegram.test.ts` | Secure message sending | Guardian → Telegram |
| `workflow-filer-memory.test.ts` | File ops with audit trail | Filer → Memory |
| `workflow-onepassword-memory.test.ts` | Credential access logging | 1Password → Memory |
| `workflow-jobs.test.ts` | Background task scheduling | Jobs → Guardian → Telegram |

### Running Workflow Tests

```bash
cd Orchestrator

# Run all workflow tests
npm run test:workflows

# Run individual workflow tests
npm run test:workflow:guardian-telegram
npm run test:workflow:filer-memory
npm run test:workflow:onepassword-memory
npm run test:workflow:jobs
```

## Test Dependencies

### Required Services

Before running integration/workflow tests, ensure the stack is running:

```bash
# Launch full stack (Orchestrator spawns stdio MCPs automatically)
./start-all.sh
```

Note: All MCPs are stdio — spawned by Orchestrator as child processes. `start-all.sh` launches Inngest, Ollama, and Orchestrator (which auto-discovers and spawns all MCPs + Thinker agents). Unit tests (`npm test` per package) don't require running services.

### External Dependencies

- **Inngest**: Required for job/task scheduling tests (`workflow-jobs.test.ts`)
- **1Password CLI**: Required for 1Password tests (`workflow-onepassword-memory.test.ts`)
- **Telegram Bot Token**: Required for Telegram message tests

## Test Patterns

### Graceful Degradation

Workflow tests use runtime checks to skip when MCPs are unavailable:

```typescript
function skipIfUnavailable(requiredMcps: ('guardian' | 'telegram')[]): boolean {
  const missing: string[] = []
  if (requiredMcps.includes('guardian') && !guardianAvailable) missing.push('Guardian')
  if (requiredMcps.includes('telegram') && !telegramAvailable) missing.push('Telegram')

  if (missing.length > 0) {
    log(`Skipping: ${missing.join(', ')} unavailable`, 'warn')
    return true
  }
  return false
}

it('should send secure message', async () => {
  if (skipIfUnavailable(['guardian', 'telegram'])) return
  // test code
})
```

### Test Cleanup

All tests clean up resources they create:

```typescript
afterAll(async () => {
  await cleanupFacts(memoryClient, createdFactIds)
  await cleanupFiles(filerClient, createdFilePaths)
})
```

### MCP Test Client

Tests use a shared `MCPTestClient` wrapper for HTTP calls:

```typescript
const client = createGuardianClient()
const result = await client.callTool('scan_content', { content: 'test' })
expect(result.success).toBe(true)
```

## Detailed Documentation

For detailed documentation on specific test suites:

- **Orchestrator Tests**: [Orchestrator/tests/TESTING.md](Orchestrator/tests/TESTING.md)
- **Test Helpers**: [Orchestrator/tests/helpers/](Orchestrator/tests/helpers/)
- **Workflow Helpers**: [Orchestrator/tests/helpers/workflow-helpers.ts](Orchestrator/tests/helpers/workflow-helpers.ts)

## CI/CD Integration

The `test.sh` script returns exit code 0 on success, 1 on failure, making it suitable for CI pipelines:

```yaml
# Example GitHub Actions
- name: Run MCP Tests
  run: ./test.sh --vitest
```

## Troubleshooting

### Common Issues

1. **Tests hang or timeout**: Check that the required MCP is running on the expected port
2. **Permission errors**: Ensure Filer has access to workspace directories
3. **Telegram tests fail**: Verify `TELEGRAM_BOT_TOKEN` is set
4. **Job tests fail**: Ensure Inngest server is running

### Debug Mode

Run individual tests with verbose output:

```bash
cd Orchestrator
npx vitest run tests/integration/workflow-guardian-telegram.test.ts --reporter=verbose
```
