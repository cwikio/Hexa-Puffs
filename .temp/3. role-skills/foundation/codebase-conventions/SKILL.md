---
name: codebase-conventions
description: >
  Framework for rapidly understanding any codebase's conventions: directory
  structure, naming patterns, architectural layers, data flow, testing style,
  error handling, and unwritten rules. Activate when entering a new codebase,
  when unsure where code should go, or when asked about project structure,
  codebase conventions, naming conventions, architectural patterns, or how
  a project is organized.
---

# Codebase Conventions

A meta-skill for discovering and following any project's conventions. This is
not a skill for ONE codebase — it is a framework that teaches you how to learn
a codebase's conventions from first principles, then apply them consistently.

## When to Activate

Use this skill when:
- Entering a new codebase for the first time
- Asked "where should I put this?"
- Adding a new file, module, or feature to an existing project
- Unsure about naming, structure, or architectural boundaries
- Reviewing code for consistency with project conventions
- The user mentions "codebase conventions", "project structure", "naming convention", or "how is this organized?"

## Convention Discovery Process

Before writing any code in an unfamiliar codebase, execute this 5-step discovery process. Do not skip steps. Do not guess conventions — extract them from evidence.

### Step 1: Identify the Stack

Read the project's manifest files to determine framework, language, and tooling.

**Files to check (in order):**

| File | What it reveals |
|------|----------------|
| `package.json` | Node.js framework, dependencies, scripts, monorepo setup |
| `requirements.txt` / `pyproject.toml` / `setup.py` | Python framework, dependencies |
| `go.mod` | Go modules and dependencies |
| `Cargo.toml` | Rust crate and dependencies |
| `pom.xml` / `build.gradle` | Java/Kotlin framework |
| `tsconfig.json` | TypeScript configuration, path aliases, strictness |
| `next.config.js` / `vite.config.ts` / `webpack.config.js` | Build tool and framework variant |
| `.env.example` / `.env.local` | Environment variable patterns |
| `docker-compose.yml` / `Dockerfile` | Infrastructure and services |

**What to extract:**
- Primary language and version
- Framework name and version (critical: Next.js App Router vs Pages Router, Django vs Flask, etc.)
- ORM or database access pattern
- Test framework
- Linting and formatting tools
- Package manager (npm vs yarn vs pnpm vs bun)

### Step 2: Map Directory Structure to Architectural Layers

Run a directory listing (depth 2-3) and classify each top-level directory by its architectural purpose.

**Classification categories:**

| Category | What it contains | Examples |
|----------|-----------------|---------|
| **Entry points** | Where requests/events arrive | `src/app/`, `src/pages/`, `routes/`, `handlers/` |
| **Business logic** | Domain rules, use cases | `src/services/`, `src/domain/`, `src/use-cases/` |
| **Data access** | Database queries, external APIs | `src/repositories/`, `src/db/`, `src/api/` |
| **Shared utilities** | Pure functions, helpers, constants | `src/lib/`, `src/utils/`, `src/helpers/`, `src/common/` |
| **UI components** | Presentational elements | `src/components/`, `src/ui/`, `src/views/` |
| **Types/Contracts** | Interfaces, schemas, types | `src/types/`, `src/schemas/`, `src/contracts/` |
| **Configuration** | App config, environment | `config/`, `src/config/`, root-level dotfiles |
| **Tests** | Test suites | `tests/`, `__tests__/`, `*.test.ts` (co-located) |
| **Infrastructure** | CI/CD, Docker, IaC | `.github/`, `infra/`, `deploy/` |

**CRITICAL:** If the project uses co-located tests (test files next to source files), do not create a separate `tests/` directory. Follow whatever pattern already exists.

### Step 3: Read Existing Files to Extract Patterns

For each architectural layer identified in Step 2, read 3-5 existing files. Do not skim — read the full file and note:

1. **Import structure** — What is imported from where? Are there path aliases? Barrel exports?
2. **Export style** — Default exports vs named exports? One export per file or multiple?
3. **Function style** — Arrow functions or function declarations? Classes or plain functions?
4. **Error handling** — try/catch? Result objects? Error classes? Return `{ data, error }`?
5. **Validation** — Where and how is input validated? Zod? Joi? Manual checks?
6. **Data flow** — How does data move between layers? Props? Context? Direct imports?
7. **Async patterns** — Promises? async/await? Callbacks? Observables?
8. **Comments and documentation** — JSDoc? Inline comments? No comments?

**Record what you find.** The patterns in the existing code ARE the conventions. Even if they seem suboptimal, consistency with existing code trumps theoretical best practices.

### Step 4: Identify Naming Conventions

