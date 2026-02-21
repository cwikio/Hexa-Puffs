---
name: payment-engine
description: >
  Implement payment flows, subscription billing, and entitlement gating with
  Stripe or Clerk Billing. Activate when asked about checkout integration,
  subscription management, billing portal, payment webhooks, pricing models,
  plan upgrades/downgrades, entitlement checks, Stripe database sync, or
  Clerk Billing setup. Also use when asked to "add payments", "set up billing",
  "create a checkout flow", "handle subscriptions", "gate features by plan",
  "sync Stripe data", or "use Clerk Billing".
---

## Quick Reference

**Choose your approach first:** See [Clerk Billing vs Stripe Direct](#clerk-billing-vs-stripe-direct) below.

| Task | Stripe Direct | Clerk Billing |
|------|--------------|---------------|
| Pricing page | Custom UI + Stripe Checkout | `<PricingTable />` component |
| Recurring subscription | Product + Price + Checkout Session | Plan in Clerk Dashboard + `<PricingTable />` |
| One-time payment | Checkout Session (`mode: 'payment'`) | Not supported — use Stripe |
| Customer billing portal | `stripe.billingPortal.sessions.create()` | Built into `<UserProfile />` |
| Plan upgrade/downgrade | `stripe.subscriptions.update()` | Handled by Clerk automatically |
| Cancel subscription | `stripe.subscriptions.update()` | Handled by Clerk automatically |
| Sync to database | Webhook handler → Prisma upsert | Not needed — Clerk stores state |
| Check entitlement | Query local DB subscription status | `has({ plan: 'pro' })` or `<Protect plan="pro">` |
| Handle failed payment | Webhook `invoice.payment_failed` | Clerk handles dunning |
| Test payments locally | `stripe listen --forward-to ...` | Clerk dev gateway (shared test Stripe) |

## Key Guidelines

**CRITICAL:** Never check entitlements by calling the Stripe API on every request. Sync subscription state to your local database via webhooks and query locally. Stripe API calls are slow, rate-limited, and unnecessary for access checks.

**CRITICAL:** Always verify webhook signatures before processing any event. Never trust the request body without signature verification — attackers can forge webhook payloads.

- Always use Checkout Sessions as the primary payment integration — not the legacy Charges API or raw PaymentIntents for standard flows
- Always handle webhook idempotency — the same event can be delivered multiple times. Deduplicate by `event.id`
- Always use Stripe test mode and the Stripe CLI for local development — never test against live keys
- Never store card numbers, CVVs, or raw payment credentials — Stripe handles PCI compliance
- Always create a Stripe Customer for each user at signup — link it to your local user record via `stripeCustomerId`
- When using Clerk Billing, entitlement checks use `has({ plan })` directly — no local database sync needed

## Clerk Billing vs Stripe Direct

Choose based on your billing complexity:

| Factor | Clerk Billing | Stripe Direct |
|--------|--------------|---------------|
| Setup effort | Minimal — dashboard + components | Significant — webhooks, DB sync, custom UI |
| Pricing page | `<PricingTable />` (zero code) | Build custom or use Stripe Checkout redirect |
| Entitlement checks | `has({ plan: 'pro' })` built into Clerk auth | Query local DB synced via webhooks |
| Subscription management | Built into `<UserProfile />` | Stripe Customer Portal or custom UI |
| One-time payments | Not supported | Full support |
| Metered/usage-based billing | Not supported | Full support |
| Multi-currency | USD only | Full support |
| Tax/VAT | Not supported | Stripe Tax integration |
| Free trials | Supported | Full support |
| B2B (org-level billing) | `<PricingTable for="organization" />` | Custom implementation |
| Webhook complexity | Optional — Clerk manages state | Required — you sync state to DB |
| Cost | 0.7% per transaction + Stripe fees | Stripe fees only |
| Status | Beta (APIs may change) | Stable |

**Use Clerk Billing when:** You need straightforward subscription plans for a SaaS app, want minimal code, and are already using Clerk for auth. Ideal for B2C and B2B apps where plans map to feature access.

**Use Stripe Direct when:** You need one-time payments, metered billing, multi-currency, tax/VAT calculation, or full control over the checkout and billing experience.

**You can use both:** Clerk Billing for subscription management and Stripe directly for one-time purchases, add-ons, or marketplace payments that Clerk Billing doesn't cover.

## Core Operations — Clerk Billing

### Setting Up Plans

Create plans in the Clerk Dashboard (Billing → Subscription Plans):

1. Enable Billing in your Clerk application settings
2. Connect your Stripe account (production) or use the Clerk dev gateway (development)
3. Create plans with monthly/annual pricing
4. Attach Features to plans (used for entitlement checks)

Plans are managed entirely in the Clerk Dashboard — no code needed for plan creation or price management.

### Pricing Page

```tsx
// app/pricing/page.tsx
import { PricingTable } from '@clerk/nextjs'

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="mb-8 text-3xl font-bold">Pricing</h1>
      <PricingTable />
    </div>
  )
}
```

For B2B (organization-level billing):

```tsx
<PricingTable for="organization" />
```

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `for` | `'user' \| 'organization'` | Who the plans are for (default: `'user'`) |
| `ctaPosition` | `'top' \| 'bottom'` | CTA button placement (default: `'bottom'`) |
| `collapseFeatures` | `boolean` | Collapse feature lists (default: `false`) |
| `newSubscriptionRedirectUrl` | `string` | Redirect after successful checkout |

### Entitlement Checks

Clerk Billing integrates directly with Clerk's `has()` auth helper — no database sync needed.

**Server-side (Server Components, Server Actions, API Routes):**

```typescript
// Check plan access in a server component
import { auth } from '@clerk/nextjs/server'

export default async function DashboardPage() {
  const { has } = await auth()

  const isPro = has({ plan: 'pro' })
  const hasAiFeature = has({ feature: 'ai-assistant' })

  return (
    <div>
      <h1>Dashboard</h1>
      {isPro && <ProDashboard />}
      {hasAiFeature && <AiAssistant />}
    </div>
  )
}
```

```typescript
// Check plan access in a server action
'use server'

import { auth } from '@clerk/nextjs/server'

export async function generateReport() {
  const { has, userId } = await auth()
  if (!userId) return { data: null, error: 'Unauthorized' }

  if (!has({ plan: 'pro' })) {
    return { data: null, error: 'Upgrade to Pro to generate reports.' }
  }

  // proceed with report generation...
}
```

**Client-side (React components):**

```tsx
// Gate UI elements with <Protect>
import { Protect } from '@clerk/nextjs'

export function FeatureSection() {
  return (
    <div>
      <h2>Features</h2>

      {/* Show to all users */}
      <BasicFeatures />

      {/* Show only to users on the 'pro' plan */}
      <Protect
        plan="pro"
        fallback={<UpgradePrompt />}
      >
        <ProFeatures />
      </Protect>

      {/* Gate by specific feature, not plan */}
      <Protect
        feature="ai-assistant"
        fallback={<p>AI features require a Pro plan.</p>}
      >
        <AiAssistant />
      </Protect>
    </div>
  )
}
```

### Subscription Management

Clerk handles subscription management through its built-in `<UserProfile />` component — users can view, upgrade, downgrade, and cancel their plans without any custom code.

For programmatic access to plans:

```tsx
'use client'

import { usePlans } from '@clerk/nextjs'

export function PlansList() {
  const { data: plans, isLoading } = usePlans({ for: 'user' })

  if (isLoading) return <p>Loading plans...</p>

  return (
    <ul>
      {plans?.map((plan) => (
        <li key={plan.id}>
          <strong>{plan.name}</strong> — ${plan.amountFormatted}/mo
        </li>
      ))}
    </ul>
  )
}
```

### Clerk Billing Webhooks (Optional)

Clerk Billing manages state internally, so webhooks are optional. Use them only when you need to react to billing events in your backend (e.g., sending custom emails, updating external systems).

Key event types:

| Event | When |
|-------|------|
| `subscription.active` | Subscription becomes active |
| `subscription.pastDue` | Payment failed |
| `subscriptionItem.active` | Plan item activated after payment |
| `subscriptionItem.canceled` | Plan canceled (access until period end) |
| `subscriptionItem.ended` | Plan fully ended |
| `paymentAttempt.updated` | Payment resolved (paid or failed) |

**Gotchas:**
- Clerk Billing is in Beta — pin your `@clerk/nextjs` version to avoid breaking changes
- One-time payments and metered billing are not supported — use Stripe directly for those
- USD only — no multi-currency support
- No tax/VAT calculation — handle externally if needed
- Clerk dev gateway uses a shared test Stripe account — no Stripe account needed for development
- B2B billing: custom Permissions only work when their associated Feature is in the org's active plan

## Core Operations — Stripe Direct

### Product and Price Setup

Define your plans in the Stripe Dashboard or programmatically. Every billable item is a Product with one or more Prices attached.

```typescript
// scripts/seed-stripe-plans.ts — Run once to set up plans
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

async function seedPlans() {
  const product = await stripe.products.create({
    name: 'Pro Plan',
    description: 'Full access to all features',
  })

  // Monthly price
  await stripe.prices.create({
    product: product.id,
    unit_amount: 2900, // $29.00 in cents
    currency: 'usd',
    recurring: { interval: 'month' },
    lookup_key: 'pro_monthly', // Use lookup keys, not hardcoded price IDs
  })

  // Annual price (discount)
  await stripe.prices.create({
    product: product.id,
    unit_amount: 29000, // $290.00/year
    currency: 'usd',
    recurring: { interval: 'year' },
    lookup_key: 'pro_annual',
  })
}
```

**Use `lookup_key` instead of hardcoding price IDs.** Lookup keys let you reference prices by name (`pro_monthly`) across environments without managing different IDs for test vs live mode.

```typescript
// Resolve price by lookup key at runtime
const prices = await stripe.prices.list({
  lookup_keys: ['pro_monthly', 'pro_annual'],
  active: true,
})
```

**Gotchas:**
- Price amounts are in the smallest currency unit (cents for USD) — `2900` = $29.00
- Products and Prices are immutable in Stripe — to change a price, create a new one and archive the old
- Lookup keys must be unique within your Stripe account — use a clear naming convention like `{plan}_{interval}`

### Checkout Flow

Use Stripe Checkout Sessions for both one-time payments and subscriptions. The session handles payment method collection, validation, and 3D Secure authentication.

```typescript
// app/server/actions/checkout.ts
'use server'

import { z } from 'zod'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

const checkoutSchema = z.object({
  lookupKey: z.enum(['pro_monthly', 'pro_annual']),
})

export async function createCheckoutSession(formData: FormData) {
  const { userId } = await auth()
  if (!userId) return { data: null, error: 'Unauthorized' }

  const input = checkoutSchema.safeParse({
    lookupKey: formData.get('lookupKey'),
  })
  if (!input.success) return { data: null, error: input.error.flatten() }

  // Get or create Stripe customer linked to this user
  const user = await prisma.user.findUniqueOrThrow({
    where: { clerkId: userId },
    select: { stripeCustomerId: true, email: true },
  })

  let customerId = user.stripeCustomerId
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { clerkId: userId },
    })
    customerId = customer.id
    await prisma.user.update({
      where: { clerkId: userId },
      data: { stripeCustomerId: customerId },
    })
  }

  // Resolve price from lookup key
  const prices = await stripe.prices.list({
    lookup_keys: [input.data.lookupKey],
    active: true,
  })
  if (prices.data.length === 0) return { data: null, error: 'Price not found' }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: prices.data[0].id, quantity: 1 }],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing?success=true`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing?canceled=true`,
    subscription_data: {
      metadata: { clerkId: userId },
    },
  })

  return { data: { url: session.url }, error: null }
}
```

**Gotchas:**
- Always attach the Stripe `customer` to the session — this links the subscription to your user
- Use `success_url` and `cancel_url` for redirect — do NOT rely on the success page to provision access (use webhooks instead)
- For embedded checkout, use `ui_mode: 'embedded'` and return `client_secret` instead of `url`

### Subscription Lifecycle

```typescript
// app/server/actions/subscription.ts
'use server'

import { z } from 'zod'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

// Upgrade or downgrade plan
const changePlanSchema = z.object({
  newLookupKey: z.enum(['pro_monthly', 'pro_annual']),
})

export async function changePlan(formData: FormData) {
  const { userId } = await auth()
  if (!userId) return { data: null, error: 'Unauthorized' }

  const input = changePlanSchema.safeParse({
    newLookupKey: formData.get('newLookupKey'),
  })
  if (!input.success) return { data: null, error: input.error.flatten() }

  const subscription = await prisma.subscription.findFirst({
    where: { userId, status: { in: ['active', 'trialing'] } },
  })
  if (!subscription) return { data: null, error: 'No active subscription' }

  const prices = await stripe.prices.list({
    lookup_keys: [input.data.newLookupKey],
    active: true,
  })
  if (prices.data.length === 0) return { data: null, error: 'Price not found' }

  const updated = await stripe.subscriptions.update(
    subscription.stripeSubscriptionId,
    {
      items: [{
        id: subscription.stripeItemId,
        price: prices.data[0].id,
      }],
      proration_behavior: 'always_invoice', // Charge/credit immediately
    }
  )

  return { data: { subscriptionId: updated.id }, error: null }
}

// Cancel subscription (at end of billing period)
export async function cancelSubscription() {
  const { userId } = await auth()
  if (!userId) return { data: null, error: 'Unauthorized' }

  const subscription = await prisma.subscription.findFirst({
    where: { userId, status: 'active' },
  })
  if (!subscription) return { data: null, error: 'No active subscription' }

  await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    cancel_at_period_end: true,
  })

  return { data: { cancelAt: subscription.currentPeriodEnd }, error: null }
}

// Reactivate a subscription that was set to cancel
export async function reactivateSubscription() {
  const { userId } = await auth()
  if (!userId) return { data: null, error: 'Unauthorized' }

  const subscription = await prisma.subscription.findFirst({
    where: { userId, status: 'active', cancelAtPeriodEnd: true },
  })
  if (!subscription) return { data: null, error: 'No subscription to reactivate' }

  await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    cancel_at_period_end: false,
  })

  return { data: { reactivated: true }, error: null }
}
```

**Gotchas:**
- `proration_behavior: 'always_invoice'` charges the difference immediately on upgrade. Use `'create_prorations'` to defer to next invoice
- `cancel_at_period_end: true` keeps access until the period ends. `stripe.subscriptions.cancel()` revokes access immediately
- Store the `stripeItemId` (subscription item ID) locally — you need it for plan changes

### Webhook Event Handling

The webhook handler is the source of truth for subscription state. Never update subscription status from client-side callbacks.

```typescript
// app/api/webhook/stripe/route.ts
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { prisma } from '@/lib/prisma'

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

  // Idempotency: skip already-processed events
  const existing = await prisma.webhookEvent.findUnique({
    where: { stripeEventId: event.id },
  })
  if (existing) {
    return NextResponse.json({ received: true })
  }
  await prisma.webhookEvent.create({
    data: { stripeEventId: event.id, type: event.type },
  })

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      await prisma.subscription.upsert({
        where: { stripeSubscriptionId: sub.id },
        create: {
          stripeSubscriptionId: sub.id,
          stripeCustomerId: sub.customer as string,
          stripeItemId: sub.items.data[0].id,
          stripePriceId: sub.items.data[0].price.id,
          status: sub.status,
          currentPeriodStart: new Date(sub.current_period_start * 1000),
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          userId: await getUserIdByCustomer(sub.customer as string),
        },
        update: {
          stripeItemId: sub.items.data[0].id,
          stripePriceId: sub.items.data[0].price.id,
          status: sub.status,
          currentPeriodStart: new Date(sub.current_period_start * 1000),
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        },
      })
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      await prisma.subscription.update({
        where: { stripeSubscriptionId: sub.id },
        data: { status: 'canceled' },
      })
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      if (invoice.subscription) {
        await prisma.subscription.update({
          where: { stripeSubscriptionId: invoice.subscription as string },
          data: { status: 'past_due' },
        })
        // Notify user — offload to Inngest for email sending
      }
      break
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice
      if (invoice.subscription) {
        await prisma.subscription.update({
          where: { stripeSubscriptionId: invoice.subscription as string },
          data: { status: 'active' },
        })
      }
      break
    }
  }

  return NextResponse.json({ received: true })
}

async function getUserIdByCustomer(stripeCustomerId: string): Promise<string> {
  const user = await prisma.user.findFirstOrThrow({
    where: { stripeCustomerId },
    select: { id: true },
  })
  return user.id
}
```

**Gotchas:**
- Stripe timestamps are Unix seconds, not milliseconds — multiply by 1000 for `new Date()`
- `subscription.customer` can be a string ID or expanded object — always cast to `string`
- Webhook handlers must respond within 30 seconds — offload heavy work to Inngest
- In development, use `stripe listen --forward-to localhost:3000/api/webhook/stripe` to forward events

### Database Schema and Sync

```prisma
// prisma/schema.prisma — Payment-related models

model User {
  id               String         @id @default(cuid())
  clerkId          String         @unique
  email            String
  stripeCustomerId String?        @unique
  subscriptions    Subscription[]
}

model Subscription {
  id                     String   @id @default(cuid())
  userId                 String
  user                   User     @relation(fields: [userId], references: [id])
  stripeSubscriptionId   String   @unique
  stripeCustomerId       String
  stripeItemId           String
  stripePriceId          String
  status                 String   // active, trialing, past_due, canceled, incomplete
  currentPeriodStart     DateTime
  currentPeriodEnd       DateTime
  cancelAtPeriodEnd      Boolean  @default(false)
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  @@index([userId])
  @@index([stripeCustomerId])
}

model WebhookEvent {
  id             String   @id @default(cuid())
  stripeEventId  String   @unique
  type           String
  createdAt      DateTime @default(now())
}
```

**Gotchas:**
- Index `stripeCustomerId` on both User and Subscription — webhook lookups query by this field
- The `WebhookEvent` table is for idempotency — periodically clean up entries older than 30 days
- Store `status` as a string, not an enum — Stripe may add new statuses without notice

### Entitlement and Feature Gating

Check plan access by querying your local database, not the Stripe API.

```typescript
// lib/entitlements.ts

import { prisma } from '@/lib/prisma'

// Plan → features mapping (single source of truth)
const PLAN_FEATURES = {
  free: {
    maxProjects: 3,
    maxStorageMb: 100,
    aiFeatures: false,
    prioritySupport: false,
  },
  pro: {
    maxProjects: -1, // unlimited
    maxStorageMb: 10_000,
    aiFeatures: true,
    prioritySupport: true,
  },
} as const

type PlanName = keyof typeof PLAN_FEATURES

// Map Stripe price lookup keys to plan names
const PRICE_TO_PLAN: Record<string, PlanName> = {
  pro_monthly: 'pro',
  pro_annual: 'pro',
}

export async function getUserPlan(userId: string): Promise<PlanName> {
  const subscription = await prisma.subscription.findFirst({
    where: {
      userId,
      status: { in: ['active', 'trialing'] },
    },
    select: { stripePriceId: true },
  })

  if (!subscription) return 'free'

  // Resolve price lookup key from Stripe price ID
  // Cache this mapping — prices don't change often
  return PRICE_TO_PLAN[subscription.stripePriceId] ?? 'free'
}

export async function checkFeatureAccess(
  userId: string,
  feature: keyof (typeof PLAN_FEATURES)['pro']
): Promise<boolean> {
  const plan = await getUserPlan(userId)
  const features = PLAN_FEATURES[plan]
  const value = features[feature]
  return typeof value === 'boolean' ? value : value !== 0
}

export function getPlanLimits(plan: PlanName) {
  return PLAN_FEATURES[plan]
}
```

```typescript
// Usage in a server action
export async function createProject(formData: FormData) {
  const { userId } = await auth()
  if (!userId) return { data: null, error: 'Unauthorized' }

  const plan = await getUserPlan(userId)
  const limits = getPlanLimits(plan)

  if (limits.maxProjects !== -1) {
    const count = await prisma.project.count({ where: { userId } })
    if (count >= limits.maxProjects) {
      return { data: null, error: 'Project limit reached. Upgrade to Pro.' }
    }
  }

  // proceed with creation...
}
```

### Customer Portal

Let users manage their subscription, update payment methods, and view invoices via Stripe's hosted portal.

```typescript
// app/server/actions/billing.ts
'use server'

import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function createPortalSession() {
  const { userId } = await auth()
  if (!userId) return { data: null, error: 'Unauthorized' }

  const user = await prisma.user.findUniqueOrThrow({
    where: { clerkId: userId },
    select: { stripeCustomerId: true },
  })

  if (!user.stripeCustomerId) {
    return { data: null, error: 'No billing account' }
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing`,
  })

  return { data: { url: session.url }, error: null }
}
```

**Gotchas:**
- Configure the portal in Stripe Dashboard (Settings → Billing → Customer Portal) — enable plan switching, cancellation, payment method updates
- The portal URL is single-use — create a new session for each visit

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|---------|
| Webhook returns 400 | Signature verification failing | Ensure `STRIPE_WEBHOOK_SECRET` matches the endpoint (different for CLI vs Dashboard webhooks) |
| Duplicate subscription records | Same webhook delivered twice | Implement idempotency via `WebhookEvent` table dedup |
| User has access after cancellation | Status not synced | Handle `customer.subscription.deleted` event, check `cancel_at_period_end` |
| Checkout succeeds but no subscription in DB | Webhook endpoint not configured | Verify webhook endpoint URL in Stripe Dashboard, check server logs |
| Portal shows wrong plans | Portal configuration mismatch | Update portal settings in Stripe Dashboard to match current products/prices |
| `customer` field is an object, not string | Stripe expanded the customer | Cast with `sub.customer as string` or use `typeof sub.customer === 'string' ? sub.customer : sub.customer.id` |
| Test webhooks not received locally | Stripe CLI not running | Run `stripe listen --forward-to localhost:3000/api/webhook/stripe` |

## Anti-Patterns

❌ **Anti-pattern: Calling Stripe API for Every Entitlement Check**
Problem: Checking `stripe.subscriptions.retrieve()` on every page load to determine user access. Adds 200-500ms latency, hits rate limits at scale, and breaks the app if Stripe is down.
✅ Solution: Sync subscription state to your local database via webhooks. Query `prisma.subscription.findFirst()` for access checks — sub-millisecond, no external dependency.

❌ **Anti-pattern: Provisioning Access on Checkout Success Page**
Problem: The checkout success URL triggers access provisioning. If the user closes the tab early, refreshes, or the redirect fails, they've paid but have no access.
✅ Solution: Provision access exclusively via webhooks (`checkout.session.completed`, `customer.subscription.created`). The success page is cosmetic — it shows a confirmation message, not business logic.

❌ **Anti-pattern: Hardcoding Stripe Price IDs**
Problem: Using `price_1ABC123` directly in code. Different IDs exist in test vs live mode, and recreating a price gives a new ID. Code breaks across environments.
✅ Solution: Use `lookup_key` on prices and resolve with `stripe.prices.list({ lookup_keys: [...] })`. Lookup keys are stable across environments.

❌ **Anti-pattern: No Webhook Idempotency**
Problem: The webhook handler processes every incoming event without deduplication. Stripe retries failed deliveries, and network issues can cause duplicate delivery. The app creates duplicate subscriptions or sends duplicate emails.
✅ Solution: Store processed event IDs in a `WebhookEvent` table. Check for existence before processing. Skip duplicates.

## Stack Adaptation

Before implementing, read `tech-stack-preferences.md` for the user's actual stack. Apply these substitutions:
- **Payment approach** → check preferences for Stripe (direct) vs Clerk Billing — use the decision framework above to choose
- **Clerk Billing** → use `<PricingTable />`, `<Protect plan="...">`, `has({ plan, feature })`, `usePlans()` from preferences
- **Stripe direct** → use Stripe Checkout Sessions, Billing Portal, webhook sync from preferences
- **Database** → use Prisma with PostgreSQL from preferences (Stripe direct only — Clerk Billing manages its own state)
- **Auth** → use Clerk from preferences for user identity (both approaches)
- **Background jobs** → use Inngest from preferences for post-webhook processing (Stripe direct)
- **Data mutations** → use Server Actions from preferences
- **Validation** → use Zod with `safeParse` from preferences
- **Analytics** → use PostHog from preferences for subscription event tracking
- **Webhooks** → Stripe webhooks via API routes (Stripe direct), Clerk webhooks via Svix (Clerk Billing)

## Integration with Other Skills

- **api-integration-guide** — For webhook handler structure and API route patterns.
- **security-assessment** — For payment security review, PCI considerations, and Stripe key management.
- **infrastructure-ops** — For Stripe environment variables and webhook endpoint configuration.
- **diagnostic-debugging** — For debugging payment flow failures (checkout, webhooks, subscription sync).
- **codebase-conventions** — For where to place payment-related files in the project structure.
