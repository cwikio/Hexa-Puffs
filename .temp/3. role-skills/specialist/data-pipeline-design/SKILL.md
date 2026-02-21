---
name: data-pipeline-design
description: >
  Design and build data pipelines for ingestion, transformation, validation,
  and loading. Activate when asked about ETL, ELT, data pipelines, data
  ingestion, data transformation, batch processing, data quality checks,
  data scheduling, or pipeline orchestration. Also use when asked to "build
  a data pipeline", "process this data", "import data", "export data",
  "schedule a job", or "transform and load data".
---

## Quick Reference

| Task | Approach |
|------|----------|
| One-time data import | Script with Prisma, run manually |
| Recurring batch process | Inngest scheduled function |
| Real-time event processing | Inngest event-driven function |
| Data transformation | TypeScript transform function + Zod validation |
| Large file processing | Stream-based processing with backpressure |
| Cross-system sync | Inngest function with idempotent upserts |
| Data quality check | Zod schema validation at ingestion boundary |
| Pipeline monitoring | PostHog custom events + Inngest dashboard |

## Key Guidelines

**CRITICAL:** Every pipeline must be idempotent. Running the same pipeline twice with the same input must produce the same result without duplicating data. Use upserts, not inserts.

**CRITICAL:** Validate data at the ingestion boundary — before it enters your system. Bad data in the pipeline corrupts everything downstream. Use Zod schemas for structural validation.

- Always log pipeline progress (records processed, errors encountered, duration)
- Always handle partial failures — a pipeline that stops at record 500 of 10,000 is worse than one that skips bad records and reports them
- Always set timeouts on external data fetches — a hung API call blocks the entire pipeline
- Never process data in-place — always read from source, transform, write to destination
- Keep transformations as pure functions — input in, output out, no side effects

## Pipeline Patterns

### Pattern: ETL (Extract → Transform → Load)

Use when data must be cleaned/transformed before loading into the destination.

```typescript
// Inngest function for scheduled ETL
import { inngest } from '@/lib/inngest'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const sourceRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  amount: z.string().transform(Number),
  date: z.string().datetime(),
})

export const syncCustomerData = inngest.createFunction(
  { id: 'sync-customer-data', concurrency: { limit: 1 } },
  { cron: '0 2 * * *' }, // Daily at 2 AM UTC
  async ({ step }) => {
    // EXTRACT
    const rawData = await step.run('extract', async () => {
      const response = await fetch('https://api.external.com/customers', {
        headers: { Authorization: `Bearer ${process.env.API_KEY}` },
        signal: AbortSignal.timeout(30_000), // 30s timeout
      })
      if (!response.ok) throw new Error(`API returned ${response.status}`)
      return response.json()
    })

    // TRANSFORM + VALIDATE
    const { valid, invalid } = await step.run('transform', () => {
      const valid: z.infer<typeof sourceRecordSchema>[] = []
      const invalid: { record: unknown; error: string }[] = []

      for (const record of rawData) {
        const result = sourceRecordSchema.safeParse(record)
        if (result.success) {
          valid.push(result.data)
        } else {
          invalid.push({ record, error: result.error.message })
        }
      }

      return { valid, invalid }
    })

    // LOAD
    const loaded = await step.run('load', async () => {
      let count = 0
      for (const record of valid) {
        await prisma.customer.upsert({
          where: { externalId: record.id },
          create: {
            externalId: record.id,
            name: record.name,
            email: record.email,
            totalSpent: record.amount,
            lastSyncedAt: new Date(),
          },
          update: {
            name: record.name,
            email: record.email,
            totalSpent: record.amount,
            lastSyncedAt: new Date(),
          },
        })
        count++
      }
      return count
    })

    // REPORT
    return {
      processed: valid.length,
      loaded,
      errors: invalid.length,
      invalidRecords: invalid.slice(0, 10), // Log first 10 errors
    }
  }
)
```

### Pattern: Event-Driven Pipeline

Use when data arrives as events (webhooks, user actions) rather than on a schedule.

```typescript
// Triggered by a Stripe webhook event
export const processPayment = inngest.createFunction(
  { id: 'process-payment', retries: 3 },
  { event: 'stripe/payment.completed' },
  async ({ event, step }) => {
    const payment = event.data

    // Transform
    const processed = await step.run('transform', () => ({
      stripePaymentId: payment.id,
      amount: payment.amount / 100, // Cents to dollars
      currency: payment.currency.toUpperCase(),
      customerId: payment.customer,
      paidAt: new Date(payment.created * 1000),
    }))

    // Load
    await step.run('load', async () => {
      await prisma.payment.upsert({
        where: { stripePaymentId: processed.stripePaymentId },
        create: processed,
        update: processed,
      })
    })

    // Trigger downstream
    await step.sendEvent('send-receipt', {
      name: 'payment/receipt.needed',
      data: { paymentId: processed.stripePaymentId },
    })
  }
)
```

### Pattern: Batch Processing with Progress

Use for large datasets that need progress tracking and resumability.

