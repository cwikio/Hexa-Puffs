---
name: incident-response
description: >
  Structured response to production incidents: outages, degraded performance,
  data loss, and security breaches. Activate when a user reports a production
  issue affecting users, says "site is down", "production is broken",
  "users are reporting errors", "we have an outage", "incident", "SEV1",
  "post-mortem", or needs help with on-call response, incident triage, or
  writing a post-mortem.
---

## When to Activate

Use this skill when:
- Production system is down or degraded and users are affected
- User needs to triage and respond to a live incident
- User needs to write a post-mortem after an incident
- User is setting up incident response procedures
- Severity classification is needed for an issue

Do NOT use this skill when:
- Issue is in development/staging only (use diagnostic-debugging)
- User is performing a proactive security audit (use security-assessment)
- User is optimizing performance without an active incident (use performance-optimization)

## Severity Classification

**CRITICAL:** Classify severity FIRST. Response urgency and communication requirements depend on it.

| Severity | Definition | Response Time | Examples |
|----------|-----------|---------------|---------|
| **SEV1** | Complete outage, data loss, security breach | Immediate (< 15 min) | App unreachable, database corruption, credentials leaked |
| **SEV2** | Major feature broken, significant user impact | < 1 hour | Payments failing, auth broken for subset of users, data not saving |
| **SEV3** | Minor feature broken, workaround exists | < 4 hours | One page broken (others work), email notifications delayed, UI glitch |
| **SEV4** | Cosmetic issue, minimal user impact | Next business day | Typo in production, minor styling bug, non-critical log errors |

## Incident Response Phases

```
Phase 1: DETECT       → Something is wrong. How did we find out?
    │
Phase 2: TRIAGE       → How bad is it? Who is affected? What severity?
    │
Phase 3: MITIGATE     → Stop the bleeding. Reduce user impact NOW.
    │
Phase 4: RESOLVE      → Fix the root cause. Verify the fix.
    │
Phase 5: POST-MORTEM  → What happened? Why? How do we prevent it?
```

### Phase 1: Detect

**How incidents are typically discovered:**

| Source | Check |
|--------|-------|
| User reports | Support tickets, social media, direct messages |
| Monitoring alerts | PostHog alerts, Vercel Analytics anomalies |
| Error logs | Vercel function logs spike, error rate increase |
| Uptime check | External uptime monitor (e.g., BetterUptime) |
| Deployment | Issue immediately after a deploy |

**Immediate actions:**
1. Note the exact time the issue was first detected
2. Check: Was there a recent deployment? (`vercel ls --limit=5`)
3. Open the investigation toolkit below

### Phase 2: Triage

**CRITICAL:** Triage must take less than 15 minutes. The goal is severity classification and impact scope, not root cause.

```
Is the entire application unreachable?
│
├─ YES → SEV1
│  ├─ Check Vercel status page (vercel.com/status)
│  ├─ Check DNS (nslookup your-domain.com)
│  ├─ Check if it's your app or infrastructure
│  └─ Immediately notify stakeholders
│
└─ NO → Is a critical flow broken (auth, payments, core functionality)?
   │
   ├─ YES → How many users affected?
   │  ├─ All users → SEV1
   │  ├─ Subset (> 10%) → SEV2
   │  └─ Small subset → SEV3
   │
   └─ NO → Is the issue user-facing?
      ├─ YES, with workaround → SEV3
      └─ Cosmetic only → SEV4
```

### Phase 3: Mitigate

**Goal: Reduce user impact as fast as possible.** This is NOT the time for root cause analysis.

**Mitigation options (in order of speed):**

| Option | When | How | Time |
|--------|------|-----|------|
| **Rollback deploy** | Issue started after deploy | `vercel rollback` or redeploy previous commit | 2-5 min |
| **Feature flag off** | Issue in a specific feature | Disable in PostHog feature flags | < 1 min |
| **Redirect/maintenance page** | Full outage, fix will take time | Update DNS or Vercel redirect | 5-10 min |
| **Scale up** | Load-related degradation | Increase Vercel function concurrency limits | 5-10 min |
| **Database rollback** | Bad migration corrupted data | Restore from backup point | 15-30 min |
| **Cache clear** | Stale/corrupted cache data | Purge Upstash Redis or Vercel cache | < 1 min |

**CRITICAL:** If the issue started immediately after a deployment, rollback FIRST, investigate SECOND. The fastest mitigation is almost always reverting the change that caused the problem.

### Phase 4: Resolve

After mitigation has reduced user impact, investigate the root cause:

1. **Collect evidence** — Gather logs, error messages, metrics from the incident window
2. **Identify root cause** — Use diagnostic-debugging skill for systematic investigation
3. **Implement fix** — Apply the permanent fix (not just the mitigation)
4. **Verify** — Confirm the fix resolves the issue and does not introduce new problems
5. **Remove mitigation** — If you rolled back or used a feature flag, now deploy the fix properly

### Phase 5: Post-Mortem

**CRITICAL:** Blameless. The post-mortem analyzes the system, not the people. If a human made a mistake, ask why the system allowed that mistake to reach production.

Write the post-mortem within 48 hours while context is fresh.

## Investigation Toolkit

