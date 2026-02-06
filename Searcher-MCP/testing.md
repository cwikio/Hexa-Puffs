# Searcher MCP Testing Guide

This document describes the test suite for the Searcher MCP server.

## Overview

The test suite uses [Vitest](https://vitest.dev/) for integration testing. Tests run against a live HTTP server and verify the complete request/response cycle for both `web_search` and `news_search` tools.

## Prerequisites

- Node.js >= 20.0.0
- Valid `BRAVE_API_KEY` in `.env` file
- Searcher MCP server running in HTTP mode

## Quick Start

```bash
# Install dependencies (if not already done)
npm install

# Start the server in HTTP mode (in a separate terminal)
TRANSPORT=http npm start

# Run all tests
npm test

# Run tests in watch mode (for development)
npm run test:watch
```

## Test Commands

| Command | Description |
|---------|-------------|
| `npm test` | Run all tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:web` | Run only web search tests |
| `npm run test:news` | Run only news search tests |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SEARCHER_URL` | `http://localhost:8007` | URL of the Searcher MCP server |
| `BRAVE_API_KEY` | (required) | Brave Search API key |
| `TRANSPORT` | `stdio` | Set to `http` for testing |
| `PORT` | `8007` | Server port (when using HTTP transport) |

## Test Structure

```
tests/
├── helpers/
│   └── mcp-client.ts       # HTTP client helper with typed tools
├── fixtures/
│   └── search-queries.ts   # Test data and expected patterns
└── integration/
    └── searcher.test.ts    # Main integration test suite
```

### Test Categories

The test suite contains 55 test cases organized into 12 categories:

1. **Health & Initialization** (4 tests)
   - Health endpoint response
   - Health data structure
   - Tool listing
   - Tool schema validation

2. **Web Search - Basic Operations** (5 tests)
   - Simple query execution
   - Response structure validation
   - Special characters handling
   - Unicode query support
   - Result count accuracy

3. **Web Search - Count Parameter** (6 tests)
   - Default count behavior
   - Valid count values (1, 5, 20)
   - Invalid count rejection (0, 25)

4. **Web Search - Freshness Parameter** (5 tests)
   - Valid freshness values (24h, week, month, year)
   - Invalid freshness rejection

5. **Web Search - Safesearch Parameter** (5 tests)
   - Default safesearch behavior
   - Valid safesearch values (off, moderate, strict)
   - Invalid safesearch rejection

6. **News Search - Basic Operations** (4 tests)
   - Simple query execution
   - Response structure validation
   - Query with numbers
   - Result count accuracy

7. **News Search - Count Parameter** (5 tests)
   - Default count behavior
   - Valid count values
   - Invalid count rejection

8. **News Search - Freshness Parameter** (5 tests)
   - Valid freshness values (24h, week, month)
   - Year freshness rejection (not supported)
   - Invalid freshness rejection

9. **Input Validation - Query Parameter** (6 tests)
   - Missing query rejection
   - Null query rejection
   - Wrong type rejection

10. **Error Handling** (5 tests)
    - Unknown tool (404)
    - Validation error format
    - Malformed JSON handling
    - Non-existent endpoint (404)
    - CORS preflight (OPTIONS)

11. **Combined Parameters** (2 tests)
    - Web search with all parameters
    - News search with all parameters

12. **Response Time** (3 tests)
    - Health check < 1 second
    - Web search < 10 seconds
    - News search < 10 seconds

## MCP Client Helper

The `tests/helpers/mcp-client.ts` file provides:

### Functions

- `checkHealth()` - Verify server is running
- `getHealthData()` - Get health response data
- `listTools()` - Get available tools
- `callTool<T>(name, args)` - Call any tool with type safety

### Typed Tool Methods

```typescript
// Web search with full type safety
const result = await tools.webSearch("query", {
  count: 5,
  freshness: "24h",
  safesearch: "moderate"
});

// News search with full type safety
const result = await tools.newsSearch("query", {
  count: 10,
  freshness: "week"
});

// Raw calls for testing invalid inputs
const result = await tools.webSearchRaw({ invalidParam: true });
```

### Logging Utilities

```typescript
logSection("Test Category");  // Print section header
logInfo("Starting test");     // Print info message
logSuccess("Test passed", 123); // Print success with duration
logError("Test failed", "reason"); // Print error
```

## Adding New Tests

1. Add test data to `tests/fixtures/search-queries.ts`
2. Add test cases to the appropriate `describe` block in `tests/integration/searcher.test.ts`
3. Follow the naming convention: `X.Y description` (e.g., `2.1 should execute simple web search`)

### Example Test

```typescript
it("2.6 should handle empty results gracefully", async () => {
  const result = await tools.webSearch("xyznonexistentquery12345");
  expect(result.success).toBe(true);
  expect(result.data?.data?.results).toBeInstanceOf(Array);
});
```

## Troubleshooting

### Server not responding

```
Error: Health check failed - fetch failed
```

**Solution:** Ensure the server is running with HTTP transport:
```bash
TRANSPORT=http npm start
```

### API key errors

```
Error: BRAVE_API_KEY environment variable is required
```

**Solution:** Create a `.env` file with your Brave API key:
```
BRAVE_API_KEY=your_api_key_here
```

### Test timeouts

Tests have a 30-second timeout. If tests are timing out:
1. Check your network connection
2. Verify the Brave API is responding
3. Increase timeout in `vitest.config.ts` if needed

### Port already in use

```
Error: listen EADDRINUSE: address already in use :::8007
```

**Solution:** Either stop the existing process or use a different port:
```bash
PORT=8008 TRANSPORT=http npm start
SEARCHER_URL=http://localhost:8008 npm test
```

## Configuration

### vitest.config.ts

```typescript
export default defineConfig({
  test: {
    globals: true,           // No need to import describe/it/expect
    environment: "node",     // Node.js environment
    testTimeout: 30000,      // 30 second timeout
    hookTimeout: 30000,      // 30 second hook timeout
    fileParallelism: false,  // Run sequentially (avoid rate limiting)
    reporters: ["verbose"],  // Detailed output
  },
});
```

## CI/CD Integration

For CI/CD pipelines, ensure:

1. `BRAVE_API_KEY` is set as a secret
2. Server is started before tests run
3. Health check passes before running tests

Example GitHub Actions workflow:

```yaml
- name: Start server
  run: TRANSPORT=http npm start &
  env:
    BRAVE_API_KEY: ${{ secrets.BRAVE_API_KEY }}

- name: Wait for server
  run: sleep 5

- name: Run tests
  run: npm test
```