```typescript
export const importLargeDataset = inngest.createFunction(
  { id: 'import-large-dataset', concurrency: { limit: 1 } },
  { event: 'data/import.requested' },
  async ({ event, step }) => {
    const { sourceUrl, batchSize = 100 } = event.data
    let cursor: string | null = null
    let totalProcessed = 0

    // Process in batches
    while (true) {
      const batch = await step.run(`fetch-batch-${totalProcessed}`, async () => {
        const url = new URL(sourceUrl)
        url.searchParams.set('limit', String(batchSize))
        if (cursor) url.searchParams.set('cursor', cursor)

        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
        return res.json()
      })

      if (batch.data.length === 0) break

      await step.run(`process-batch-${totalProcessed}`, async () => {
        // Batch upsert for efficiency
        await prisma.$transaction(
          batch.data.map((record: Record<string, unknown>) =>
            prisma.item.upsert({
              where: { externalId: record.id as string },
              create: transformRecord(record),
              update: transformRecord(record),
            })
          )
        )
      })

      totalProcessed += batch.data.length
      cursor = batch.nextCursor

      if (!cursor) break
    }

    return { totalProcessed }
  }
)
```

## Data Quality

### Validation Layers

```
Layer 1: Schema validation (Zod)       → Structural correctness
Layer 2: Business rule validation       → Domain-specific constraints
Layer 3: Referential integrity          → Foreign keys and relationships
Layer 4: Statistical validation         → Outlier detection, completeness checks
```

**Layer 1: Schema validation (always required)**

```typescript
const customerSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(200),
  revenue: z.number().nonnegative(),
  createdAt: z.string().datetime(),
})
```

**Layer 2: Business rules (when domain constraints exist)**

```typescript
function validateBusinessRules(record: Customer): string[] {
  const errors: string[] = []
  if (record.revenue > 1_000_000) errors.push('Revenue exceeds sanity check threshold')
  if (new Date(record.createdAt) > new Date()) errors.push('Created date is in the future')
  return errors
}
```

### Error Handling Strategy

| Error Type | Action | Log Level |
|-----------|--------|-----------|
| Schema validation failure | Skip record, log error, continue | WARN |
| Business rule violation | Skip record, log error, continue | WARN |
| Source API unreachable | Retry with backoff (Inngest handles this) | ERROR |
| Destination write failure | Retry the batch, then fail the pipeline | ERROR |
| Partial batch failure | Retry failed records individually | WARN |
| Complete pipeline failure | Alert, investigate, manual re-run | CRITICAL |

**IMPORTANT:** Never silently drop records. Every skipped record must be logged with the reason. After a pipeline run, the error count should be checked — zero errors is ideal, a spike in errors signals a data quality issue upstream.

## Monitoring

```typescript
// Log pipeline metrics to PostHog
import { PostHog } from 'posthog-node'

const posthog = new PostHog(process.env.POSTHOG_API_KEY!)

function logPipelineMetrics(pipelineName: string, metrics: PipelineMetrics) {
  posthog.capture({
    distinctId: 'system',
    event: 'pipeline_completed',
    properties: {
      pipeline: pipelineName,
      records_processed: metrics.processed,
      records_failed: metrics.errors,
      duration_ms: metrics.durationMs,
      success: metrics.errors === 0,
    },
  })
}
```

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|---------|
| Pipeline runs but loads 0 records | Validation rejects all records | Check schema against actual source data format |
| Duplicate records in destination | Missing upsert (using create instead) | Switch to `prisma.upsert` with proper unique key |
| Pipeline times out | Source API slow or large dataset | Add timeout, process in smaller batches |
| Data appears stale | Scheduled job not running | Check Inngest dashboard for job status |
| Memory error on large imports | Loading entire dataset into memory | Switch to streaming/batched processing |
| Pipeline runs twice, doubles data | Not idempotent | Use upserts with stable external IDs |

## Anti-Patterns

❌ **Anti-pattern: Fire-and-Forget Pipeline**
Problem: Pipeline runs on schedule, nobody checks if it succeeded. Weeks later, someone notices data hasn't been updated since the pipeline silently started failing.
✅ Solution: Every pipeline reports its completion status, record count, and error count. Set up alerts for: zero records processed, error rate > 5%, pipeline not completing within expected window.

❌ **Anti-pattern: Transform in the Database**
Problem: Using complex SQL queries to transform data during loading. The transformation logic lives in raw SQL strings, untested and hard to debug. When the transform breaks, you get cryptic SQL errors.
✅ Solution: Extract, transform in TypeScript (with tests and type safety), then load. Keep database writes simple — upserts with pre-transformed data.

❌ **Anti-pattern: No Schema Validation**
Problem: Trusting that external data sources always send data in the expected format. When a field type changes or a required field is missing, the pipeline crashes or loads corrupt data.
✅ Solution: Validate every record with Zod at the ingestion boundary. Parse with `safeParse`, separate valid from invalid, process valid records, log invalid ones.

## Stack Adaptation

Before building pipelines, read `tech-stack-preferences.md` for the user's actual stack. Apply these substitutions:
- **Scheduling** → use Inngest from preferences for cron and event-driven pipelines
- **Database** → use Prisma from preferences for data loading (upserts, transactions)
- **Validation** → use Zod from preferences for schema validation at ingestion
- **Monitoring** → use PostHog from preferences for pipeline metrics
- **Queue** → use Inngest from preferences for background job processing
- **File storage** → use Vercel Blob from preferences for intermediate data files

## Integration with Other Skills

- **infrastructure-ops** — For provisioning databases, configuring Inngest, and managing pipeline infrastructure.
- **diagnostic-debugging** — When pipelines fail or produce unexpected results.
- **ci-cd-pipelines** — For deploying pipeline code and running pipeline tests in CI.
- **test-strategy** — For testing data transformation functions and pipeline integration tests.
- **architecture-decisions** — When choosing between pipeline architectures (ETL vs ELT, batch vs streaming).
