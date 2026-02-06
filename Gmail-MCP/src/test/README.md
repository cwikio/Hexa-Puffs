# Tests

## Running Tests

```bash
# Mocked tests (no credentials needed, fast)
npm run test

# Watch mode
npm run test:watch

# Real API tests (requires valid OAuth token at ~/.annabelle/gmail/token.json)
npm run test:api
```

## Structure

```
src/test/
  setup.ts              # Global mocks (logger, config) loaded via vitest setupFiles
  helpers.ts            # Assertion helpers: expectSuccess, expectError, expectValidationError
  fixtures/
    gmail.ts            # Gmail API response fixtures
    calendar.ts         # Calendar API response fixtures
  tools/                # Tool handler tests (client functions mocked)
    messages.test.ts    # 8 handlers: list, get, send, reply, delete, mark_read, modify_labels, get_new
    drafts.test.ts      # 5 handlers: list, create, update, send, delete
    labels.test.ts      # 3 handlers: list, create, delete
    attachments.test.ts # 2 handlers: list, get
    calendar.test.ts    # 8 handlers: list_calendars, list/get/create/update/delete events, quick_add, find_free_time
    filters.test.ts     # 4 handlers: list, get, create, delete
  clients/              # Client function tests (googleapis mocked)
    gmail-client.test.ts
    calendar-client.test.ts
  server.test.ts        # Tool registry: all 30 tools registered, no duplicates, valid schemas
  api/                  # Real API tests (hit actual Google APIs)
    gmail.api.test.ts   # Read-only + self-cleaning Gmail tests
    calendar.api.test.ts # Self-cleaning Calendar CRUD lifecycle tests
```

## Two Test Layers

### Mocked tests (`npm run test`)

- No network, no credentials needed
- Tool handler tests mock client functions, verify input validation (Zod), field mapping (snake_case to camelCase), and error wrapping
- Client tests mock `googleapis`, verify API call construction, response parsing, and MIME encoding
- Config: `vitest.config.ts`

### Real API tests (`npm run test:api`)

- Hit actual Gmail/Calendar APIs with a real OAuth token
- Skipped automatically if no valid token is found
- Only safe operations: read-only queries and self-cleaning create/delete lifecycles
- Destructive tools (send_email, send_draft) are not tested
- Config: `vitest.api.config.ts`

## Adding New Tests

- Tool handler tests go in `src/test/tools/` and mock `../../gmail/client.js` or `../../calendar/client.js`
- Client tests go in `src/test/clients/` and mock `googleapis` + `../../gmail/auth.js`
- Real API tests go in `src/test/api/` with `*.api.test.ts` extension (excluded from `npm run test`)
- Use fixtures from `src/test/fixtures/` for consistent mock data
- `setup.ts` runs before all mocked tests (clears mocks between tests via `vi.clearAllMocks()`)
