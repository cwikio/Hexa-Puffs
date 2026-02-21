---
name: ci-cd-pipelines
description: >
  Create, configure, and maintain CI/CD pipelines for automated testing,
  building, and deployment. Activate when asked about GitHub Actions workflows,
  deployment automation, CI pipeline setup, build pipelines, automated testing
  in CI, environment management, preview deployments, or release processes.
  Also use when a user says "set up CI", "add a GitHub Action", "automate
  deployment", "fix the pipeline", or "add a build step".
---

## Quick Reference

| Task | Command / Approach |
|------|-------------------|
| Create workflow | Add `.github/workflows/<name>.yml` |
| Run workflow locally | `act -j <job-name>` (requires nektos/act) |
| Check workflow status | `gh run list --workflow=<name>.yml` |
| View run logs | `gh run view <run-id> --log` |
| Re-run failed job | `gh run rerun <run-id> --failed` |
| Deploy to Vercel | Automatic on push (or `vercel deploy`) |
| Promote preview to prod | `vercel promote <deployment-url>` |
| Run DB migration in CI | `npx prisma migrate deploy` |
| Check env vars | `vercel env ls` |

## Key Guidelines

**CRITICAL:** Never store secrets in workflow files. Use GitHub repository secrets or Vercel environment variables. Reference with `${{ secrets.SECRET_NAME }}`.

**CRITICAL:** Always use `npx prisma migrate deploy` (not `migrate dev`) in CI/CD. `migrate dev` is interactive and generates new migrations — `migrate deploy` only applies existing ones.

- Always pin action versions to a specific SHA or major version tag (`actions/checkout@v4`, not `actions/checkout@main`)
- Always run `npx tsc --noEmit` before tests in the pipeline — catch type errors before spending time on test execution
- Always cache `node_modules` using `actions/cache` or `actions/setup-node` with `cache: 'npm'` to speed up builds
- Set a timeout on every job (`timeout-minutes`) to prevent hung workflows from consuming minutes
- Use `concurrency` groups to cancel superseded runs on the same branch

## Quick Start

Minimal PR validation workflow:

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  validate:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx vitest run
```

## Core Workflows

### PR Validation Pipeline

Run on every pull request to catch issues before merge.

```yaml
name: PR Validation
on:
  pull_request:
    branches: [main]

concurrency:
  group: pr-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint-and-type-check:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx eslint .

  unit-tests:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'
      - run: npm ci
      - run: npx vitest run

  e2e-tests:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: testdb
        ports:
          - 5433:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'
      - run: npm ci
      - run: npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://test:test@localhost:5433/testdb
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
        env:
          DATABASE_URL: postgresql://test:test@localhost:5433/testdb
```

**Gotchas:**
- PostgreSQL service container port must match your test `DATABASE_URL` — use 5433 to avoid conflict with local PostgreSQL
- Playwright needs `--with-deps` to install browser dependencies on the CI runner
- Always run `prisma migrate deploy` before E2E tests to set up the test database schema

### Database Migration in CI

```yaml
# Run as a separate job before deploy to catch migration issues early
migrate:
  runs-on: ubuntu-latest
  timeout-minutes: 5
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: 'npm'
    - run: npm ci
    - run: npx prisma migrate deploy
      env:
        DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

**Gotchas:**
- Run migrations BEFORE the deploy job, not during the Vercel build — Vercel builds may run in parallel across regions
- If migration fails, the deploy job should not run — use `needs: [migrate]` to enforce ordering
- Always test migrations locally first: `npx prisma migrate dev` then `npx prisma migrate reset` to verify from clean state

### Environment Variable Management

```yaml
# Set env vars for different deployment contexts
env:
  # Available to all jobs
  NODE_ENV: production

jobs:
  deploy-preview:
    environment: preview
    env:
      NEXT_PUBLIC_APP_URL: ${{ vars.PREVIEW_URL }}
      DATABASE_URL: ${{ secrets.PREVIEW_DATABASE_URL }}

  deploy-production:
    environment: production
    env:
      NEXT_PUBLIC_APP_URL: ${{ vars.PRODUCTION_URL }}
      DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}
```

**Use GitHub environments** to manage environment-specific variables:
- `preview` — preview/staging environment secrets
- `production` — production secrets with required reviewers for protection

### Vercel Deployment Integration

