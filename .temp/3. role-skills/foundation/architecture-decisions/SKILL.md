---
name: architecture-decisions
description: >
  Guide structured architectural decisions for software systems. Activate when
  the user asks about architecture decisions, should I use X or Y, what's the
  best approach for a system design problem, trade-off analysis between
  competing options, or technology selection for a project. Covers pattern
  selection, library/framework choices, API design, data layer decisions,
  deployment architecture, and system decomposition.
---

## When to Activate

Use this skill when:
- User asks "should I use X or Y?" for any architectural choice
- User needs to choose between competing patterns (monolith vs microservices, REST vs GraphQL vs tRPC)
- User asks about system design, API design, or data modeling approaches
- User requests trade-off analysis between technology options
- User needs to select a library, framework, database, or hosting strategy
- User asks "what's the best approach for..." any structural concern
- User is decomposing a system into components or services

Do NOT use this skill when:
- User needs help debugging existing code (use diagnostic-debugging)
- User asks about code style, naming, or file organization (use codebase-conventions)
- User wants a code review or refactoring guidance (use code-quality-patterns)
- User needs step-by-step deployment procedures (use ci-cd-pipelines)
- The decision is purely cosmetic (UI color, font choice) with no architectural impact

## Stack Adaptation

Before executing, read `tech-stack-preferences.md` for the user's actual stack. Apply these substitutions:
- Framework recommendations -> check which framework the user already uses
- Database advice -> use the ORM and database listed in preferences
- Hosting/deployment -> reference the user's actual hosting provider
- Testing recommendations -> use the test framework from preferences
- API style -> respect the user's existing API patterns (Server Actions, REST, etc.)

If the user's stack already constrains a decision, say so explicitly rather than presenting options they cannot use.

## Core Concepts

### Taxonomy of Architectural Decisions

Architectural decisions fall into 4 categories. Identify which category applies before analyzing:

**Structural Decisions** -- How the system is organized
- Monolith vs modular monolith vs microservices
- Monorepo vs polyrepo
- Layer boundaries (presentation, domain, data)
- Module decomposition and dependency direction
- Trade-off: Simplicity and cohesion vs independent deployability and team autonomy

**Technology Decisions** -- Which tools and libraries to use
- Framework selection (Next.js vs Remix vs Astro)
- Library selection (state management, form handling, data fetching)
- Language and runtime choices
- Build tooling and bundler selection
- Trade-off: Team familiarity and ecosystem maturity vs technical capability and performance

**Integration Decisions** -- How components communicate
- API style: REST vs GraphQL vs tRPC vs Server Actions
- Synchronous vs asynchronous communication
- Event-driven vs request-response
- Service mesh and API gateway patterns
- Trade-off: Coupling reduction and flexibility vs simplicity and debuggability

**Data Decisions** -- Storage, caching, and consistency
- Database type: relational vs document vs key-value vs graph
- Caching strategy: CDN, application cache, database cache
- Consistency model: strong vs eventual
- Data ownership and bounded contexts
- Trade-off: Query flexibility and consistency vs write performance and horizontal scaling

### Comparison Matrix: Decision Factors

Use these 5 factors to evaluate any architectural option. Score each High/Medium/Low:

| Factor | Definition | Why It Matters |
|--------|-----------|----------------|
| Reversibility | How easily can this decision be changed later? | Irreversible decisions need more analysis. Reversible ones can be decided fast. |
| Team Familiarity | Does the team know this technology? | Unfamiliar tech adds ramp-up time, increases bugs, and slows delivery for months. |
| Scalability Ceiling | At what load does this approach break? | Premature scaling wastes effort, but hitting a ceiling mid-growth is worse. |
| Complexity Cost | How much accidental complexity does this add? | Every abstraction has a tax. Microservices add network complexity. ORMs add query opacity. |
| Maintenance Burden | What is the ongoing cost of this choice? | The initial build is 20% of lifetime cost. Maintenance is 80%. |

### Factor Weights by Project Stage

Not all factors matter equally at every stage:

| Factor | MVP / Early Stage | Growth Stage | Mature / Enterprise |
|--------|-------------------|--------------|---------------------|
| Reversibility | High | Medium | Low |
| Team Familiarity | High | Medium | Medium |
| Scalability Ceiling | Low | High | High |
| Complexity Cost | High | Medium | Low |
| Maintenance Burden | Low | High | High |

## Decision Framework

Follow this process for every architectural decision. Do not skip steps.

### Step 1: Classify the Decision

Determine the category (Structural, Technology, Integration, Data) and the reversibility:

- **One-way door** (hard to reverse): Database engine, primary language, core framework, service boundaries. Spend more time here.
- **Two-way door** (easy to reverse): Library choice, caching layer, state management approach, API serialization format. Decide quickly, revisit if wrong.

