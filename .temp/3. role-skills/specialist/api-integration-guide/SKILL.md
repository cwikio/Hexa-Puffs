---
name: api-integration-guide
description: >
  Design, build, and document APIs and integrations in Next.js applications.
  Activate when asked about API design, server actions, API routes, webhook
  handling, REST patterns, request validation, error responses, pagination,
  rate limiting, or API versioning. Also use when asked to "create an API",
  "add an endpoint", "handle webhooks", "design the API layer", or
  "integrate with an external service".
---

## Quick Reference

| Task | Approach |
|------|----------|
| Mutate data (create/update/delete) | Server Action with Zod validation |
| Fetch data in server component | Async function called directly in `page.tsx` |
| External webhook receiver | API Route (`app/api/webhook/[service]/route.ts`) |
| External API consumption | Server-side fetch in server action or API route |
| Real-time data on client | TanStack Query with `refetchInterval` |
| File upload | API Route with Vercel Blob |
| Public API endpoint | API Route with rate limiting |

## Key Guidelines

**CRITICAL:** Use Server Actions as the default data mutation layer. Only use API routes for webhooks, external consumers, and cases where Server Actions cannot work (file uploads, streaming responses).

**CRITICAL:** Always validate input with Zod `safeParse` in every server action and API route. Never trust client data. Keep the schema co-located with the action.

- Always return `{ data, error }` objects from server actions — never throw for expected failures
- Always verify authentication as the first operation in every action/route
- Always set appropriate Cache-Control headers on API routes
- Never expose internal IDs, stack traces, or database errors in API responses
- Use `NextResponse.json()` for API route responses — not `Response.json()`

## API Patterns

### Server Action (Default for Mutations)

```typescript
// app/server/actions/invoice.ts
'use server'

import { z } from 'zod'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'

const createInvoiceSchema = z.object({
  clientId: z.string().min(1),
  amount: z.number().positive(),
  dueDate: z.string().datetime(),
})

export async function createInvoice(formData: FormData) {
  const { userId } = await auth()
  if (!userId) return { data: null, error: 'Unauthorized' }

  const result = createInvoiceSchema.safeParse({
    clientId: formData.get('clientId'),
    amount: Number(formData.get('amount')),
    dueDate: formData.get('dueDate'),
  })

  if (!result.success) {
    return { data: null, error: result.error.flatten() }
  }

  const invoice = await prisma.invoice.create({
    data: {
      ...result.data,
      userId,
      status: 'DRAFT',
    },
  })

  return { data: invoice, error: null }
}
```

### API Route (Webhooks and External Consumers)

```typescript
// app/api/webhook/stripe/route.ts
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  switch (event.type) {
    case 'checkout.session.completed':
      // Handle successful payment
      break
    case 'invoice.payment_failed':
      // Handle failed payment
      break
  }

  return NextResponse.json({ received: true })
}
```

### Server-Side Data Fetching (Read Operations)

```typescript
// app/server/queries/invoice.ts
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'

export async function getInvoices() {
  const { userId } = await auth()
  if (!userId) return []

  return prisma.invoice.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      amount: true,
      status: true,
      dueDate: true,
      client: { select: { name: true } },
    },
  })
}

// Usage in page.tsx (Server Component)
export default async function InvoicesPage() {
  const invoices = await getInvoices()
  return <InvoiceTable data={invoices} />
}
```

## Core Features

### Input Validation

Every endpoint validates input as its first operation after auth.

```typescript
// Pattern: Zod schema co-located with the action
const updateProfileSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  bio: z.string().max(500).optional(),
})

// Pattern: Validate path/query parameters in API routes
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = z.string().uuid().safeParse(params.id)
  if (!id.success) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
  }
  // proceed with id.data
}
```

### Error Response Format

Consistent error format across all endpoints:

```typescript
// Success
{ data: { id: "...", name: "..." }, error: null }

// Validation error
{ data: null, error: { fieldErrors: { email: ["Invalid email"] } } }

// Auth error
{ data: null, error: "Unauthorized" }

// Not found
{ data: null, error: "Invoice not found" }
```

For API routes, use standard HTTP status codes:

| Status | When |
|--------|------|
| 200 | Success (GET, PUT, PATCH) |
| 201 | Created (POST that creates a resource) |
| 400 | Validation error, malformed request |
| 401 | Not authenticated |
| 403 | Authenticated but not authorized |
| 404 | Resource not found |
| 429 | Rate limited |
| 500 | Unexpected server error (log it, return generic message) |