Vercel deploys automatically on push. Use GitHub Actions for pre-deploy validation:

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  validate:
    # ... type check, lint, test (same as PR validation)

  migrate:
    needs: [validate]
    # ... run prisma migrate deploy against production DB

  # Vercel deploys automatically after push
  # No need for a deploy job — Vercel's GitHub integration handles it
  # Use Vercel's "Ignored Build Step" to skip deploys when only docs change
```

For manual deploy control (disable Vercel auto-deploy):

```yaml
deploy:
  needs: [validate, migrate]
  runs-on: ubuntu-latest
  timeout-minutes: 10
  steps:
    - uses: actions/checkout@v4
    - uses: amondnet/vercel-action@v25
      with:
        vercel-token: ${{ secrets.VERCEL_TOKEN }}
        vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
        vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
        vercel-args: '--prod'
```

### Scheduled Jobs

```yaml
name: Scheduled Maintenance
on:
  schedule:
    - cron: '0 6 * * 1'  # Every Monday at 6 AM UTC

jobs:
  dependency-check:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'
      - run: npm ci
      - run: npm audit --audit-level=high
      - run: npx npm-check-updates --target minor
```

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| "npm ci" fails with lock file mismatch | `package-lock.json` out of sync | Run `npm install` locally, commit updated lock file |
| Prisma generate fails in CI | `prisma/schema.prisma` not in checkout | Ensure `.gitignore` does not exclude prisma directory |
| E2E tests flaky in CI | Race conditions, missing waits | Add explicit `waitForSelector` / `waitForResponse` in Playwright |
| Workflow not triggering | Path filter or branch mismatch | Check `on.pull_request.paths` and `branches` filters |
| "Permission denied" on script | Script not executable | Add `chmod +x script.sh` step or use `bash script.sh` |
| Secrets undefined in PR from fork | GitHub security: fork PRs can't access secrets | Use `pull_request_target` carefully, or skip secret-dependent steps for forks |
| Build timeout | Large dependencies, no caching | Add `actions/cache` for node_modules, set `timeout-minutes` |
| Concurrent deploys conflict | Multiple pushes trigger parallel deploys | Add `concurrency` group with `cancel-in-progress: true` |

## Anti-Patterns

❌ **Anti-pattern: Test in CI Only**
Problem: Tests never run locally — developers push and wait 10 minutes for CI to report failures. Feedback loop is too slow, leading to multiple fix-push-wait cycles per issue.
✅ Solution: Run `npx vitest run` and `npx tsc --noEmit` locally before pushing. CI is the safety net, not the primary feedback loop. Add these commands to a pre-push hook if discipline is lacking.

❌ **Anti-pattern: Monolith Workflow**
Problem: One 45-minute workflow that runs lint, type check, unit tests, integration tests, E2E tests, build, and deploy sequentially. A typo in a test file wastes 30 minutes waiting for preceding steps.
✅ Solution: Split into parallel jobs. Run lint + type check in parallel with unit tests. Run E2E tests only after cheaper checks pass. Use `needs:` to express dependencies, not sequential ordering.

❌ **Anti-pattern: Ignoring Failing Tests**
Problem: A test starts failing. Instead of fixing it, the team adds `skip` or removes it from CI. Over time, the test suite becomes a fiction — it passes but doesn't verify anything.
✅ Solution: A failing test is a P1 issue. Either fix the test (if the behavior it tests is still correct) or update the test (if the expected behavior changed). Never skip without a tracked issue to re-enable it.

## Stack Adaptation

Before configuring pipelines, read `tech-stack-preferences.md` for the user's actual stack. Apply these substitutions:
- **Package manager** → use npm commands from preferences
- **Test runner** → use Vitest from preferences
- **E2E runner** → use Playwright from preferences
- **Database** → use PostgreSQL + Prisma from preferences
- **Deployment** → use Vercel from preferences
- **Hosting** → adapt deploy commands to Vercel CLI
- **Monorepo** → if using Turborepo, add `turbo run build --filter=<package>` instead of direct commands

## Integration with Other Skills

- **diagnostic-debugging** — When a pipeline fails and the cause is unclear, use diagnostic-debugging for systematic root cause analysis.
- **infrastructure-ops** — For infrastructure provisioning that CI/CD pipelines depend on (databases, caches, CDN), reference infrastructure-ops.
- **migration-runbooks** — When database migrations need to be orchestrated as part of the deploy pipeline, reference migration-runbooks for the migration strategy.
- **test-strategy** — For deciding what types of tests to include in the pipeline (unit vs integration vs E2E balance), reference test-strategy.
- **security-assessment** — For adding security scanning steps (dependency audit, SAST) to the pipeline, reference security-assessment.