Examine at least 10 existing files across different directories. Fill in this table:

| Element | Convention | Evidence |
|---------|-----------|----------|
| File names | `{{kebab-case / camelCase / PascalCase / snake_case}}` | `{{3+ example files}}` |
| Directory names | `{{convention}}` | `{{3+ example dirs}}` |
| Functions | `{{convention}}` | `{{3+ example functions}}` |
| Classes / Types | `{{convention}}` | `{{3+ example types}}` |
| Constants | `{{convention}}` | `{{3+ example constants}}` |
| React components | `{{convention}}` | `{{3+ example components}}` |
| Database tables | `{{convention}}` | `{{from schema/migration files}}` |
| API routes | `{{convention}}` | `{{from route files}}` |
| Test files | `{{convention}}` | `{{3+ example test files}}` |
| Branch names | `{{convention}}` | `{{from git log or CONTRIBUTING.md}}` |
| Commit messages | `{{convention}}` | `{{from recent git history}}` |

**IMPORTANT:** If you find inconsistencies across the codebase, follow the convention used by the MAJORITY of recent files (last 6 months of git history). If genuinely split, ask the user which convention to follow.

### Step 5: Check for Explicit Rules

Many projects encode conventions in configuration files. Check for:

| File | What it enforces |
|------|-----------------|
| `CLAUDE.md` / `.claude/CLAUDE.md` | AI-specific instructions — these OVERRIDE all other conventions |
| `CONTRIBUTING.md` | Human-written development guidelines |
| `.eslintrc` / `eslint.config.js` | Code style, import rules, naming conventions |
| `.prettierrc` | Formatting conventions |
| `tsconfig.json` strict settings | Type safety expectations |
| `.editorconfig` | Indentation, line endings, file encoding |
| `.github/CODEOWNERS` | Who owns which directories |
| `Makefile` / `justfile` | Common development commands |
| Pre-commit hooks (`.husky/`, `.pre-commit-config.yaml`) | What's validated before commit |

**CRITICAL:** If a `CLAUDE.md` file exists, read it FIRST. Its instructions take absolute precedence over patterns discovered through code analysis.

---

## Where Does X Go? (Template)

After completing the discovery process, construct this routing table for the specific project. This is the single most valuable artifact of the process.

| When you need to... | Put it in... | Follow this pattern... |
|---------------------|-------------|----------------------|
| Add a new API endpoint | `{{discovered location}}` | `{{copy nearest existing endpoint}}` |
| Add business logic | `{{discovered location}}` | `{{match existing service/use-case style}}` |
| Add a database query | `{{discovered location}}` | `{{use the project's ORM/query pattern}}` |
| Add a shared utility | `{{discovered location}}` | `{{pure function, match existing utils}}` |
| Add a UI component | `{{discovered location}}` | `{{match existing component structure}}` |
| Add a type/interface | `{{discovered location}}` | `{{match existing type organization}}` |
| Add a test | `{{discovered location}}` | `{{mirror existing test structure}}` |
| Add configuration | `{{discovered location}}` | `{{follow existing config pattern}}` |
| Add a migration | `{{discovered location}}` | `{{use the project's migration tool}}` |
| Add middleware | `{{discovered location}}` | `{{match existing middleware chain}}` |
| Add error handling | `{{discovered location}}` | `{{use project's error pattern}}` |
| Add logging | `{{discovered location}}` | `{{use project's logging pattern}}` |

**How to fill this table:** For each row, find the nearest existing example in the codebase. Copy its location and pattern. Never invent a new location or pattern when an existing one covers the case.

---

## Convention Discovery Checklist

Run through this checklist when entering any new codebase. Check each item before writing code.

### Architecture
- [ ] Identified all architectural layers and their boundaries
- [ ] Mapped the dependency direction (which layer imports from which)
- [ ] Found the entry point(s) — where do requests/events arrive?
- [ ] Identified the data flow — how does data move from input to storage?
- [ ] Checked for background workers, queues, or async processes

### Code Organization
- [ ] Determined whether tests are co-located or in a separate directory
- [ ] Found how related files are grouped (by feature? by type? by layer?)
- [ ] Identified barrel files / index exports (if used)
- [ ] Checked for a monorepo structure (packages/, apps/)

### Patterns
- [ ] Read 3+ examples of error handling — identified the project's pattern
- [ ] Read 3+ examples of data validation — identified where and how
- [ ] Read 3+ examples of data fetching — server-side, client-side, or both?
- [ ] Read 3+ test files — identified testing conventions
- [ ] Checked recent git commits for commit message format
- [ ] Identified the project's logging approach