### Pagination

```typescript
// Cursor-based pagination (preferred for large datasets)
const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().min(1).max(100).default(20),
})

export async function getInvoices(input: z.infer<typeof paginationSchema>) {
  const items = await prisma.invoice.findMany({
    take: input.limit + 1, // Fetch one extra to detect hasMore
    cursor: input.cursor ? { id: input.cursor } : undefined,
    orderBy: { createdAt: 'desc' },
  })

  const hasMore = items.length > input.limit
  const data = hasMore ? items.slice(0, -1) : items

  return {
    data,
    nextCursor: hasMore ? data[data.length - 1].id : null,
  }
}
```

### Rate Limiting

```typescript
// Using @upstash/ratelimit in an API route
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '10 s'), // 10 requests per 10 seconds
})

export async function POST(req: NextRequest) {
  const ip = req.ip ?? '127.0.0.1'
  const { success } = await ratelimit.limit(ip)

  if (!success) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429 })
  }

  // proceed with request
}
```

### Webhook Handling

```typescript
// Pattern: Verify signature → parse event → handle → acknowledge
export async function POST(req: NextRequest) {
  // 1. Read raw body (before any parsing)
  const body = await req.text()

  // 2. Verify signature from the webhook provider
  const isValid = verifyWebhookSignature(body, req.headers)
  if (!isValid) return NextResponse.json({ error: 'Invalid' }, { status: 400 })

  // 3. Parse the event
  const event = JSON.parse(body)

  // 4. Handle the event (idempotently — webhooks can be retried)
  await handleWebhookEvent(event)

  // 5. Acknowledge receipt (return 200 quickly)
  return NextResponse.json({ received: true })
}
```

**IMPORTANT:** Webhook handlers must be idempotent. The same event may be delivered multiple times. Use the event ID to deduplicate.

## Gotchas

- **Server Actions cannot stream responses.** For streaming (SSE, large file downloads), use API routes.
- **Server Actions run on the server but are called from the client.** They are NOT server-only — a malicious client can call any exported server action with any arguments. Always validate and authorize.
- **`req.json()` can only be called once.** If you need the body for both signature verification and parsing, read it as text first with `req.text()`, then `JSON.parse()`.
- **Vercel serverless functions have a 10s default timeout** (30s on Pro). Long operations must be offloaded to Inngest background jobs.
- **FormData numbers come as strings.** Always convert with `Number()` before Zod validation if the schema expects a number.

## Anti-Patterns

❌ **Anti-pattern: API Route for Everything**
Problem: Creating API routes for data mutations that are only called from the Next.js frontend. Each route needs manual auth handling, CSRF protection, and response formatting that Server Actions handle automatically.
✅ Solution: Use Server Actions for frontend mutations. Reserve API routes for webhooks, external consumers, and cases requiring streaming/file uploads.

❌ **Anti-pattern: No Input Validation**
Problem: Trusting that the client sends well-formed data. Directly passing `req.body` to Prisma queries. A malformed request causes a database error with a stack trace leaked to the client.
✅ Solution: Validate every input with Zod `safeParse` before any business logic. Return the validation error to the client in a structured format.

❌ **Anti-pattern: Throwing Exceptions for Business Logic**
Problem: Using `throw new Error('User not found')` in server actions. The caller must wrap every action call in try/catch. Error types are lost — is it a validation error, auth error, or server error?
✅ Solution: Return `{ data, error }` objects. The caller checks `result.error` — no try/catch needed. The error type is explicit in the structure.

## Stack Adaptation

Before designing APIs, read `tech-stack-preferences.md` for the user's actual stack. Apply these substitutions:
- **Data mutations** → use Server Actions from preferences (not REST endpoints)
- **Validation** → use Zod with `safeParse` from preferences
- **Auth** → use Clerk from preferences (`auth()`, `getAuth()`)
- **Database** → use Prisma from preferences
- **Rate limiting** → use @upstash/ratelimit from preferences
- **Background jobs** → use Inngest from preferences for long-running operations
- **File uploads** → use Vercel Blob from preferences
- **Payments** → use Stripe webhooks from preferences

## Integration with Other Skills

- **architecture-decisions** — When choosing between API patterns (Server Actions vs tRPC vs REST) for a specific use case.
- **security-assessment** — For reviewing API security: input validation, auth, rate limiting, and data exposure.
- **codebase-conventions** — For where to place API routes, server actions, and query functions in the project structure.
- **code-quality-patterns** — For testing API endpoints and server actions.
