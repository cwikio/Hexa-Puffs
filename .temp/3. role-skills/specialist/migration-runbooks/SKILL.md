---
name: migration-runbooks
description: >
  Plan and execute migrations: database schema changes, dependency upgrades,
  framework version bumps, and infrastructure transitions. Activate when asked
  about database migration, schema change, dependency upgrade, version bump,
  Next.js upgrade, Prisma migration, Node.js upgrade, or data migration. Also
  use when asked to "upgrade", "migrate", "bump version", "update dependencies",
  or "move from X to Y".
---

## Migration Overview

All migrations transform a system from state A to state B. The risk is not in the transformation itself — it is in discovering mid-migration that the transformation is incomplete, incorrect, or irreversible.

### Scope Assessment

Before starting any migration, assess scope:

| Factor | Small | Medium | Large |
|--------|-------|--------|-------|
| Files affected | < 10 | 10-50 | > 50 |
| Dependencies to update | 1-3 | 3-10 | > 10 |
| Breaking changes | None | Some, contained | Many, cascading |
| Data transformation needed | No | Minor | Major (schema + data) |
| Estimated effort | Hours | 1-3 days | > 1 week |
| Recommended approach | Big-bang | Incremental | Phased with coexistence |

## Pre-Migration Checklist

**CRITICAL:** Complete ALL items before writing any migration code.

- [ ] All tests pass on current version (`npx vitest run && npx tsc --noEmit`)
- [ ] Working branch created from latest main (`git checkout -b migrate/description`)
- [ ] Database backup exists (for schema/data migrations)
- [ ] Rollback procedure documented and tested
- [ ] Team notified of migration timeline
- [ ] No concurrent migrations in progress

**Verification:**

```bash
# Verify clean state
git status                    # No uncommitted changes
npx tsc --noEmit              # No type errors
npx vitest run                # All tests pass
npx prisma migrate status     # No pending migrations
```

## Migration Types

### Database Schema Migration (Prisma)

**The most common and most dangerous migration type.** Schema changes affect live data.

**Workflow:**

1. **Edit `schema.prisma`** — Make the schema change

2. **Generate migration** — Creates SQL migration file
   ```bash
   npx prisma migrate dev --name descriptive_name
   ```

3. **Review the generated SQL** — Read `prisma/migrations/<timestamp>_descriptive_name/migration.sql`
   - Does it add columns as nullable or with defaults? (safe)
   - Does it drop columns or tables? (dangerous — verify no code references them)
   - Does it rename columns? (dangerous — old code will break)
   - Does it change column types? (dangerous — data truncation risk)

4. **Test locally** — Reset and replay to verify from clean state
   ```bash
   npx prisma migrate reset  # WARNING: destroys local data
   ```

5. **Deploy** — Apply to production
   ```bash
   npx prisma migrate deploy
   ```

**Transformation rules for common schema changes:**

| Change | Safe? | Migration Pattern |
|--------|-------|------------------|
| Add nullable column | Safe | Direct migration, no data change needed |
| Add column with default | Safe | Direct migration, existing rows get default |
| Add required column (no default) | Unsafe | Two-step: add as nullable → backfill → set non-null |
| Remove column | Unsafe | Two-step: remove code references → then drop column |
| Rename column | Unsafe | Three-step: add new → copy data → remove old |
| Change column type | Unsafe | Depends on conversion — test with production data copy |
| Add index | Safe | Direct migration, may take time on large tables |
| Add relation | Safe if nullable | Direct migration |
| Remove table | Unsafe | Verify no foreign keys reference it |

**Two-step pattern for breaking changes:**

```
Deploy 1: Add new column (nullable), update code to write to both old and new
    ↓
Backfill: Migrate existing data from old column to new column
    ↓
Deploy 2: Remove old column, update code to read from new only
```

**Gotchas:**
- `npx prisma migrate dev` is for DEVELOPMENT only — it creates new migrations. Use `migrate deploy` in CI/production.
- `npx prisma migrate reset` drops ALL data — never run on production
- Large table migrations (>1M rows) can lock the table — schedule during low-traffic windows
- Always run `npx prisma generate` after migration to update the client types

### Dependency Upgrade

**Workflow:**

1. **Check what's outdated**
   ```bash
   npm outdated
   ```

2. **Read changelogs** — For each package with a major version bump, read the CHANGELOG or migration guide

3. **Upgrade incrementally** — One package at a time for major versions
   ```bash
   # Minor/patch updates (usually safe in batch)
   npm update

   # Major version upgrade (one at a time)
   npm install package@latest
   ```

4. **Verify after each upgrade**
   ```bash
   npx tsc --noEmit
   npx vitest run
   ```

5. **Fix breaking changes** — Apply transformations from the changelog

**Priority order for upgrades:**

| Priority | Criteria | Action |
|----------|---------|--------|
| Critical | Known CVE (high/critical) | Upgrade immediately |
| High | Major version, actively used | Schedule for current sprint |
| Medium | Minor version behind | Batch with other updates |
| Low | Patch version behind | Update during maintenance window |