### Configuration
- [ ] Found all environment variable patterns
- [ ] Identified how secrets are managed
- [ ] Checked for multiple deployment environments
- [ ] Found the CI/CD configuration

### Documentation
- [ ] Checked for CLAUDE.md (AI-specific instructions)
- [ ] Checked for CONTRIBUTING.md
- [ ] Checked for ADRs (Architecture Decision Records)
- [ ] Checked for inline documentation conventions

---

## Code Pattern Recognition

### Error Handling Styles

Projects typically follow ONE of these error handling patterns. Identify which one and match it.

**Style A: Thrown errors with try/catch**
```typescript
// Service throws, caller catches
async function getUser(id: string): Promise<User> {
  const user = await db.user.findUnique({ where: { id } })
  if (!user) throw new NotFoundError('User not found')
  return user
}
```

**Style B: Result objects (never throw)**
```typescript
// Returns { data, error } — caller checks
async function getUser(id: string): Promise<{ data: User | null; error: string | null }> {
  const user = await db.user.findUnique({ where: { id } })
  if (!user) return { data: null, error: 'User not found' }
  return { data: user, error: null }
}
```

**Style C: Domain error classes** -- Custom error hierarchy with codes and HTTP status metadata.

**Identify which style the project uses and follow it exactly.** Mixing styles within a project is worse than using a "suboptimal" style consistently.

### Other Patterns to Identify

- **Data fetching:** Server-first (RSC/SSR, data as props)? Client-first (SWR, React Query, useEffect)? Hybrid?
- **Testing:** AAA (Arrange-Act-Assert)? Given-When-Then? Fixture-based or inline test data?

---

## Concrete Example: Discovering a Next.js App Router Project

This illustrates the discovery process applied to a real-world stack. Use this as a reference when running discovery on similar projects.

### Step 1 Result: Stack Identification

After reading `package.json` and config files:
- **Framework:** Next.js 15, App Router
- **Language:** TypeScript (strict)
- **ORM:** Prisma
- **Auth:** Clerk
- **Validation:** Zod
- **Testing:** Vitest + Playwright
- **Styling:** Tailwind CSS + shadcn/ui

### Step 2 Result: Directory Mapping

```
src/
  app/              → Entry points (routes, layouts, pages)
    api/            → API routes (webhooks, external integrations)
    (auth)/         → Route groups for auth pages
    (dashboard)/    → Route groups for authenticated pages
  components/       → UI components (shared across pages)
    ui/             → shadcn/ui primitives
  lib/              → Shared utilities (db client, auth helpers)
  server/           → Server-side business logic
    actions/        → Server Actions (mutations)
    queries/        → Data fetching functions
  types/            → Shared TypeScript types
prisma/
  schema.prisma     → Database schema
  migrations/       → Database migrations
```

### Step 3 Result: Pattern Extraction

Reading 3 server action files reveals:
- All actions use Zod `safeParse` for validation
- All actions return `{ data, error }` result objects
- Schema is defined in the same file as the action
- Auth check is the first line of every action

Reading 3 component files reveals:
- Components use named exports
- Props interfaces are defined inline above the component
- "use client" directive is explicit — most components are server components
- Styling is Tailwind utility classes, no CSS modules

### Step 4 Result: Naming Conventions

| Element | Convention | Evidence |
|---------|-----------|----------|
| Files | kebab-case | `user-profile.tsx`, `create-invoice.ts` |
| Components | PascalCase function name, kebab-case file | `export function UserProfile()` in `user-profile.tsx` |
| Server actions | camelCase | `createInvoice`, `updateUserProfile` |
| Types | PascalCase | `Invoice`, `CreateInvoiceInput` |
| Database tables | snake_case plural | `user_accounts`, `invoice_items` |
| API routes | kebab-case | `/api/webhook/stripe`, `/api/export/pdf` |

### Step 5 Result: Explicit Rules

Found `CLAUDE.md` with instructions:
- Always run `npx tsc --noEmit` after TypeScript changes
- Prefer server-side data fetching in `page.tsx`
- Validate server action inputs with Zod `safeParse`
- Do not install packages without asking

### Constructed Routing Table