If the decision is a two-way door, recommend the simplest option that meets requirements. Do not over-analyze.

### Step 2: Identify the Forces

List the constraints and quality attributes that shape this decision:

1. **Hard constraints**: Budget, team size, existing infrastructure, regulatory requirements, timeline
2. **Quality attributes**: What does the system optimize for? Pick the top 2-3 from: performance, reliability, security, developer experience, time-to-market, cost-efficiency, scalability
3. **Business drivers**: Growth trajectory, user base size, compliance requirements, competitive pressure

### Step 3: Generate 2-3 Options

Always present at least 2 viable options. Never present only 1 option -- that is not a decision, it is a directive.

For each option, state:
- What it is (1 sentence)
- Primary advantage (the reason you would pick this)
- Primary risk (the reason you would not pick this)
- When it becomes the wrong choice (the condition that would trigger migration away)

### Step 4: Evaluate with the Comparison Matrix

Score each option against the 5 factors (Reversibility, Team Familiarity, Scalability Ceiling, Complexity Cost, Maintenance Burden). Apply the factor weights for the project's current stage.

### Step 5: Recommend and Document

State the recommendation explicitly. Then document:
- **Decision**: What was chosen
- **Rationale**: Why this option over others (reference the forces and factor scores)
- **Consequences**: What follows from this decision (positive and negative)
- **Revisit trigger**: What future condition would cause you to reconsider this decision

## Practical Guidance

### Applying the "Boring Technology" Principle

For most decisions, prefer the technology your team already knows over the technically superior option you would need to learn. The exception: when the known technology cannot meet a hard constraint.

Heuristic: If the new technology saves less than 20% effort over the lifetime of the project, it is not worth the switching cost. If it saves more than 50%, it probably is. Between 20-50%, run a timeboxed spike (1-2 days) before committing.

Every team has a limited "innovation budget." You can afford 1-2 unfamiliar technologies per project. Spend them on choices that directly solve your hardest problem. Use boring, proven tools for everything else.

### When to Choose Simplicity Over Flexibility

Use the "Three Users" test: Will three different types of users (or three different use cases) genuinely need the flexibility this abstraction provides? If the answer is no, choose the simpler, more rigid approach.

Concrete applications:
- **One database is enough** until you have a measured performance bottleneck that requires a specialized store.
- **A monolith is enough** until your team exceeds 8-10 people working on the same codebase with frequent merge conflicts.
- **Server-side rendering is enough** until you have a measured interaction latency problem that requires client-side state.
- **REST is enough** until you have a measured over-fetching problem across 5+ client types with different data needs.

### Handling "It Depends" Situations

When the answer genuinely depends on context you do not have, do not guess. Instead:

1. State the 2 most likely scenarios
2. Give the recommendation for each scenario
3. Ask the user which scenario matches their situation
4. If the user cannot answer, recommend the more reversible option

### Evaluating Build vs Buy vs Open Source

When choosing between building custom, buying a SaaS product, or adopting an open-source solution:

1. **Build** when the capability is your core differentiator and you need full control over the roadmap
2. **Buy** when the capability is commoditized, the vendor is stable, and the cost is less than 3 months of engineer time to build equivalent functionality
3. **Open source** when you need customization, the project has strong community momentum (>5k GitHub stars, active maintenance, multiple contributors), and you can afford to maintain a fork if needed

Red flags for "buy": vendor lock-in with no data export, pricing that scales with your usage non-linearly, critical dependency on a startup with <2 years of runway.

Red flags for "open source": single maintainer, no release in 6+ months, LICENSE changes in recent history, no TypeScript types (if you use TypeScript).

### Recording Decisions as ADRs

For one-way door decisions, suggest the user create an Architecture Decision Record:

```markdown
# ADR-NNN: [Decision Title]

**Status:** Accepted
**Date:** YYYY-MM-DD
**Context:** [What forces led to this decision?]
**Decision:** [What was decided?]
**Consequences:** [What follows from this decision?]
**Revisit When:** [What condition would trigger reconsideration?]
```

Store ADRs in `docs/adr/` or a `decisions/` directory at the project root.

### Decomposing Monoliths

When the user asks about breaking a monolith into services, follow this sequence:

1. **Identify bounded contexts** -- Group functionality by data ownership, not by technical layer
2. **Find the seams** -- Look for natural boundaries: different data stores, different rate of change, different team ownership
3. **Extract the strangler fig** -- Start with the least coupled module, expose it behind an API, route traffic gradually
4. **One at a time** -- Never extract more than one service simultaneously. Finish extraction, stabilize, then start the next.

The trigger for decomposition is team friction, not technical ambition. If one team can work on the monolith without stepping on another team's code, keep the monolith.

