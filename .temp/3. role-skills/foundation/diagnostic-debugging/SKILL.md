---
name: diagnostic-debugging
description: >
  Systematic diagnosis and resolution of software issues. Activate when a user
  reports an error, unexpected behavior, build failure, performance degradation,
  data inconsistency, authentication problem, or deployment failure. Also use
  when asked to "debug this", "why is this broken", "fix this error",
  "troubleshoot", "diagnose", or "figure out what's wrong". Covers runtime
  errors, TypeScript/build failures, database issues, API failures, auth
  problems, and infrastructure incidents.
---

## When to Activate

Use this skill when:
- User reports an error message, stack trace, or unexpected behavior
- User says "debug", "troubleshoot", "diagnose", "fix this", "why is this broken"
- Build, deploy, or CI pipeline fails
- Performance degrades unexpectedly
- Data appears inconsistent or missing
- Authentication or authorization fails

Do NOT use this skill when:
- User is choosing between architectural approaches (use architecture-decisions)
- User wants a code review without a specific bug (use code-quality-patterns)
- User needs to set up CI/CD from scratch (use ci-cd-pipelines)
- User is assessing tech debt broadly (use tech-debt-assessment)

## Symptom Quick Reference

| Symptom | Likely Cause(s) | Start Here |
|---------|----------------|------------|
| 500 / runtime crash | Unhandled exception, null reference, DB connection | [Server Errors](#server-errors) |
| TypeScript / build error | Type mismatch, missing import, config issue | [Build Failures](#build-failures) |
| Slow response (>2s) | N+1 query, missing index, large payload, cold start | [Performance](#performance-issues) |
| Auth failure / 401 / 403 | Token expired, middleware misconfigured, CORS | [Auth Issues](#auth-issues) |
| Data missing or wrong | Race condition, failed migration, stale cache | [Data Issues](#data-issues) |
| Deploy failure | Env var missing, build error, dependency conflict | [Deploy Issues](#deploy-issues) |
| Webhook not firing | Endpoint unreachable, signature mismatch, timeout | [Webhook Issues](#webhook-issues) |

## Diagnostic Methodology

**CRITICAL:** Always follow this sequence. Do NOT jump to fixes before completing investigation.

1. **Reproduce** — Can you trigger the issue consistently? Get exact steps, input data, and environment.
2. **Isolate** — When did it start? What changed? Check recent commits, deploys, config changes, dependency updates.
3. **Gather evidence** — Collect logs, error messages, stack traces, network responses. Use the [Investigation Toolkit](#investigation-toolkit).
4. **Form hypothesis** — Based on evidence, what is the most likely cause? Use the diagnostic trees below.
5. **Test hypothesis** — Run the minimal test that confirms or eliminates the hypothesis.
6. **Fix** — Apply the targeted fix. Reference the [Root Cause → Fix Map](#root-cause--fix-map).
7. **Verify** — Confirm the fix resolves the original symptom AND does not introduce new issues.
8. **Prevent** — Add a guard (test, type check, monitoring) that prevents recurrence.

## Investigation Toolkit

### Log Analysis

```bash
# Vercel deployment logs
vercel logs --follow

# Next.js server-side logs (dev)
# Check terminal running `next dev` — server component errors appear here, not browser

# Prisma query logging — add to prisma client instantiation
# log: ['query', 'error', 'warn']

# Filter git history for recent changes to a problem file
git log --oneline --since="3 days ago" -- path/to/file.ts
```

### Database Diagnostics

```bash
# Check Prisma migration status
npx prisma migrate status

# Open Prisma Studio to inspect data
npx prisma studio

# Validate schema matches database
npx prisma validate

# Check for pending migrations
npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma
```

### TypeScript Diagnostics

```bash
# Full type check (catches errors that IDE may miss)
npx tsc --noEmit

# Type check with verbose output for tracing inference issues
npx tsc --noEmit --extendedDiagnostics

# Check specific file
npx tsc --noEmit path/to/file.ts
```

### Network / API Diagnostics

```bash
# Test API route locally
curl -v http://localhost:3000/api/your-route

# Check response headers (CORS, auth, caching)
curl -I https://your-app.vercel.app/api/your-route

# Test webhook endpoint with sample payload
curl -X POST http://localhost:3000/api/webhook/stripe \
  -H "Content-Type: application/json" \
  -d '{"type": "test"}'
```

## Diagnostic Trees

### Server Errors

```
Symptom: 500 error or runtime crash
│
├─ Is it happening on ALL requests?
│  ├─ YES → Check: Is the database accessible?
│  │        ├─ NO → Verify DATABASE_URL, check DB host status, connection pool
│  │        └─ YES → Check: Did a recent deploy change env vars?
│  │                 ├─ YES → Compare env vars between working and broken deploy
│  │                 └─ NO → Check Vercel function logs for unhandled exception
│  │
│  └─ NO → Is it specific endpoints?
│           ├─ YES → Check: What is unique about those endpoints?
│           │        ├─ Database query → Run EXPLAIN ANALYZE, check for null handling
│           │        ├─ External API call → Check third-party service status
│           │        ├─ File processing → Check input validation, memory limits
│           │        └─ Auth-protected → Check Clerk middleware, session validity
│           └─ NO (intermittent) → Check:
│                    ├─ Correlated with load? → Connection pool exhaustion
│                    ├─ Time-based? → Cron job conflict, rate limit
│                    └─ Data-dependent? → Specific input triggers null/undefined path
```

### Build Failures

```
Symptom: TypeScript or build error
│
├─ Is it a type error?
│  ├─ YES → Check: Is the type from your code or a dependency?
│  │        ├─ Your code → Read the full error: which types are incompatible?
│  │        │  ├─ Null/undefined → Add null check or use optional chaining
│  │        │  ├─ Property missing → Check interface definition, recent changes
│  │        │  └─ Generic mismatch → Check type parameters at call site
│  │        └─ Dependency → Check: Did you update a package?
│  │                 ├─ YES → Check changelog for breaking type changes
│  │                 └─ NO → Run `npm ls <package>` for version conflicts
│  │
│  └─ NO → Is it a module/import error?
│           ├─ Cannot find module → Check path, tsconfig paths, package installed
│           ├─ Not a module → Check file exports, tsconfig moduleResolution
│           └─ Circular dependency → Map import chain, extract shared types
```

### Auth Issues

```
Symptom: 401, 403, or silent auth failure
│
├─ Is the user signed in (Clerk session exists)?
│  ├─ NO → Check: Is Clerk middleware running?
│  │        ├─ middleware.ts exists and exports? → Check matcher patterns
│  │        └─ Missing → Create middleware.ts with Clerk authMiddleware
│  │
│  └─ YES → Is the token reaching the server?
│           ├─ NO → Check: CORS headers, cookie settings, NEXT_PUBLIC_CLERK_* env vars
│           └─ YES → Check: Is the route checking auth correctly?
│                    ├─ Server Action → Using auth() from @clerk/nextjs/server?
│                    ├─ API route → Using getAuth(req)?
│                    └─ Server Component → Using currentUser() or auth()?
```

### Performance Issues

```
Symptom: Response time > 2s
│
├─ Is it ALL pages/endpoints or SPECIFIC ones?
│  ├─ ALL → Check: Vercel cold start? Database latency? DNS resolution?
│  │        ├─ First request slow, subsequent fast → Cold start. Check function size.
│  │        ├─ All requests slow → Database connection. Check pool size, region.
│  │        └─ Intermittent → Check rate limiting, third-party dependencies
│  │
│  └─ SPECIFIC → Check the slow endpoint:
│     ├─ Has database queries?
│     │  ├─ Run with Prisma logging → Count queries per request
│     │  │  ├─ Many queries (N+1) → Add include/select for eager loading
│     │  │  ├─ Single slow query → Add index on filtered/sorted columns
│     │  │  └─ Large result set → Add pagination, select only needed fields
│     │  └─ No DB queries → Check for:
│     │           ├─ External API calls → Cache responses, add timeout
│     │           ├─ Heavy computation → Move to background job (Inngest)
│     │           └─ Large response → Compress, paginate, or stream
```

### Data Issues

```
Symptom: Data missing, wrong, or inconsistent
│
├─ Was data ever correct?
│  ├─ YES → When did it break?
│  │        ├─ After migration → Check migration for data-altering steps
│  │        ├─ After deploy → Check for schema/code mismatch
│  │        └─ Gradually → Race condition or concurrent write conflict
│  │
│  └─ NO (never correct) → Check:
│           ├─ Schema mismatch → Run `npx prisma validate`, compare schema to DB
│           ├─ Seed data wrong → Check seed script, re-run `npx prisma db seed`
│           └─ Environment → Wrong DATABASE_URL (dev vs prod vs test)
```

## Root Cause → Fix Map

| Root Cause | Fix | Verify With | Prevention |
|------------|-----|------------|------------|
| Missing null check | Add guard clause or optional chaining | Reproduce original error — should not throw | Add unit test for null case |
| N+1 query | Add `include` or `select` in Prisma query | Enable query logging, count should drop to 1-2 | Add query count assertion in integration test |
| Missing database index | Add `@@index` in Prisma schema, run migration | Query time drops (check with Prisma logging) | Review query patterns in PR reviews |
| Stale Prisma client | Run `npx prisma generate` after schema change | Type errors resolve, queries match schema | Add `prisma generate` to post-install script |
| Missing env var | Add to `.env.local` and Vercel project settings | App starts without error | Add env var check at startup |
| Clerk middleware misconfigured | Fix matcher pattern in `middleware.ts` | Auth-protected routes return 401 for unauthenticated | Add integration test for auth routes |
| CORS error | Add headers to API route or `next.config.js` | Cross-origin request succeeds | Document allowed origins |
| Connection pool exhaustion | Increase pool size or add connection timeout in DATABASE_URL | Concurrent requests succeed | Add connection pool monitoring |
| Circular dependency | Extract shared types to a separate file | Build succeeds, no import cycle warnings | Use eslint-plugin-import with no-cycle rule |
| Wrong Prisma relation | Fix `@relation` directive, regenerate client | Related data loads correctly | Validate schema before migration |

## Known Failure Modes

### Prisma Schema Drift

**Symptoms:** Queries fail with "column not found" or return unexpected shapes. Types in IDE don't match runtime behavior.
**Root cause:** Schema was edited but `npx prisma generate` was not run, or a migration was applied to production but not reflected in the schema file.
**Immediate fix:**
```bash
npx prisma db pull    # Sync schema FROM database
npx prisma generate   # Regenerate client types
```
**Prevention:** Always run `npx prisma generate` after any schema change. Add it to `postinstall` in `package.json`.

### Vercel Environment Variable Mismatch

**Symptoms:** App works locally but fails on Vercel. Errors reference undefined config values.
**Root cause:** Env var exists in `.env.local` but was not added to Vercel project settings, or was added to wrong environment (Preview vs Production).
**Immediate fix:** Compare `.env.local` against Vercel project settings. Add missing vars to the correct environment scope.
**Prevention:** Maintain a checklist of required env vars in the project README or `.env.example`.

### Hydration Mismatch in Next.js

**Symptoms:** React hydration error in console. Content flickers on load. "Text content did not match" warning.
**Root cause:** Server-rendered HTML differs from client-rendered HTML. Common causes: date/time rendering, browser-only APIs (window, localStorage), conditional rendering based on client state.
**Immediate fix:** Wrap client-dependent rendering in `useEffect` or a `ClientOnly` wrapper. Use `suppressHydrationWarning` only for known-safe cases like timestamps.
**Prevention:** Never access `window`, `localStorage`, or `document` during server rendering. Use `typeof window !== 'undefined'` guards or `'use client'` directive.

## Anti-Patterns

❌ **Anti-pattern: Shotgun Debugging**
Problem: Changing multiple things at once to "see if something sticks." Three config files edited, two dependencies updated, and a code change — all in one attempt. When something works, you don't know which change fixed it. When nothing works, you've introduced new variables.
✅ Solution: Change one thing at a time. Verify after each change. Revert if it doesn't help. This feels slower but is faster because you build understanding with each step.

❌ **Anti-pattern: Restart and Pray**
Problem: Restarting the dev server, clearing caches, or redeploying without understanding the root cause. The symptom may disappear temporarily (cold start, cache expiry) but returns because the underlying issue persists.
✅ Solution: Collect logs and error messages BEFORE restarting. Reproduce the issue, gather evidence, then form a hypothesis. Only restart after you have a specific reason to believe state corruption is the cause.

❌ **Anti-pattern: Console.log Carpet Bombing**
Problem: Adding `console.log` to every function in the call path. Output becomes noise — hundreds of log lines with no structure. The actual error gets buried. Logs are left in the code after debugging.
✅ Solution: Log strategically at decision points: function entry with key parameters, before and after the suspected failing operation, and at branch points. Use descriptive labels: `console.log('[createOrder] input:', data)`. Remove all debug logs before committing.

❌ **Anti-pattern: Fixing the Symptom, Not the Cause**
Problem: Adding a try/catch that swallows an error, or a null check that hides a missing data problem. The error disappears from logs but the underlying issue (broken query, race condition, missing validation) continues to corrupt data silently.
✅ Solution: Follow the diagnostic methodology to root cause. A fix must address WHY the error occurs, not just prevent it from surfacing. If a value is unexpectedly null, find out why it's null — don't just add `?? defaultValue`.

## Stack Adaptation

Before executing, read `tech-stack-preferences.md` for the user's actual stack. Apply these substitutions:
- **Database commands** → use Prisma CLI and query logging from preferences
- **Deployment logs** → use Vercel CLI commands from preferences
- **Test runner** → use Vitest from preferences for writing regression tests
- **Auth debugging** → use Clerk-specific debugging paths
- **Type checking** → always run `npx tsc --noEmit` for TypeScript projects
- **Error tracking** → reference PostHog and Vercel Logs from preferences
- **Background jobs** → check Inngest dashboard for job failures

## Integration with Other Skills

- **code-quality-patterns** — After fixing a bug, use code-quality-patterns to assess whether the fix meets code quality standards and add appropriate tests.
- **codebase-conventions** — When the fix involves adding new files or modules, use codebase-conventions to determine where they should go.
- **performance-optimization** — When the diagnosis reveals a performance problem rather than a correctness bug, hand off to performance-optimization for deeper analysis.
- **incident-response** — When the issue is a production outage affecting users, use incident-response for the structured response process, then return here for root cause diagnosis.
- **ci-cd-pipelines** — When the failure is in the CI/CD pipeline itself, use ci-cd-pipelines for pipeline-specific debugging.
- **security-assessment** — When the diagnosis reveals a security vulnerability, hand off to security-assessment for threat analysis and remediation prioritization.
