---
name: infrastructure-ops
description: >
  Manage deployment infrastructure, container orchestration, DNS, CDN, and
  environment configuration. Activate when asked about Vercel deployment,
  Docker Compose setup, Cloudflare DNS, environment variables, domain
  configuration, container management, or infrastructure provisioning. Also
  use when asked to "set up hosting", "configure DNS", "manage environments",
  "deploy this", "docker setup", or "infrastructure".
---

## Quick Reference

| Task | Command / Approach |
|------|-------------------|
| Deploy to preview | `vercel` (auto-deploys on push to branch) |
| Deploy to production | `vercel --prod` |
| Rollback production | `vercel rollback` |
| List deployments | `vercel ls` |
| Set env var | `vercel env add VARIABLE_NAME` |
| List env vars | `vercel env ls` |
| Start local services | `docker compose up -d` |
| Stop local services | `docker compose down` |
| View container logs | `docker compose logs -f <service>` |
| Check DNS records | `nslookup your-domain.com` |

## Key Guidelines

**CRITICAL:** Never modify production environment variables without verifying the change in preview/staging first. A wrong env var can silently break authentication, payments, or data connections.

**CRITICAL:** Always use `docker compose down` to stop containers, not `docker kill`. Killing containers skips graceful shutdown and can corrupt database volumes.

- Always version-pin Docker images (`postgres:16-alpine`, not `postgres:latest`)
- Always set resource limits on Docker containers in production (memory, CPU)
- Always use HTTPS in production — Vercel provides this automatically
- Never commit `.env` files — use `.env.example` as a template
- Always test infrastructure changes in preview before promoting to production

## Core Operations

### Vercel Deployment

**Project setup:**

```bash
# Link existing project to Vercel
vercel link

# Set framework to Next.js (usually auto-detected)
vercel env add FRAMEWORK_PRESET nextjs
```

**Environment configuration:**

```bash
# Add environment variable (interactive — prompts for value and scope)
vercel env add DATABASE_URL

# Add to specific environment
vercel env add DATABASE_URL production
vercel env add DATABASE_URL preview
vercel env add DATABASE_URL development

# Pull env vars to local .env.local
vercel env pull .env.local

# List all env vars
vercel env ls
```

**Deployment management:**

```bash
# Deploy preview (happens automatically on PR)
vercel

# Deploy to production
vercel --prod

# Inspect a deployment
vercel inspect <deployment-url>

# Rollback to previous production deployment
vercel rollback

# Promote a preview deployment to production
vercel promote <deployment-url>
```

**Gotchas:**
- `NEXT_PUBLIC_` prefixed vars are embedded in the client bundle at BUILD time — changing them requires a redeploy
- Vercel's `vercel env pull` overwrites your local `.env.local` — back it up first if you have local-only values
- Preview deployments get their own URL — use `VERCEL_URL` env var for dynamic base URL in previews

### Docker Compose for Local Services

Standard `docker-compose.yml` for local development:

```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    ports:
      - '5433:5432'    # Use 5433 to avoid conflict with local PostgreSQL
    environment:
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: appdb
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U dev']
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - '6379:6379'
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

```bash
# Start all services
docker compose up -d

# Start specific service
docker compose up -d postgres

# View logs
docker compose logs -f postgres

# Stop all services (preserves data)
docker compose down

# Stop and remove data volumes (destructive — use for reset)
docker compose down -v

