---
name: code-quality-patterns
description: >
  Use this skill when working on code quality, code review, refactoring,
  testing patterns, clean code, maintainability, or technical debt reduction.
  Triggers on: writing or reviewing tests, refactoring modules, conducting
  code reviews, improving error handling, applying SOLID principles,
  decomposing functions, naming decisions, or assessing code health.
---

# Code Quality Patterns

Progressive-depth guide to writing maintainable, testable, reviewable code. Covers testing strategy, refactoring patterns, code review, error handling, naming, decomposition, and dependency management.

Every principle here is prescriptive. Not "consider doing X" — do X.

## Quick Reference

| Task | Guide |
|------|-------|
| Review a PR | [Code Review Checklist](#code-review-checklist) |
| Refactor a module | [Refactoring Patterns](#refactoring-patterns) |
| Add tests | [Testing Strategy](#testing-strategy) |
| Improve error handling | [Error Handling](#principle-3-error-handling) |
| Decompose a large function | [Function Design](#principle-4-function-design) |
| Fix naming | [Naming](#principle-6-naming) |
| Assess code health | [Quality Assurance](#quality-assurance) |
| Deep-dive on any topic | `references/` files |

---

## Reading the Codebase

Before changing anything, understand what exists.

1. **Map the dependency graph.** Which modules import from which? Draw the arrows. If arrows point in multiple directions between two modules, you have a coupling problem.

2. **Identify the hot paths.** Use `git log --format='%H' --since='3 months ago' | head -20 | xargs -I{} git diff-tree --no-commit-id --name-only -r {} | sort | uniq -c | sort -rn | head -20` to find files changed most often. High-churn files deserve the most quality investment.

3. **Read tests first.** Tests document intent better than comments. If a module has no tests, flag it — you are about to add them.

---

## Testing Strategy

For deeper coverage patterns and test architecture, see `references/testing-deep-dive.md`.

### The Testing Pyramid (What to Test at Each Level)

```text
         /  E2E  \          Few — critical user journeys only
        /----------\
       / Integration \      Moderate — module boundaries, API contracts
      /----------------\
     /    Unit Tests     \  Many — pure logic, edge cases, transformations
    /______________________\
```

**Unit tests** — Test pure functions, data transformations, validators, utilities. No I/O, no network, no database. Fast, deterministic, many.

```typescript
// GOOD unit test: pure function, clear input/output
describe("calculateDiscount", () => {
  it("applies percentage discount to subtotal", () => {
    const result = calculateDiscount({ subtotal: 100, discountPercent: 15 });
    expect(result).toEqual({ discounted: 85, savings: 15 });
  });

  it("clamps discount to zero floor", () => {
    const result = calculateDiscount({ subtotal: 10, discountPercent: 150 });
    expect(result).toEqual({ discounted: 0, savings: 10 });
  });
});
```

**Integration tests** — Test module boundaries: database queries return expected shapes, API routes handle auth and validation, server actions compose correctly. Use real database (test container), real middleware.

```typescript
// GOOD integration test: real database, real validation
describe("POST /api/users", () => {
  it("rejects invalid email with 400", async () => {
    const res = await app.request("/api/users", {
      method: "POST",
      body: JSON.stringify({ email: "not-an-email", name: "Test" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});
```

**E2E tests** — Test critical user journeys only. Login -> create resource -> verify resource appears. Keep the count under 20 for most projects. These are slow and brittle; invest sparingly.

### What NOT to Test

- Private implementation details (internal helper functions accessed only by the module)
- Framework behavior (does `useState` work? yes, React tested it)
- Exact error message strings (test error categories, not wording)
- Third-party library internals

---

## Refactoring Patterns

For the full refactoring catalog with before/after examples, see `references/refactoring-catalog.md`.

### When to Refactor

Refactor when you observe any of these signals:
- A function exceeds 30 lines
- A module has more than 5 direct dependencies
- The same 3+ lines appear in 2+ places
- A change requires editing 3+ files (shotgun surgery)
- You cannot name what a function does in one short sentence

### How to Refactor Safely

1. **Write a characterization test first.** Capture the current behavior, even if that behavior is wrong. The test proves your refactor does not change behavior.

2. **Make one structural change at a time.** Extract function, then rename, then move — never all at once.

3. **Run tests after every change.** If tests fail, revert and try a smaller step.

```typescript
// BEFORE: 45-line function doing validation + transformation + persistence
async function processOrder(raw: unknown) {
  // validation mixed with transformation mixed with DB calls...
}

// AFTER: decomposed into focused functions
async function processOrder(raw: unknown) {
  const input = validateOrderInput(raw);    // pure validation
  if (!input.success) return { error: input.error };

  const order = buildOrder(input.data);     // pure transformation
  return await saveOrder(order);            // isolated side effect
}
```

### Key Refactoring Moves

| Smell | Refactoring | Result |
|-------|-------------|--------|
| Long function | Extract Function | Each function fits on one screen |
| Duplicated logic | Extract + Parameterize | Single source of truth |
| Deep nesting | Replace Nested Conditions with Guard Clauses | Flat, readable flow |
| Data clumps | Introduce Parameter Object | Grouped, typed data |
| Feature envy | Move Function to where the data lives | Cohesion improves |
| Shotgun surgery | Move related code into one module | Changes stay local |

---

## Code Review Checklist

Use this checklist when reviewing any pull request.

### Correctness
- [ ] Does the code handle edge cases? (empty arrays, null, zero, negative, boundary values)
- [ ] Are error paths handled, not just the happy path?
- [ ] Are race conditions possible? (async operations, shared state)
- [ ] Does the code match the stated intent of the PR description?

### Maintainability
- [ ] Can you understand the code without reading the PR description?
- [ ] Are names descriptive? (no `data`, `temp`, `result`, `x` for anything important)
- [ ] Are functions small enough to understand in one reading? (<30 lines)
- [ ] Is there duplicated logic that should be extracted?

### Performance & Security
- [ ] Are there N+1 query patterns? (loop calling DB per item)
- [ ] Is user input validated before use?
- [ ] Are secrets kept out of client bundles?
- [ ] Are expensive operations memoized or cached where appropriate?

### Testing
- [ ] Are new behaviors covered by tests?
- [ ] Do tests verify behavior, not implementation details?
- [ ] Are edge cases tested? (not just the happy path)

---

## Design Principles

### Principle 1: Testing Pyramid Balance

Write many unit tests, moderate integration tests, few E2E tests. If your test suite is slow, you have too many integration/E2E tests and too few unit tests. Extract pure logic from impure code to make it unit-testable.

**CRITICAL:** Never mock what you own. If you need to mock your own module to test another, your modules are too tightly coupled. Refactor the boundary instead.

### Principle 2: Immutability Preference

Default to immutable data. Use `const`, `readonly`, `Readonly<T>`, `as const`. Create new objects instead of mutating existing ones. Mutations are the #1 source of "it works in isolation but breaks in production" bugs.

```typescript
// BAD: mutation hides state changes
function addDiscount(order: Order, discount: number) {
  order.total -= discount;  // caller's object is now modified
  return order;
}

// GOOD: new object, original untouched
function addDiscount(order: Order, discount: number): Order {
  return { ...order, total: order.total - discount };
}
```

### Principle 3: Error Handling

Return structured results, do not throw for expected failures. Exceptions are for programmer errors (bugs), not for business logic failures (invalid input, not found, unauthorized).

```typescript
// BAD: throwing for expected business cases
async function getUser(id: string): Promise<User> {
  const user = await db.user.findUnique({ where: { id } });
  if (!user) throw new Error("User not found");  // caller must try/catch
  return user;
}

// GOOD: structured result for expected failures
type Result<T> = { data: T; error: null } | { data: null; error: string };

async function getUser(id: string): Promise<Result<User>> {
  const user = await db.user.findUnique({ where: { id } });
  if (!user) return { data: null, error: "User not found" };
  return { data: user, error: null };
}
```

**When to throw:** Violations of invariants that should never happen in correct code — corrupted data, missing environment variables at startup, assertion failures.

### Principle 4: Function Design

A function does one thing. If you describe it with "and," split it. Maximum 30 lines, maximum 3 parameters. If a function needs more, introduce an options object.

```typescript
// BAD: 5 positional parameters, unclear at call site
function createUser(name: string, email: string, role: string, notify: boolean, trial: boolean)

// GOOD: options object for 3+ parameters
function createUser(options: CreateUserOptions): Result<User>

interface CreateUserOptions {
  name: string;
  email: string;
  role: UserRole;
  sendWelcomeEmail: boolean;
  startFreeTrial: boolean;
}
```

### Principle 5: Module Boundaries (Cohesion & Coupling)

A module groups code that changes together. If changing feature X requires editing modules A, B, and C, those are not properly bounded. High cohesion (related code together), low coupling (minimal cross-module dependencies).

**Rule:** Every module should have a clear public API (exported functions/types) and hidden internals. If an internal leaks out, you have a boundary violation.

```typescript
// orders/index.ts — public API
export { createOrder } from "./create-order";
export { cancelOrder } from "./cancel-order";
export type { Order, OrderStatus } from "./types";

// orders/validate-line-items.ts — internal, NOT exported from index
// This is an implementation detail of createOrder
```

### Principle 6: Naming

Names are the primary documentation. Choose clarity over brevity. A reader should understand purpose without navigating to the definition.

| Bad | Good | Why |
|-----|------|-----|
| `data` | `userProfiles` | What data? |
| `handle()` | `retryFailedPayment()` | Handle what? |
| `flag` | `isEligibleForDiscount` | Which flag? |
| `process()` | `normalizeAddress()` | Process how? |
| `utils.ts` | `date-formatting.ts` | Utils is a junk drawer |
| `temp` | `pendingInvitations` | Temp until when? |

**Boolean naming:** Always phrase as a yes/no question. `isActive`, `hasPermission`, `canRetry`, `shouldNotify`. Never bare adjectives (`active`, `ready`).

### Principle 7: Code Comments

Comment WHY, never WHAT. The code says what. If the code is too unclear to understand without a "what" comment, rewrite the code.

```typescript
// BAD: restates the code
// Increment counter by one
counter += 1;

// GOOD: explains non-obvious business reason
// Retry count resets on success per SLA §4.2 — customers expect
// at most 3 consecutive failures before escalation
retryCount = 0;
```

**When comments are required:**
- Workarounds for known bugs in dependencies (link to issue)
- Non-obvious performance optimizations (why this approach is faster)
- Business rules that contradict intuition (link to spec or ticket)
- Regex patterns (always explain what they match)

### Principle 8: Dependency Direction

Dependencies point inward. Domain logic depends on nothing. Application logic depends on domain. Infrastructure depends on application. Never the reverse.

```text
Infrastructure (DB, HTTP, UI) → Application (use cases) → Domain (entities, rules)
```

**CRITICAL:** Domain types never import from infrastructure. If your `Order` type imports from `prisma/client`, your dependency direction is inverted. Define domain types independently, map at the boundary.

---

## What to Avoid

### Anti-Pattern: God Object

A single class or module that knows everything and does everything.

| | Example |
|---|---|
| ❌ | `AppManager` with 2000 lines handling auth, payments, notifications, and user preferences |
| ✅ | Separate `AuthService`, `PaymentProcessor`, `NotificationSender`, `UserPreferences` — each under 200 lines |

### Anti-Pattern: Shotgun Surgery

A single change requires editing 5+ files across unrelated modules.

| | Example |
|---|---|
| ❌ | Adding a new user field requires changes in `api/users.ts`, `components/UserCard.tsx`, `utils/format.ts`, `types/global.d.ts`, `tests/helpers.ts` |
| ✅ | Adding a new user field requires changes in `features/users/types.ts` and `features/users/user-card.tsx` — co-located code |

### Anti-Pattern: Primitive Obsession

Using raw strings, numbers, and booleans where a domain type would prevent bugs.

| | Example |
|---|---|
| ❌ | `function sendEmail(to: string, subject: string, body: string, priority: number)` — what is priority 3? Can `to` be any string? |
| ✅ | `function sendEmail(options: { to: EmailAddress; subject: string; body: HtmlString; priority: EmailPriority })` — types enforce constraints |

### Anti-Pattern: Test Double Overuse

Mocking everything until your tests verify mock behavior, not real behavior.

| | Example |
|---|---|
| ❌ | Mocking the database, the validator, the transformer, and the logger — then asserting `mockValidator.validate` was called with specific args |
| ✅ | Testing with a real test database, real validator. Only mock external services you do not control (Stripe API, email provider) |

### Anti-Pattern: Boolean Blindness

Functions that take multiple booleans, making call sites unreadable.

| | Example |
|---|---|
| ❌ | `createUser("Alice", true, false, true)` — what do these booleans mean? |
| ✅ | `createUser({ name: "Alice", isAdmin: true, sendWelcome: false, startTrial: true })` — self-documenting |

---

## Quality Assurance

**After completing any code change, run this checklist:**

- [ ] All existing tests pass (`npx vitest run` or equivalent)
- [ ] New behavior has tests covering happy path AND at least one edge case
- [ ] No function exceeds 30 lines
- [ ] No module has more than 5 direct imports from other project modules
- [ ] Error handling uses structured results, not thrown exceptions (for expected failures)
- [ ] Names are specific — no `data`, `temp`, `utils`, `handle`, `process` without qualification
- [ ] No `any` types introduced (use `unknown` and narrow)
- [ ] No commented-out code committed
- [ ] TypeScript compiles without errors (`npx tsc --noEmit`)
- [ ] Dependency direction is correct (domain does not import from infrastructure)

**Verification method:**

```bash
# Run type check
npx tsc --noEmit

# Run tests
npx vitest run

# Check for common smells
# Long files (>300 lines)
find src -name '*.ts' -o -name '*.tsx' | xargs wc -l | sort -rn | head -20

# Any types
grep -rn ': any' src/ --include='*.ts' --include='*.tsx' | grep -v node_modules
```

---

## Stack Adaptation

Before applying these patterns, read `tech-stack-preferences.md` for the user's actual stack. Apply these substitutions:

- **Test runner** -> use the test framework from preferences (default: Vitest)
- **Type checking** -> `npx tsc --noEmit` for TypeScript projects
- **Error handling pattern** -> use `{ data, error }` return style if preferences specify it
- **Validation** -> use the validation library from preferences (default: Zod with `safeParse`)
- **ORM/DB** -> use the ORM from preferences when writing integration test examples
- **Linter** -> use the linting tool from preferences for automated quality checks

---

## Dependencies

- No external dependencies required — this skill is framework-agnostic guidance
- Works with any test runner, linter, or type checker listed in `tech-stack-preferences.md`
- Reference files in `references/` provide stack-specific depth
