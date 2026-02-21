---
name: test-strategy
description: >
  Decide what types of tests to write, at what coverage level, and with what
  tools. Activate when asked "what should I test", "how should I test this",
  "test strategy", "testing approach", "unit vs integration vs e2e", "test
  coverage", "should I write tests for this", "testing pyramid", or when
  planning a testing approach for a new feature or codebase.
---

## When to Activate

Use this skill when:
- User asks what kind of tests to write for a feature or module
- User needs to choose between unit, integration, or E2E tests
- User wants to establish a testing strategy for a project or feature
- User asks about test coverage targets or testing priorities
- User debates testing tradeoffs (speed vs confidence, isolation vs realism)

Do NOT use this skill when:
- User is writing specific test code (use code-quality-patterns for test patterns)
- User is debugging a failing test (use diagnostic-debugging)
- User is setting up test infrastructure in CI (use ci-cd-pipelines)

## Core Concepts

### Test Type Taxonomy

| Type | What It Tests | Speed | Confidence | Maintenance |
|------|--------------|-------|------------|-------------|
| **Unit** | Pure functions, transformations, validators | < 10ms | Low-medium (logic only) | Low |
| **Integration** | Module boundaries, DB queries, API contracts | 50-500ms | Medium-high | Medium |
| **E2E** | Full user journeys through the real UI | 5-30s | Highest | High |
| **Component** | UI component rendering and interactions | 10-100ms | Medium | Medium |
| **Snapshot** | UI doesn't change unexpectedly | < 10ms | Low | Low (but noisy) |
| **Load/Stress** | System behavior under heavy traffic | Minutes | High (for scale) | Low |

### The Testing Pyramid (Not Optional)

```text
         /  E2E  \          5-15 tests — critical user journeys
        /----------\
       / Integration \      20-50 tests — module boundaries, API contracts
      /----------------\
     /    Unit Tests     \  100+ tests — pure logic, edge cases, validators
    /______________________\
```

**CRITICAL:** If your test suite is slow, you have the pyramid inverted. Too many E2E tests and too few unit tests. Extract pure logic from impure code to make it unit-testable.

## Decision Framework

### Step 1: Classify the Code Under Test

What kind of code are you testing?

- **Pure logic** (calculation, transformation, validation, formatting) → **Unit test**
- **Database interaction** (query, mutation, transaction) → **Integration test**
- **API endpoint** (route handler, server action, webhook) → **Integration test**
- **UI component** (rendering, user interaction, state) → **Component test**
- **Critical user journey** (login → create → verify → logout) → **E2E test**
- **External service integration** (Stripe, Clerk, email) → **Integration test with mock for external**

### Step 2: Apply the Decision Matrix

| Factor | Favor Unit | Favor Integration | Favor E2E |
|--------|-----------|------------------|-----------|
| Code is pure (no I/O) | ✅ | | |
| Crosses module boundary | | ✅ | |
| Involves database | | ✅ | |
| Involves authentication | | ✅ | |
| Revenue-critical flow | | | ✅ |
| Complex UI interaction | | | ✅ |
| Edge cases are numerous | ✅ | | |
| External API involved | | ✅ (mock external) | |
| Regression risk is high | | ✅ or ✅ | ✅ |
| Speed matters most | ✅ | | |

### Step 3: Determine Coverage Strategy

Not all code deserves equal testing investment. Prioritize by risk and change frequency.

| Code Category | Coverage Target | Test Type | Rationale |
|--------------|----------------|-----------|-----------|
| Business logic (pricing, permissions, workflows) | 90%+ | Unit | Bugs here lose money or trust |
| Server actions / API routes | 80%+ | Integration | These are the system's contracts |
| Utility functions | 80%+ | Unit | Shared code, high reuse = high blast radius |
| UI components (interactive) | 60%+ | Component | Test behavior, not implementation |
| UI components (presentational) | Skip or snapshot | — | Low risk, changes often |
| E2E critical paths | 5-15 journeys | E2E | Cover what matters most to the business |
| Third-party wrappers | Skip internals | Integration | Test YOUR integration, not their library |

## Practical Guidance

### What to Test in a Server Action

```typescript
// Example: createInvoice server action
// Unit test: the validation schema (pure)
// Integration test: the full action (DB, auth, validation)

// Unit test — validation logic
describe('createInvoiceSchema', () => {
  it('rejects negative amounts', () => {
    const result = createInvoiceSchema.safeParse({ amount: -1, clientId: 'abc' })
    expect(result.success).toBe(false)
  })
})

// Integration test — full action with real DB
describe('createInvoice', () => {
  it('creates invoice for authenticated user', async () => {
    // Setup: create test user and client in DB
    const formData = new FormData()
    formData.set('amount', '100')
    formData.set('clientId', testClient.id)

    const result = await createInvoice(formData)

    expect(result.error).toBeNull()
    expect(result.data?.amount).toBe(100)
  })

  it('returns error for unauthenticated user', async () => {
    // Mock auth() to return null session
    const result = await createInvoice(formData)
    expect(result.error).toBeDefined()
  })
})
```