# Check service health
docker compose ps
```

**Gotchas:**
- Port 5432 may conflict with a local PostgreSQL installation — map to 5433 instead
- Volumes persist data between restarts — use `docker compose down -v` to reset completely
- `depends_on` does not wait for the service to be READY, only STARTED — use healthchecks
- On macOS, Docker Desktop has default memory limits — increase if PostgreSQL OOM-kills

### DNS and CDN (Cloudflare)

**Domain setup with Vercel:**

1. Add domain in Vercel project settings
2. Vercel provides the required DNS records
3. Add records in Cloudflare DNS dashboard
4. Set Cloudflare proxy status to "DNS only" (gray cloud) for Vercel — Vercel handles SSL

| Record Type | Name | Value | Proxy |
|-------------|------|-------|-------|
| CNAME | www | `cname.vercel-dns.com` | DNS only |
| A | @ | `76.76.21.21` | DNS only |

**Gotchas:**
- Cloudflare proxy (orange cloud) conflicts with Vercel's SSL — use DNS only for Vercel-hosted domains
- DNS propagation takes 1-48 hours — check with `nslookup` or `dig` before assuming it's broken
- Wildcard certificates on Cloudflare require paid plans

### Environment Management Strategy

| Environment | Purpose | Database | Env Vars Source |
|------------|---------|----------|----------------|
| **Development** | Local development | Docker Compose PostgreSQL (port 5433) | `.env.local` |
| **Preview** | PR review and testing | Separate preview database | Vercel preview env vars |
| **Production** | Live users | Production database | Vercel production env vars |

**IMPORTANT:** Each environment must have its own database. Never share a database between preview and production.

```bash
# .env.example — template for required variables (commit this)
DATABASE_URL=postgresql://dev:dev@localhost:5433/appdb
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
NEXT_PUBLIC_POSTHOG_KEY=phc_...
```

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|---------|
| Deploy fails with "module not found" | Dependency not in package.json or wrong import path | Run `npm ci` locally first, check import paths |
| Env var undefined in deployed app | Not set in Vercel or wrong environment scope | Check `vercel env ls`, verify scope matches deployment |
| Docker container exits immediately | Port conflict, missing env var, or bad config | Check `docker compose logs <service>` |
| DNS not resolving | Propagation delay or wrong record | Wait 1-4 hours, verify with `nslookup` |
| SSL certificate error | Cloudflare proxy + Vercel conflict | Set Cloudflare to DNS only (gray cloud) for Vercel domains |
| Database connection refused in Docker | Wrong port mapping or container not healthy | Check `docker compose ps` for health status |
| Build works locally but fails on Vercel | Different Node version or missing env var | Set Node version in `engines` field of package.json |
| Preview URL returns 404 | Build failed silently or wrong branch | Check deployment status in Vercel dashboard |

## Anti-Patterns

❌ **Anti-pattern: Shared Database Across Environments**
Problem: Preview deployments use the production database. A PR with a destructive migration wipes production data. Or test data pollutes production.
✅ Solution: Every environment gets its own database. Use Vercel's environment scoping: `DATABASE_URL` for production, `PREVIEW_DATABASE_URL` for preview. Automate preview database provisioning with branch-specific databases.

❌ **Anti-pattern: Manual Deployment**
Problem: Deployment requires SSH-ing into a server, pulling code, and running commands. Each deployment is slightly different. Mistakes are common. Rollbacks are manual and slow.
✅ Solution: Automate with Vercel's git integration (push to main = production deploy) or GitHub Actions. Every deployment should be identical, reproducible, and rollback-able.

❌ **Anti-pattern: Unversioned Infrastructure**
Problem: Docker Compose files, Vercel configuration, and GitHub Actions workflows are not version-controlled or drift from reality. "It works on my machine" becomes "it works in my Docker Compose."
✅ Solution: Commit all infrastructure configuration. Docker Compose files, GitHub Actions workflows, Vercel project settings (via `vercel.json`), and `.env.example` belong in the repository.

## Stack Adaptation

Before operating, read `tech-stack-preferences.md` for the user's actual stack. Apply these substitutions:
- **Hosting** → use Vercel CLI and dashboard from preferences
- **CI/CD** → use GitHub Actions from preferences
- **DNS/CDN** → use Cloudflare from preferences
- **Database** → use PostgreSQL from preferences, Docker Compose for local
- **Cache** → use Upstash Redis from preferences
- **Container orchestration** → use Docker Compose from preferences (local development)
- **Monitoring** → use PostHog + Vercel Analytics from preferences

## Integration with Other Skills

- **ci-cd-pipelines** — For setting up automated deployment pipelines that use this infrastructure.
- **migration-runbooks** — For database migration procedures that affect infrastructure.
- **diagnostic-debugging** — When infrastructure issues cause application bugs (wrong env vars, unreachable databases).
- **incident-response** — When infrastructure failures cause production incidents.
- **security-assessment** — For infrastructure security review (DNS, SSL, env var handling).
