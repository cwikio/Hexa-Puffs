---
name: performance-optimization
description: >
  Diagnose and resolve performance bottlenecks in web applications. Activate
  when a user reports slow page loads, high TTFB, layout shifts, memory leaks,
  slow API responses, large bundle sizes, or poor Core Web Vitals scores. Also
  use when asked to "optimize performance", "make this faster", "reduce bundle
  size", "fix slow queries", "improve loading time", or "profile this".
---

## When to Activate

Use this skill when:
- User reports slow page loads, high TTFB, or poor Lighthouse scores
- User asks to optimize performance, reduce bundle size, or speed up queries
- Core Web Vitals (LCP, FID, CLS) are below targets
- API response times exceed acceptable thresholds
- Database queries are slow or generating excessive load

Do NOT use this skill when:
- User is debugging a functional bug, not a speed issue (use diagnostic-debugging)
- User is choosing between architectures for a new project (use architecture-decisions)
- User needs a general code review (use code-quality-patterns)

## Symptom Quick Reference

| Symptom | Likely Cause(s) | Start Here |
|---------|----------------|------------|
| LCP > 2.5s | Large images, render-blocking resources, slow TTFB | [Frontend: LCP](#lcp-largest-contentful-paint) |
| CLS > 0.1 | Missing image dimensions, dynamic content injection, font swap | [Frontend: CLS](#cls-cumulative-layout-shift) |
| High TTFB (> 800ms) | Cold start, slow DB query, no caching, distant region | [Backend: TTFB](#ttfb-time-to-first-byte) |
| Slow API (> 500ms) | N+1 queries, missing index, no caching, large payload | [Backend: API](#slow-api-responses) |
| Large bundle (> 200KB) | Barrel imports, heavy dependencies, missing tree-shaking | [Bundle Size](#bundle-size) |
| Memory leak | Uncleaned intervals/listeners, growing state, closure capture | [Memory](#memory-issues) |
| Janky scrolling | Layout thrashing, expensive re-renders, unvirtualized lists | [Runtime](#runtime-performance) |

## Diagnostic Methodology

**CRITICAL:** Always measure before optimizing. Never guess where the bottleneck is.

1. **Measure** — Get a baseline. Use Lighthouse, Vercel Analytics, or browser DevTools.
2. **Identify** — Pinpoint the specific bottleneck using the diagnostic trees below.
3. **Hypothesize** — Form a theory about what change will improve the metric.
4. **Fix** — Apply one optimization at a time.
5. **Verify** — Re-measure. Did the metric improve? By how much?
6. **Document** — Record the before/after for the team.

## Investigation Toolkit

### Frontend Profiling

```bash
# Lighthouse CI (run from project root)
npx lighthouse https://your-app.vercel.app --output=json --output-path=./report.json

# Bundle analysis with Next.js
ANALYZE=true npx next build
# Requires @next/bundle-analyzer configured in next.config.js

# Check what's in the client bundle
npx next build && ls -la .next/static/chunks/*.js | sort -k5 -rn | head -20
```

**Browser DevTools:**
- **Performance tab** — Record a page load, look for long tasks (>50ms)
- **Network tab** — Sort by size and time, look for large or slow resources
- **Coverage tab** — Shows unused CSS/JS percentage per file
- **Memory tab** — Take heap snapshots before and after an action, compare

### Backend Profiling

```typescript
// Enable Prisma query logging
const prisma = new PrismaClient({
  log: [
    { emit: 'stdout', level: 'query' },
    { emit: 'stdout', level: 'warn' },
  ],
})

// Time a specific operation
const start = performance.now()
const result = await someOperation()
console.log(`[perf] someOperation: ${(performance.now() - start).toFixed(1)}ms`)
```

```bash
# Check Vercel function execution time
vercel logs --follow | grep -i "duration"
```

## Diagnostic Trees

### Frontend Performance

#### LCP (Largest Contentful Paint)

```
LCP > 2.5s
│
├─ Is the LCP element an image?
│  ├─ YES → Check:
│  │        ├─ Using next/image with priority? → Add priority prop to above-fold images
│  │        ├─ Image > 200KB? → Resize, compress, use WebP/AVIF via next/image
│  │        └─ Loading lazily? → Remove lazy loading from LCP image
│  └─ NO → Is TTFB high?
│           ├─ YES → See [TTFB section](#ttfb-time-to-first-byte)
│           └─ NO → Check for render-blocking resources:
│                    ├─ Large CSS file? → Split critical CSS, defer non-critical
│                    ├─ Synchronous scripts? → Add async/defer, move to end of body
│                    └─ Client-side data fetch? → Move to server component or RSC
```

#### CLS (Cumulative Layout Shift)

```
CLS > 0.1
│
├─ Images without dimensions?
│  ├─ YES → Add width/height to img tags or use next/image (auto-sized)
│  └─ NO → Dynamic content injected after load?
│           ├─ YES → Reserve space with min-height or skeleton placeholders
│           └─ NO → Font swap causing layout shift?
│                    ├─ YES → Use font-display: swap with size-adjusted fallback
│                    │        Or use next/font for automatic optimization
│                    └─ NO → Check for conditional client-side rendering
│                             that changes layout (common hydration issue)
```

### Backend Performance

#### TTFB (Time to First Byte)

```
TTFB > 800ms
│
├─ First request only? (Cold start)
│  ├─ YES → Check Vercel function size
│  │        ├─ > 50MB → Reduce dependencies, use edge runtime if possible
│  │        └─ < 50MB → Accept cold start or keep function warm with cron
│  │
│  └─ NO → All requests slow:
│     ├─ Database query time?
│     │  ├─ > 100ms → See [Slow API Responses](#slow-api-responses)
│     │  └─ < 100ms → Check:
│     │           ├─ No caching → Add Cache-Control headers or use unstable_cache
│     │           ├─ Distant DB region → Move DB closer to Vercel function region
│     │           └─ Heavy computation → Move to ISR/SSG or background job
```

#### Slow API Responses

```
API response > 500ms
│
├─ Enable Prisma query logging → Count queries per request
│  ├─ Many queries (N+1)?
│  │  ├─ Loop calling findUnique → Use findMany with where: { id: { in: ids } }
│  │  └─ Missing include → Add include for related data needed in response
│  │
│  ├─ Single slow query?
│  │  ├─ Full table scan → Add @@index on filtered/sorted columns in schema.prisma
│  │  ├─ Large result set → Add pagination (take/skip or cursor-based)
│  │  └─ Complex join → Simplify query, denormalize if needed
│  │
│  └─ Few fast queries?
│     ├─ External API call → Add caching, set timeout, add circuit breaker
│     ├─ Heavy computation → Move to Inngest background job
│     └─ Large response payload → Select only needed fields, compress
```

### Bundle Size

```
Client JS > 200KB (gzipped)
│
├─ Run bundle analysis → Identify largest chunks
│  ├─ Heavy library (moment, lodash full)? → Replace with lighter alternative
│  │  ├─ moment → date-fns or dayjs
│  │  ├─ lodash → lodash-es with tree-shaking or native methods
│  │  └─ Large charting lib → Import specific modules only
│  │
│  ├─ Barrel import pulling entire module?
│  │  └─ import { X } from '@/lib' → import { X } from '@/lib/specific-file'
│  │
│  ├─ Component should be server component?
│  │  └─ Remove 'use client' if component doesn't use hooks/events/browser APIs
│  │
│  └─ Code that could be lazy loaded?
│     └─ Use next/dynamic for below-fold components
│        const Heavy = dynamic(() => import('./Heavy'), { ssr: false })
```

## Root Cause → Fix Map

| Root Cause | Fix | Verify With | Prevention |
|------------|-----|------------|------------|
| N+1 query | Add `include` or batch with `findMany` | Query count drops to 1-2 | Enable Prisma query logging in dev |
| Missing DB index | Add `@@index` in schema, run migration | Query time drops by 10x+ | Review slow query log weekly |
| Unoptimized images | Use `next/image` with width/height, enable AVIF | LCP improves, image size < 100KB | Lint for raw `<img>` tags |
| Client-side fetch for initial data | Move to server component data fetching | TTFB improves, no loading spinner | Default to RSC, only add 'use client' when needed |
| Barrel import | Import from specific file path | Bundle size drops | Use eslint-plugin-no-barrel-files |
| No caching | Add `Cache-Control` or `unstable_cache` | Repeated requests < 50ms | Set caching policy per route |
| Unnecessary re-renders | Add `React.memo`, `useMemo`, `useCallback` | Profiler shows fewer renders | Profile before adding memoization |
| Unvirtualized long list | Use `react-window` or `@tanstack/react-virtual` | Smooth scrolling, low memory | Virtualize any list > 50 items |

## Anti-Patterns

❌ **Anti-pattern: Premature Memoization**
Problem: Adding `React.memo`, `useMemo`, and `useCallback` everywhere "just in case." Memoization has a cost — memory for cached values and comparison overhead on every render. Applied indiscriminately, it can make performance worse while making code harder to read.
✅ Solution: Profile first with React DevTools Profiler. Only memoize when you can measure a re-render taking > 16ms. The majority of components do not need memoization.

❌ **Anti-pattern: Optimizing the Wrong Thing**
Problem: Spending days optimizing a function that takes 5ms when the real bottleneck is a 2-second database query. Without measurement, intuition about performance is almost always wrong.
✅ Solution: Always start with measurement. Use Lighthouse for frontend, query logging for backend. Optimize the slowest thing first — a 50% improvement on a 2s operation saves 1s; a 50% improvement on 5ms saves 2.5ms.

❌ **Anti-pattern: Loading Everything Eagerly**
Problem: Importing all components, all data, and all libraries on initial page load. Every component is in the main bundle. Every API call fires on mount. The page can't paint until everything is ready.
✅ Solution: Load progressively. Use server components for initial data. Lazy-load below-fold components with `next/dynamic`. Defer non-critical API calls. Use Suspense boundaries for loading states.

❌ **Anti-pattern: Caching Without Invalidation Strategy**
Problem: Adding aggressive caching to speed things up, but no plan for when cached data becomes stale. Users see outdated prices, old profile pictures, or missing recent content.
✅ Solution: Every cache entry needs a TTL and an invalidation trigger. Use `revalidatePath` or `revalidateTag` in Next.js for on-demand invalidation. Set `stale-while-revalidate` for content that can be briefly stale.

## Stack Adaptation

Before optimizing, read `tech-stack-preferences.md` for the user's actual stack. Apply these substitutions:
- **Frontend framework** → use Next.js App Router optimization patterns (RSC, streaming, ISR)
- **Image optimization** → use `next/image` component with Vercel image optimization
- **Bundle analysis** → use `@next/bundle-analyzer`
- **Database** → use Prisma query logging and `@@index` directives
- **Caching** → use Vercel edge caching, `unstable_cache`, and Upstash Redis
- **Monitoring** → use Vercel Analytics and PostHog for real user metrics
- **Background jobs** → offload heavy computation to Inngest

## Integration with Other Skills

- **diagnostic-debugging** — When performance degradation is caused by a bug (memory leak from event listener, infinite re-render loop), hand off to diagnostic-debugging for root cause analysis.
- **architecture-decisions** — When optimization requires an architectural change (adding a caching layer, switching to ISR, introducing a CDN), use architecture-decisions for the trade-off analysis.
- **code-quality-patterns** — After optimization, use code-quality-patterns to ensure the optimized code remains maintainable and testable.
- **infrastructure-ops** — When the bottleneck is infrastructure-level (database region, CDN configuration, function memory), reference infrastructure-ops.