### Quick Decision Heuristics

When time is short, these rules work for 80% of cases:

- **"What would I delete first?"** -- If a component feels wrong in 6 months, how hard is it to remove? Pick the option that is easiest to delete.
- **"What does the data want?"** -- Follow the data access patterns. If most queries join tables A, B, and C together, they belong in the same service and the same database.
- **"Who changes this?"** -- If two modules are always changed by the same person in the same PR, they are one module. Do not separate them.
- **"What breaks when this fails?"** -- Map the blast radius. Choose architectures that contain failure to one domain rather than cascading across the system.

## Anti-Patterns

❌ **Anti-pattern: Resume-Driven Development**
Problem: Choosing a technology because it looks good on a resume rather than because it solves the problem. Leads to Kubernetes for a 100-user app, microservices for a 3-person team, or GraphQL for a single frontend consuming a single backend. The team spends months learning infrastructure instead of shipping features.
✅ Solution: Apply the Boring Technology Principle. Ask: "Would this decision change if nobody ever saw our tech stack?" If yes, the motivation is wrong. Choose the simplest technology that meets the actual requirements.

❌ **Anti-pattern: Analysis Paralysis**
Problem: Spending weeks evaluating options for a reversible decision. Comparing 8 state management libraries with a 20-row spreadsheet when any of the top 3 would work. The cost of delayed delivery exceeds the cost of picking a slightly suboptimal option.
✅ Solution: Classify the decision as one-way or two-way door first. For two-way doors, timebox the evaluation to 2 hours. Pick the option with the highest team familiarity. Set a calendar reminder to revisit in 3 months if needed.

❌ **Anti-pattern: Golden Hammer**
Problem: Using the same solution for every problem because it worked before. PostgreSQL for time-series data. REST for real-time updates. React for a static marketing site. The tool works, but a better-fit tool would reduce code by 60%.
✅ Solution: Before defaulting to your familiar tool, ask: "What is this problem's primary access pattern?" Match the access pattern to the tool category. If the familiar tool fits the access pattern, keep it. If not, evaluate one alternative that fits natively.

❌ **Anti-pattern: Premature Optimization**
Problem: Adding caching layers, read replicas, CDN edge functions, or message queues before measuring actual bottlenecks. The system becomes harder to debug, harder to reason about, and slower to develop on -- and the "optimization" may target a path that is not actually slow.
✅ Solution: Measure first. Use profiling, APM tools, or load testing to identify the actual bottleneck. Only add infrastructure complexity when you have a measured problem and a target metric. The rule: if you cannot state the specific request path that is slow and by how much, you are not ready to optimize.

❌ **Anti-pattern: Cargo Culting**
Problem: Copying architectural patterns from large companies (Netflix, Google, Uber) without understanding the forces that led to those patterns. Their patterns solve problems at 10M+ requests/second with 1000+ engineers. Applying them to a 10-person team with 1000 requests/minute creates overhead without benefit.
✅ Solution: When referencing a pattern from a large company, ask: "What problem did they solve, and do I have that problem?" Document the specific force (scale, team size, latency requirement) that justifies adopting their approach. If you cannot name the force, use the simpler alternative.

## Worked Examples

### Example 1: API Layer for a Next.js SaaS Application

**Scenario:** A team is building a multi-tenant SaaS application in Next.js. The frontend is server-rendered with some interactive dashboards. They need to decide between Server Actions, tRPC, and REST API routes for their data layer. The team has 3 developers, all proficient in TypeScript.

**Analysis:**
- **Category**: Integration Decision (how frontend communicates with backend)
- **Reversibility**: Two-way door (API layer can be swapped without changing database or business logic)
- **Forces**: Small team (3 devs), single frontend (Next.js), TypeScript everywhere, need for type safety, time-to-market pressure
- **Factor scores**:

| Factor | Server Actions | tRPC | REST API Routes |
|--------|---------------|------|-----------------|
| Reversibility | Medium (coupled to Next.js) | High (transport-agnostic) | High (standard protocol) |
| Team Familiarity | High (built into Next.js) | Medium (new library) | High (everyone knows REST) |
| Scalability Ceiling | Medium (single server) | High (extractable) | High (extractable) |
| Complexity Cost | Low (no client setup) | Medium (router setup) | Medium (schema + validation) |
| Maintenance Burden | Low (co-located) | Low (generated types) | Medium (manual type sync) |

**Decision:** Use Server Actions as the primary data layer. Add tRPC only if a second client (mobile app, external API) needs to consume the same endpoints.

**Rationale:** With a single Next.js frontend, Server Actions eliminate the API layer entirely -- no HTTP client, no serialization, no route definitions. The team ships faster. The revisit trigger is: "When a second client needs to consume these endpoints, extract to tRPC."