| When you need to... | Put it in... | Follow this pattern... |
|---------------------|-------------|----------------------|
| Add a page | `src/app/(dashboard)/[route]/page.tsx` | Server component, fetch data inline, pass to client components |
| Add a server action | `src/server/actions/[domain].ts` | Zod schema + `safeParse` + auth check + return `{ data, error }` |
| Add a data query | `src/server/queries/[domain].ts` | Async function, Prisma query, return typed result |
| Add a UI component | `src/components/[name].tsx` | Named export, inline props interface, Tailwind styling |
| Add a shadcn component | `src/components/ui/[name].tsx` | Use `npx shadcn-ui add [name]` CLI |
| Add a shared utility | `src/lib/[name].ts` | Pure function, no side effects, add to barrel export |
| Add an API route | `src/app/api/[resource]/route.ts` | Export named handlers (GET, POST), for webhooks/external only |
| Add a database migration | `prisma/migrations/` | `npx prisma migrate dev --name descriptive_name` |
| Add a type | `src/types/[domain].ts` | PascalCase, export interface/type |
| Add a test | Next to source file: `[name].test.ts` | Vitest, describe/it, mock external deps |

---

## Project-Specific Gotchas: How to Find Them

Gotchas are the highest-value conventions because they prevent mistakes that waste hours. Here is how to find them in any codebase:

**Check git history for reverted commits:**
Reverted commits often indicate mistakes that looked correct but broke something. The revert message usually explains what went wrong.

**Check CI/CD failures:**
Look at recent failed pipeline runs. Common failures reveal constraints that are not obvious from code alone (e.g., "tests fail if DATABASE_URL is not set").

**Check for unusual WHERE clauses:**
Soft deletes, tenant isolation, feature flags — these create hidden filters that every query must include. Search for `deleted_at`, `tenant_id`, `is_active` patterns.

**Check environment-specific behavior:**
Look for `process.env.NODE_ENV` checks, feature flags, and environment-conditional code. These indicate behavior that differs between dev and prod.

**Check middleware ordering:**
In frameworks with middleware chains (Express, Next.js), the order matters. Auth before body parsing? Rate limiting before auth? Read the middleware setup carefully.

**Check for "magic" configuration:**
Framework-specific files that silently change behavior: `next.config.js` rewrites, `tsconfig.json` path aliases, `.env` variable naming prefixes (`NEXT_PUBLIC_`).

---

## Stack Adaptation

Before applying conventions, read `tech-stack-preferences.md` for the user's declared stack choices. When the user's preferences file exists, apply these adaptations:

- **ORM commands** -- use the ORM from preferences (Prisma, Drizzle, TypeORM, etc.)
- **Test framework** -- use the test runner from preferences (Vitest, Jest, pytest, etc.)
- **Validation** -- use the validation library from preferences (Zod, Joi, Yup, etc.)
- **Naming conventions** -- use the naming style from preferences (kebab-case, camelCase, etc.)
- **Error handling** -- use the error pattern from preferences (result objects, thrown errors, etc.)

If `tech-stack-preferences.md` specifies a convention and the current codebase uses something different, **follow the current codebase**. The preferences file is a default; the actual code is the authority.

---

## Do NOT

These are universal anti-patterns for codebase convention adherence. They apply regardless of the project, framework, or language.

**Never invent new patterns when existing ones cover the case.**
If the project has 47 service files that all follow the same structure, your 48th service must follow the same structure. Even if you know a "better" way.

**Never place files in locations that break the established directory convention.**
If API routes live in `src/app/api/`, do not create one in `src/routes/` because "it makes more sense." Follow the existing structure.

**Never mix naming conventions within the same category.**
If files are kebab-case, every new file is kebab-case. Do not introduce camelCase files because "they are utilities."

**Never violate layer boundaries.**
If the project separates routes from services from repositories, do not write business logic in a route handler or database queries in a service. Find the right layer and put the code there.

**Never ignore the project's error handling pattern.**
If the project returns `{ data, error }` objects, do not throw exceptions. If the project throws domain errors, do not return result objects. Consistency is mandatory.

**Never skip validation at the project's established validation boundary.**
If every server action validates with Zod, yours must too. If every API route checks auth first, yours must too.

**Never assume conventions from a different project apply here.**
Each codebase is its own authority. Conventions learned from Project A do not transfer to Project B unless the code confirms they match.

**Never create documentation files (README, CONTRIBUTING) without being asked.**
Focus on writing code that follows conventions, not documenting conventions you just discovered.

---

## Resolving Convention Conflicts

When you encounter conflicting signals:

1. **CLAUDE.md > CONTRIBUTING.md > linter rules > code patterns** -- This is the precedence order. Explicit instructions override implicit patterns.

2. **Recent code > old code** -- If older files use one pattern and newer files use another, follow the newer pattern (check git blame to determine age).

3. **Majority > minority** -- If 80% of files follow Pattern A and 20% follow Pattern B, follow Pattern A. The minority likely represents legacy code or exceptions.

4. **When genuinely ambiguous, ask.** Do not guess. State what you found: "I see two patterns for error handling in this project: X in services/ and Y in routes/. Which should I follow for this new code?"