### Next.js Major Version Upgrade

**Pre-upgrade:**

```bash
# Check current version
npx next --version

# Run the official upgrade codemod
npx @next/codemod@latest upgrade
```

**Common breaking changes by version:**

| Transition | Key Changes | Migration Action |
|-----------|-------------|-----------------|
| 14 → 15 | Async request APIs, caching changes | Run codemod, update `cookies()`, `headers()` to async |
| 15 → 16 | React 19, Turbopack default | Update React peer deps, test with Turbopack |

**Verification sequence:**

```bash
npx tsc --noEmit              # Types still valid
npx vitest run                # Unit/integration tests pass
npm run build                 # Production build succeeds
npm run dev                   # Dev server starts, manual smoke test
npx playwright test           # E2E tests pass
```

### Node.js Version Upgrade

1. Update `.nvmrc` or `engines` in `package.json`
2. Update GitHub Actions workflow: `node-version: 22`
3. Update Docker base images if applicable
4. Update Vercel project settings (Node.js version)
5. Rebuild `node_modules`: `rm -rf node_modules && npm ci`
6. Run full test suite

## Validation

### Step-Level Validation

After each migration step:

```bash
npx tsc --noEmit              # Type check
npx vitest run                # Test suite
npm run build                 # Build succeeds
```

### Final Validation Checklist

After ALL migration steps complete:

- [ ] All tests pass — `npx vitest run`
- [ ] Type check passes — `npx tsc --noEmit`
- [ ] Build succeeds — `npm run build`
- [ ] Application starts correctly — `npm run dev` and manual smoke test
- [ ] No warnings or deprecation notices in console
- [ ] Database schema matches Prisma schema — `npx prisma validate`
- [ ] E2E critical paths work — `npx playwright test`

## Rollback Procedures

### Database Migration Rollback

Prisma does not support automatic rollback of applied migrations. Options:

```bash
# Option 1: Revert the migration manually (write reverse SQL)
npx prisma migrate resolve --rolled-back <migration_name>

# Option 2: Restore from backup (for critical failures)
# Use your database provider's point-in-time recovery

# Option 3: Create a new "undo" migration
# Edit schema.prisma to reverse the change, then:
npx prisma migrate dev --name undo_previous_change
```

**CRITICAL:** Always have a tested rollback plan before applying migrations to production. "We'll figure it out" is not a rollback plan.

### Dependency Rollback

```bash
# Revert to previous version
npm install package@previous-version

# Or revert the entire package-lock.json
git checkout main -- package-lock.json
npm ci
```

### Deploy Rollback

```bash
# Rollback Vercel deployment to previous version
vercel rollback
```

## Anti-Patterns

❌ **Anti-pattern: Big Bang Migration**
Problem: Upgrading 15 dependencies, changing the database schema, and updating the framework in one PR. When something breaks, it's impossible to isolate which change caused it. The PR is unreviewable at 200+ file changes.
✅ Solution: One migration per PR. Upgrade one dependency, verify, commit. Change one schema aspect, verify, commit. Each change is independently reviewable and revertable.

❌ **Anti-pattern: Migration Without Rollback Plan**
Problem: Applying a database migration to production without considering how to undo it if data corruption is discovered 2 hours later. The team scrambles to write reverse SQL under pressure.
✅ Solution: Write the rollback SQL BEFORE applying the migration. Test the rollback on a copy of production data. Document the rollback steps in the PR description.

❌ **Anti-pattern: Skipping the Changelog**
Problem: Running `npm update` and hoping nothing breaks. A major version bump introduces a subtle behavior change that passes tests but breaks production functionality.
✅ Solution: Read the CHANGELOG for every major version bump. Search for "BREAKING" in the changelog. Run the migration/upgrade guide if one exists.

❌ **Anti-pattern: Migrating Production First**
Problem: "Let's just try it in production." If the migration fails, users are affected. If it succeeds but has subtle issues, they're discovered by users.
✅ Solution: Always migrate in order: local → test/CI → preview/staging → production. Each environment validates the migration before proceeding.

## Stack Adaptation

Before migrating, read `tech-stack-preferences.md` for the user's actual stack. Apply these substitutions:
- **Database migrations** → use Prisma Migrate from preferences
- **Dependency management** → use npm from preferences
- **Framework** → use Next.js upgrade codemods from preferences
- **Runtime** → update Node.js version in Vercel, GitHub Actions, Docker
- **CI validation** → use Vitest + Playwright from preferences for post-migration verification
- **Deployment** → use Vercel for staging/production rollout

## Integration with Other Skills

- **infrastructure-ops** — For infrastructure changes that accompany migrations (new services, database provisioning).
- **ci-cd-pipelines** — For configuring migration steps in the deployment pipeline.
- **diagnostic-debugging** — When a migration causes unexpected behavior, for root cause analysis.
- **test-strategy** — For determining what tests to run before and after migration to ensure correctness.
- **tech-debt-assessment** — When evaluating whether a migration is worth the effort (cost/benefit analysis).