### Example 2: Database Selection for User-Generated Content

**Scenario:** An application needs to store user-generated documents with nested, variable-schema content (like Notion-style blocks). Documents are edited collaboratively and queried by metadata fields. The team currently uses PostgreSQL with Prisma.

**Analysis:**
- **Category**: Data Decision (storage and query model)
- **Reversibility**: One-way door (migrating data between database engines is expensive)
- **Forces**: Variable schema per document, need for metadata queries (filter by author, date, tags), collaborative editing (concurrent writes), existing PostgreSQL infrastructure
- **Factor scores**:

| Factor | PostgreSQL + JSONB | MongoDB | Dedicated Document DB (CouchDB) |
|--------|-------------------|---------|----------------------------------|
| Reversibility | High (already using it) | Low (new infrastructure) | Low (new infrastructure) |
| Team Familiarity | High (existing stack) | Medium | Low |
| Scalability Ceiling | High (JSONB + GIN indexes) | High | Medium |
| Complexity Cost | Low (no new infra) | High (new ORM, connection management) | High (new paradigm) |
| Maintenance Burden | Low (one database to manage) | High (two databases to manage) | High (two databases) |

**Decision:** Stay with PostgreSQL. Use JSONB columns for document content and GIN indexes for metadata queries.

**Rationale:** PostgreSQL's JSONB type handles variable-schema document content with indexable metadata queries. Adding a second database doubles operational complexity (backups, migrations, monitoring, connection pooling) with marginal benefit.

**Expected outcome:** Single-database architecture with JSONB columns for document blocks. Prisma schema uses `Json` type for the content field. GIN indexes on metadata JSONB fields enable filtered queries without full table scans. The team avoids managing a second database, second backup strategy, and second set of connection pools. The revisit trigger is: "When JSONB query performance degrades below 100ms p95 at scale, evaluate a dedicated document store for the content layer only."

### Example 3: State Management for a Dashboard with Real-Time Updates

**Scenario:** A Next.js application has a dashboard page showing analytics data. Most data loads on page visit (server-side), but 3 widgets need real-time updates every 5 seconds. The team is debating between Zustand, React Query (TanStack Query), and React Server Components with polling.

**Analysis:**
- **Category**: Technology Decision (which library for client-side state)
- **Reversibility**: Two-way door (state management is isolated to the client layer)
- **Forces**: Mostly server-rendered data, 3 widgets with 5-second polling, need cache invalidation, team already uses RSC for initial data load
- **Factor scores**:

| Factor | Zustand | TanStack Query | RSC + useEffect Polling |
|--------|---------|---------------|------------------------|
| Reversibility | High | High | High |
| Team Familiarity | Medium | Medium | High (no new library) |
| Scalability Ceiling | Medium (manual cache) | High (built-in cache) | Low (no cache strategy) |
| Complexity Cost | Medium (store setup) | Low (declarative) | Low (but grows fast) |
| Maintenance Burden | Medium (manual invalidation) | Low (automatic) | High (manual everything) |

**Decision:** Use TanStack Query for the 3 real-time widgets. Keep RSC for the initial page data load. Do not use Zustand.

**Rationale:** TanStack Query solves the specific problem (periodic data fetching with caching and background refresh) without adding a global state management layer the application does not need. Zustand would be the right choice if the dashboard had complex cross-widget state interactions, but 3 independent polling widgets are independent data-fetching problems, not shared-state problems.

**Expected outcome:** Dashboard page loads via RSC with full HTML (fast initial paint, good SEO). Three client components use `useQuery` with a 5-second `refetchInterval` for live data. TanStack Query handles background refresh, stale-while-revalidate, and error retry automatically. No global store exists. The revisit trigger is: "When widgets need to share state (e.g., a filter selection in widget A affects data in widget B), add Zustand for the shared state layer."

## Integration with Other Skills

- **codebase-conventions** -- After making an architectural decision, use codebase-conventions to determine where new code should live and what naming patterns to follow.
- **code-quality-patterns** -- Use code-quality-patterns to evaluate whether the chosen architecture supports testability, maintainability, and the team's review process.
- **diagnostic-debugging** -- When an architectural choice leads to unexpected behavior in production, use diagnostic-debugging to identify whether the issue is in the architecture itself or the implementation.
- **tech-debt-assessment** -- When revisiting a previous architectural decision, use tech-debt-assessment to evaluate the cost of changing it vs the cost of living with it.
- **requirements-gathering** -- Before making significant architectural decisions, use requirements-gathering to ensure you have captured all relevant constraints and quality attributes.

## References

- `references/adr-template.md` -- Full ADR template with examples for common decision types
- `tech-stack-preferences.md` -- The user's current stack choices (always read before giving technology-specific advice)
