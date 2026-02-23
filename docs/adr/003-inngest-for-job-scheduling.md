# ADR-003: Inngest for Scheduled Task Execution

**Status:** Accepted
**Date:** 2026-02-15

## Context

The system needs scheduled tasks (cron jobs, one-time jobs, background tasks) for features like morning summaries, task reminders, and periodic health checks. Options considered:

1. **node-cron** — simple in-process cron, no persistence, no dashboard
2. **Bull/BullMQ** — Redis-backed queue, overkill for our scale
3. **Inngest** — event-driven job framework with built-in dev dashboard, retries, and step functions

## Decision

**Use Inngest** for all scheduled task execution. The Inngest Dev Server runs locally on port 8288 and provides a dashboard for monitoring jobs.

## Consequences

**Benefits:**
- Built-in retry with exponential backoff (3 retries default)
- Real-time monitoring dashboard at `http://localhost:8288`
- Step functions for multi-step workflows with dependency tracking
- Cron expression validation at creation time
- IANA timezone support
- Persistent job state survives process restarts

**Trade-offs:**
- Additional process to manage (Inngest Dev Server)
- Local-only in current setup (no cloud deployment yet)
- Jobs are dispatched through the Orchestrator's Inngest integration, coupling them to Orchestrator lifecycle

## Related

- `Orchestrator/README.md` — Job Management section
- `docs/architecture.md` — Execution tiers