### What to Test in a React Component

```typescript
// Test behavior and user interaction, not implementation details
describe('InvoiceForm', () => {
  // GOOD: tests user-visible behavior
  it('shows validation error for empty amount', async () => {
    render(<InvoiceForm clients={mockClients} />)
    await userEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(screen.getByText(/amount is required/i)).toBeInTheDocument()
  })

  // BAD: tests implementation details
  it('calls setState with correct value', () => {
    // Don't test internal state management — test what the user sees
  })
})
```

### What NOT to Test

- **Framework behavior** — Does `useState` work? Does Prisma return the right type? Yes. They test it.
- **Third-party library internals** — Don't test that Zod validates correctly. Test that YOUR schema rejects what it should.
- **Exact error message strings** — Test error categories (`result.error !== null`), not exact wording.
- **Implementation details** — Don't assert that a mock was called with specific args. Assert the observable outcome.
- **Trivial getters/formatters** — A function that returns `firstName + ' ' + lastName` doesn't need a test.

## Comparison Matrix: Testing Tools

| Tool | Type | Speed | When to Use |
|------|------|-------|-------------|
| **Vitest** | Unit + Integration | Fast | Default for all non-E2E tests |
| **Playwright** | E2E | Slow | Critical user journeys, cross-browser |
| **Testing Library** | Component | Medium | React component behavior testing |
| **MSW** | Mock server | — | Mock external APIs in integration tests |
| **@faker-js/faker** | Test data | — | Generate realistic test data |
| **Docker (postgres:16-alpine)** | Test DB | — | Real database for integration tests |

## Anti-Patterns

❌ **Anti-pattern: Testing Implementation Details**
Problem: Tests assert that `onClick` handler was called, that internal state was set to a specific value, or that a specific CSS class was applied. These tests break on every refactor even when behavior is unchanged. The team spends more time updating tests than writing features.
✅ Solution: Test observable behavior. If a button click should show a success message, assert the message is visible — not that a function was called. Use Testing Library queries (`getByRole`, `getByText`) that match what users see.

❌ **Anti-pattern: 100% Coverage Target**
Problem: Mandating 100% code coverage leads to testing trivial code (getters, type guards, simple wrappers) and writing meaningless tests that assert implementation details just to hit the number. Test quality drops as quantity rises.
✅ Solution: Set coverage targets by code category (see Coverage Strategy above). Business logic at 90%+, integration points at 80%+, presentational UI components can be skipped. Measure coverage per module, not globally.

❌ **Anti-pattern: E2E-Heavy Test Suite**
Problem: 200 E2E tests, 10 unit tests. The test suite takes 45 minutes. Developers stop running tests locally. CI feedback comes too late to be useful. Flaky tests are ignored.
✅ Solution: Extract logic from E2E-tested paths into pure functions and unit-test them. Reserve E2E for 5-15 critical journeys that cannot be tested any other way. A fast test suite that runs on every save is worth more than a comprehensive suite that runs once a day.

❌ **Anti-pattern: Mocking Everything**
Problem: Every dependency is mocked. Tests pass but verify mock behavior, not real behavior. A Prisma query mock returns `{ id: '1' }` — the test passes even though the real query would fail due to a missing relation.
✅ Solution: Use real dependencies where possible. Run integration tests against a real test database (Docker PostgreSQL). Only mock what you don't control: external APIs (Stripe, Clerk) via MSW or manual mocks.

## Stack Adaptation

Before planning tests, read `tech-stack-preferences.md` for the user's actual stack. Apply these substitutions:
- **Test runner** → use Vitest from preferences for unit and integration tests
- **E2E runner** → use Playwright from preferences
- **Test database** → use PostgreSQL 16-alpine via Docker Compose on port 5433
- **Test data** → use @faker-js/faker from preferences
- **Validation testing** → test Zod schemas with safeParse (co-located with server actions)
- **Component testing** → use Testing Library with Vitest
- **ORM** → use Prisma from preferences for integration test setup/teardown

## Integration with Other Skills

- **code-quality-patterns** — For specific testing patterns, refactoring test code, and test review checklists.
- **ci-cd-pipelines** — For configuring test execution in the CI/CD pipeline (parallel jobs, test database setup, caching).
- **architecture-decisions** — When the testing strategy requires architectural changes (extracting pure logic, adding service layers for testability).
- **diagnostic-debugging** — When investigating why a test fails or is flaky.