```bash
# Recent Vercel deployments (check if issue correlates with a deploy)
vercel ls --limit=10

# Vercel function logs (live)
vercel logs --follow

# Vercel deployment logs for a specific deploy
vercel inspect <deployment-url>

# Rollback to previous deployment
vercel rollback

# Check database status
npx prisma migrate status

# Check if database is reachable
npx prisma db execute --stdin <<< "SELECT 1;"

# GitHub: recent commits to main
gh log --oneline -10
```

## Post-Mortem Template

```markdown
# Incident Post-Mortem: [Title]

**Date:** YYYY-MM-DD
**Severity:** SEV[1-4]
**Duration:** [total time from detection to resolution]
**Author:** [who wrote this]

## Summary

[2-3 sentences: what happened, who was affected, how it was resolved]

## Timeline

| Time (UTC) | Event |
|-----------|-------|
| HH:MM | Issue first detected by [source] |
| HH:MM | Triage: classified as SEV[N] |
| HH:MM | Mitigation applied: [what was done] |
| HH:MM | Root cause identified: [what] |
| HH:MM | Fix deployed |
| HH:MM | Issue confirmed resolved |

## Root Cause

[Detailed technical explanation of what went wrong and why]

## Impact

- **Users affected:** [number or percentage]
- **Duration of impact:** [time]
- **Data affected:** [any data loss or corruption]
- **Revenue impact:** [if applicable]

## What Went Well

- [Things that worked during the response]
- [Quick detection, fast rollback, good communication, etc.]

## What Went Wrong

- [Things that made the incident worse or response slower]
- [Missing monitoring, slow detection, unclear runbooks, etc.]

## Action Items

| Action | Owner | Priority | Due Date |
|--------|-------|----------|----------|
| [Preventive action] | [person] | P1/P2/P3 | [date] |
| [Detection improvement] | [person] | P1/P2/P3 | [date] |
| [Process improvement] | [person] | P1/P2/P3 | [date] |

## Lessons Learned

[What did we learn that changes how we work going forward?]
```

## Communication Templates

### Internal Notification (SEV1/SEV2)

```
🔴 INCIDENT: [Brief description]
Severity: SEV[N]
Impact: [Who is affected, what is broken]
Status: [Investigating / Mitigating / Monitoring]
Lead: [Who is handling it]
Next update: [time]
```

### Status Update

```
🟡 UPDATE: [Brief description]
Status: [Mitigating / Resolved / Monitoring]
Actions taken: [What was done since last update]
Current impact: [Improved / Same / Worse]
Next steps: [What happens next]
Next update: [time]
```

### Resolution Notice

```
🟢 RESOLVED: [Brief description]
Duration: [start to end]
Root cause: [1 sentence]
Fix: [1 sentence]
Post-mortem: [will be shared by date]
```

## Anti-Patterns

❌ **Anti-pattern: Root Cause Rabbit Hole During Outage**
Problem: Spending 45 minutes investigating the root cause while users are still affected. The team debates whether it's a database issue or an API issue while the site is down.
✅ Solution: Mitigate first, investigate second. If a rollback is possible, do it immediately. Understanding "why" can wait until users are no longer impacted.

❌ **Anti-pattern: Silent Incident**
Problem: The team fixes a production issue without telling anyone. No post-mortem, no communication. The same issue recurs 3 months later because no one documented what happened.
✅ Solution: Every SEV1/SEV2 gets a post-mortem. Every incident gets at least a brief internal notification. Communication is not overhead — it is part of the fix.

❌ **Anti-pattern: Blame-Based Post-Mortem**
Problem: "John pushed the bad code." This shuts down honest reporting. Next time, people hide incidents instead of reporting them because they fear blame.
✅ Solution: Focus on systems, not individuals. "The deployment pipeline allowed a breaking change to reach production without running integration tests." This leads to actionable improvements.

❌ **Anti-pattern: Heroic Solo Response**
Problem: One person handles the entire incident alone — investigating, communicating, fixing, and monitoring. They burn out, make mistakes under pressure, and create a single point of failure in the response.
✅ Solution: Even in small teams, separate roles: one person investigates/fixes, another communicates status updates. If you are solo, communicate first ("I'm investigating X, will update in 30 minutes"), then focus on the fix.

## Stack Adaptation

Before responding, read `tech-stack-preferences.md` for the user's actual stack. Apply these substitutions:
- **Deployment** → use Vercel CLI for rollbacks and deployment inspection
- **Monitoring** → check PostHog alerts and Vercel Analytics for anomalies
- **Database** → use Prisma CLI for migration status and database checks
- **Auth** → check Clerk dashboard for auth-related incidents
- **Payments** → check Stripe dashboard for webhook failures or payment issues
- **Background jobs** → check Inngest dashboard for failed or stuck jobs
- **Error tracking** → use Vercel Logs and PostHog for error patterns

## Integration with Other Skills

- **diagnostic-debugging** — After mitigation, use diagnostic-debugging for systematic root cause analysis during Phase 4.
- **security-assessment** — When the incident involves a security breach or vulnerability, use security-assessment for the security-specific investigation and remediation.
- **infrastructure-ops** — When the incident is infrastructure-level (DNS, CDN, database hosting), reference infrastructure-ops for infrastructure-specific commands.
- **ci-cd-pipelines** — When the incident reveals a gap in the deployment pipeline (missing tests, no rollback capability), use ci-cd-pipelines to improve the pipeline.
- **migration-runbooks** — When the incident was caused by a database migration, reference migration-runbooks for safe rollback procedures.
