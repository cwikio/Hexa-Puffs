---
name: tech-debt-assessment
description: >
  Evaluate, categorize, and prioritize technical debt for remediation planning.
  Activate when asked about "tech debt", "technical debt", "refactoring priority",
  "code quality assessment", "legacy code", "cleanup", "modernization",
  or when assessing the cost of deferring maintenance work.
---

<!-- TEMPLATE: 03-Decision-Framework
     Helps architects evaluate trade-offs between tech debt items,
     prioritize remediation, and build actionable cleanup plans.
     TYPICAL SIZE: 250-400 lines -->

## When to Activate

Use this skill when:
- User asks to identify, catalog, or assess technical debt in a codebase
- User needs to prioritize which tech debt to fix first
- User asks about the cost of inaction on known quality issues
- User wants a remediation plan for legacy code or outdated dependencies
- User asks "should we refactor this?" or "is this worth fixing?"
- User mentions modernization, cleanup sprints, or debt budgets

Do NOT use this skill when:
- User wants to write new features (use `architecture-decisions` instead)
- User is debugging a specific bug right now (use `diagnostic-debugging` instead)
- User is doing a routine code review without a debt focus (use `code-quality-patterns`)
- User needs to migrate between specific technologies (use `migration-runbooks`)

## Core Concepts

### Taxonomy of Tech Debt

Technical debt falls into six categories. Identify which types are present before prioritizing.

**Code Debt** -- Accumulated shortcuts in implementation
- Duplication: copy-pasted logic instead of shared abstractions
- Complexity: functions/modules that exceed reasonable cognitive load (cyclomatic complexity > 15, files > 500 lines)
- Style inconsistency: mixed conventions, dead code, unclear naming
- Trade-off: Fast to fix individually, but items are numerous and easy to ignore

**Architecture Debt** -- Structural problems in system design
- Wrong patterns: using client-side fetching where server components belong, REST where events fit better
- Missing abstractions: business logic scattered across UI components, no service layer
- Tight coupling: modules that cannot change independently, circular dependencies
- Trade-off: Expensive to fix but high leverage -- one architectural fix often resolves dozens of code-level issues

**Dependency Debt** -- Outdated or risky external packages
- Outdated packages: major versions behind, missing security patches
- Abandoned dependencies: unmaintained libraries with no migration path
- Version conflicts: incompatible peer dependencies, pinned to old versions
- Trade-off: Low effort for minor bumps, but major version upgrades can cascade across the codebase

**Test Debt** -- Gaps in quality assurance
- Missing coverage: critical paths without tests, untested error handling
- Brittle tests: tests coupled to implementation details, flaky CI
- Wrong test level: E2E tests for logic that should be unit-tested, or vice versa
- Trade-off: Invisible until something breaks, then extremely costly

**Documentation Debt** -- Missing or misleading knowledge
- Missing docs: no explanation of why architectural choices were made
- Outdated docs: README describes a system that no longer exists
- Tribal knowledge: critical procedures exist only in one person's head
- Trade-off: Zero runtime impact, but multiplies onboarding time and decision-making errors

**Infrastructure Debt** -- Manual processes and outdated tooling
- Manual deployments: no CI/CD or partially automated pipelines
- Outdated tooling: old Node versions, deprecated build tools
- Missing observability: no structured logging, no error tracking, no alerting
- Trade-off: Slows every developer every day, but feels "normal" so gets deprioritized

### Deliberate vs. Accidental Debt

Not all debt is created equal. Understanding intent changes how you respond:

- **Deliberate debt** -- Taken consciously with a plan to repay. Example: "We shipped without tests to hit the launch deadline; we will add them next sprint." Acceptable if tracked and time-boxed.
- **Accidental debt** -- Accumulated without awareness. Example: The team did not realize the ORM had a newer major version with breaking changes. Requires discovery before it can be addressed.
- **Bit rot** -- Code that was fine when written but degraded as the world changed. Example: A REST API built before the codebase adopted Server Actions. Neither a mistake nor a shortcut -- just age.

## Comparison Matrix

| Factor | Code Debt | Architecture Debt | Dependency Debt | Test Debt | Documentation Debt | Infrastructure Debt |
|--------|-----------|------------------|-----------------|-----------|-------------------|-------------------|
| Visibility | High (linters catch it) | Low (requires design review) | Medium (audit tools) | Medium (coverage reports) | Low (no tooling) | Low (feels normal) |
| Fix cost per item | Low | High | Medium | Medium | Low | High |
| Impact if ignored | Slow creep | Structural collapse | Security breach | Silent regression | Knowledge loss | Developer friction |
| Who notices first | Developers | Architects | Security/CI | QA | New hires | Everyone (slowly) |
| Best diagnostic | Static analysis | Dependency graphs, module boundaries | `npm audit`, `npm outdated` | Coverage reports, flaky test logs | Onboarding feedback | Deployment frequency metrics |

## Decision Framework

Use this process to prioritize tech debt remediation:

### Step 1: Inventory

Scan the codebase and catalog debt items. For each item, record:
- **What:** One-sentence description of the debt
- **Type:** Which of the six categories it belongs to
- **Location:** Files, modules, or systems affected
- **Origin:** Deliberate, accidental, or bit rot

### Step 2: Score Each Item

Rate each debt item on four dimensions (1-5 scale):

| Dimension | 1 (Low) | 3 (Medium) | 5 (High) |
|-----------|---------|------------|----------|
| **Impact** -- How much does it slow development? | Rarely encountered | Weekly friction | Blocks work daily |
| **Blast Radius** -- How many areas does it affect? | Single file | Single module/feature | Cross-cutting, system-wide |
| **Fix Cost** -- How much effort to remediate? | < 1 day | 1-5 days | > 1 week |
| **Risk of Inaction** -- What happens if we ignore it? | Cosmetic annoyance | Growing maintenance burden | Security vulnerability or outage risk |

**Priority Score** = (Impact + Blast Radius + Risk of Inaction) - Fix Cost

- Score 10+ : Fix immediately -- high value, manageable cost
- Score 5-9 : Schedule for next planning cycle
- Score 1-4 : Track but defer -- low leverage or too expensive right now
- Score 0 or below : Do not fix -- cost exceeds benefit

### Step 3: Sequence the Work

After scoring, order by priority score. Then apply these adjustments:

- **Cluster related items.** If three code-debt items are in the same module, batch them into one remediation task. The marginal cost of the second and third fix drops when you are already in the code.
- **Lead with enablers.** If fixing item A makes items B, C, and D cheaper to fix, do A first regardless of its individual score.
- **Respect risk windows.** Dependency security patches and infrastructure debt with outage risk jump to the top regardless of score.
- **Time-box architecture debt.** Large architectural changes need a spike (investigation) before committing to a full remediation. Never estimate architecture debt remediation without a spike.

### Step 4: Build the Remediation Plan

For each remediation task, define:

```
## Remediation: [Title]
- Debt type: [Code | Architecture | Dependency | Test | Documentation | Infrastructure]
- Priority score: [number]
- Estimated effort: [hours/days]
- Owner: [team or person]
- Acceptance criteria: [what "done" looks like]
- Rollback plan: [how to revert if the fix causes problems]
- Dependencies: [other tasks that must complete first]
```

## Practical Guidance

### Running a Tech Debt Assessment

Follow this sequence when performing a full assessment:

1. **Automated scan** -- Run static analysis, dependency audits, and coverage reports. This surfaces Code Debt and Dependency Debt cheaply.
2. **Architecture review** -- Examine module boundaries, dependency graphs, and data flow. Look for coupling that should not exist.
3. **Developer interviews** -- Ask the team: "What slows you down every week?" This surfaces Infrastructure Debt and Documentation Debt that tools miss.
4. **Catalog and score** -- Use the scoring matrix from Step 2 to assign priority to every item.
5. **Present trade-offs** -- Show stakeholders the cost of inaction vs. cost of fix for the top 10 items. Use concrete time estimates, not abstract quality arguments.

### Embedding Debt Management in the Workflow

Tech debt assessment is not a one-time event. Embed it:

- **20% rule:** Reserve roughly 20% of each sprint for debt remediation. This prevents accumulation without requiring special "cleanup sprints."
- **Boy Scout rule:** Leave code better than you found it. Every PR that touches a file with known debt should improve it incrementally.
- **Debt ceiling:** Set a maximum acceptable level of debt (e.g., no dependency more than 2 major versions behind, no file over 600 lines). Enforce via CI.
- **Quarterly review:** Re-score the debt catalog every quarter. Items shift priority as the codebase evolves.

### Communicating Debt to Stakeholders

Technical debt is an engineering concept. Translate it for business stakeholders:

- **Frame as velocity:** "This debt costs us 2 developer-days per sprint in workarounds. Fixing it recovers that time permanently."
- **Frame as risk:** "This outdated dependency has a known CVE. If exploited, it exposes user data."
- **Frame as opportunity cost:** "We cannot build Feature X until we untangle Module Y. The debt is blocking revenue."
- **Never frame as blame:** Debt is a natural byproduct of shipping software. The question is not "who created it" but "what is it costing us now."

## Anti-Patterns

**Anti-pattern: Big Bang Rewrite**
Problem: The team decides to rewrite an entire module or system from scratch instead of incrementally improving it. The rewrite takes 6 months, during which the old system still needs maintenance. The new system ships with its own bugs and missing edge cases that the old system handled. Two systems now need support.
Solution: Use the Strangler Fig pattern. Build new functionality alongside the old, redirect traffic incrementally, and decommission old code piece by piece. Set milestones every 2 weeks to demonstrate progress and catch scope creep early.

**Anti-pattern: Debt Denial**
Problem: The team acknowledges no tech debt exists. Code quality issues are dismissed as "working code." Dependency updates are deferred indefinitely because "nothing is broken." Meanwhile, developer velocity erodes and onboarding takes longer each quarter.
Solution: Run automated scans (linting, `npm audit`, coverage) and present the data. Debt becomes undeniable when you can show 47 outdated packages, 12% test coverage, and 3 files over 1000 lines. Make the invisible visible.

**Anti-pattern: Gold Plating During Remediation**
Problem: A developer assigned to fix tech debt expands the scope. What started as "extract this duplicated logic into a shared utility" becomes "redesign the entire data access layer with a new pattern I read about." The PR grows to 80 files and takes 3 weeks to review.
Solution: Define acceptance criteria before starting. The remediation task has a specific scope and a specific "done" state. If a bigger opportunity is discovered during the work, log it as a separate debt item and score it independently.

**Anti-pattern: Fixing Debt Nobody Touches**
Problem: A module has terrible code quality, but no one has modified it in 18 months. A developer spends a week refactoring it. The next modification to that module happens 12 months later. The refactoring effort delivered zero value during that time.
Solution: Weight priority by change frequency. Use `git log --since="6 months ago" --name-only` to identify hot files. Debt in frequently-changed code costs more than debt in stable code. Fix the hot spots first.

**Anti-pattern: No Tracking**
Problem: The team identifies tech debt during retrospectives but never records it. Debt items live in memory, brought up repeatedly but never prioritized against feature work. The same complaints surface every quarter.
Solution: Maintain a living debt catalog -- a document, a board, or tagged issues in your tracker. Each item has a type, a score, and an owner. Review the catalog during sprint planning, not just retrospectives.

## Worked Examples

### Example 1: Outdated Authentication Library

**Scenario:** A Next.js SaaS application uses an authentication library that is 2 major versions behind. The team has been patching around breaking changes in the middleware layer. New Clerk features (organization-level RBAC) cannot be adopted until the upgrade happens. Two developers spend approximately 3 hours per week working around the old API.

**Analysis:**
- Impact: 4 -- Regular friction, 6 hours/week of workaround effort across the team
- Blast Radius: 4 -- Auth touches middleware, server actions, API routes, and client components
- Risk of Inaction: 5 -- Blocks a planned feature (org-level RBAC) and old version will lose security patches within 6 months
- Fix Cost: 3 -- Estimated 3-4 days for the upgrade plus testing, well-documented migration path

**Decision:** Priority Score = (4 + 4 + 5) - 3 = **10**. Fix immediately. The upgrade unblocks a revenue feature, reduces weekly friction, and mitigates a security timeline. Schedule a 1-day spike to map all breaking changes, then a 3-day remediation with focused PR review.

**Expected outcome:** Auth library upgraded, middleware simplified by removing workarounds, org-level RBAC feature unblocked, 6 dev-hours/week recovered.

### Example 2: Monolithic API Route File

**Scenario:** A single API route file (`app/api/documents/route.ts`) has grown to 1,200 lines. It handles document creation, retrieval, updating, sharing, PDF generation, and webhook processing. Every feature that touches documents requires modifying this file. Merge conflicts occur weekly. The file has 40% test coverage because testing individual behaviors requires mocking the entire file's dependencies.

**Analysis:**
- Impact: 5 -- Merge conflicts weekly, every document-related feature touches this file
- Blast Radius: 3 -- Contained to one feature area (documents), but that area is business-critical
- Risk of Inaction: 3 -- Will get worse as document features grow, but no immediate security or outage risk
- Fix Cost: 3 -- Extract into service modules (document-service, sharing-service, pdf-service). Estimated 3-5 days.

**Decision:** Priority Score = (5 + 3 + 3) - 3 = **8**. Schedule for next sprint. The file is a daily friction point, and the fix (extraction into focused modules) is well-understood. Cluster with improving test coverage on the extracted modules -- the marginal cost of writing tests drops dramatically when each module has fewer dependencies.

**Expected outcome:** Route file reduced to a thin controller (< 100 lines) delegating to focused service modules. Test coverage increases to 80%+ per module. Merge conflicts on document features eliminated.

### Example 3: Unused Feature Flags and Dead Code

**Scenario:** The codebase has 23 feature flags in PostHog. A developer notices that 14 of them are for features that shipped 6+ months ago and are now permanently enabled. The flag checks remain in the code, adding conditional branches that will never evaluate to `false`. Additionally, there are 8 React components in a `/components/experiments/` directory that were part of A/B tests that concluded months ago.

**Analysis:**
- Impact: 2 -- Causes minor confusion when reading code, but does not block work
- Blast Radius: 3 -- Flags scattered across 30+ files, but each instance is small
- Risk of Inaction: 2 -- No security or stability concern; cosmetic and cognitive overhead only
- Fix Cost: 1 -- Mechanical removal, no design decisions. Estimated half a day.

**Decision:** Priority Score = (2 + 3 + 2) - 1 = **6**. Schedule as a lightweight cleanup task. Despite the moderate score, the fix cost is so low that it is worth doing opportunistically. Assign to a developer during a low-priority day or as a warm-up task for a new team member (good onboarding exercise for learning the codebase).

**Expected outcome:** 14 feature flags removed from code and PostHog. 8 dead components deleted. ~400 lines of dead code removed. Codebase slightly easier to navigate.

## Stack Adaptation

Before executing an assessment, read `tech-stack-preferences.md` for the user's actual stack. Apply these substitutions:

- **Static analysis** -- Use the linter from preferences (default: ESLint). Run `npx tsc --noEmit` for TypeScript codebases.
- **Dependency audit** -- Use `npm audit` and `npm outdated` for npm-based projects. Adapt for yarn/pnpm as needed.
- **Coverage reports** -- Use the test framework from preferences (default: Vitest with `--coverage`).
- **Change frequency** -- Use `git log --since="6 months ago" --name-only` to identify hot files in any stack.
- **Module boundary analysis** -- For Next.js App Router projects, examine the `app/` directory structure and server/client component boundaries. For monorepos with Turborepo, check cross-package dependencies.
- **CI/CD debt** -- Check the pipeline tool from preferences (default: GitHub Actions). Look for manual steps, missing stages, and slow builds.
- **Infrastructure** -- Adapt deployment checks to the hosting provider from preferences (default: Vercel).

## Integration with Other Skills

- `architecture-decisions` -- When a tech debt item requires choosing between remediation approaches (refactor vs. rewrite vs. wrap), hand off to architecture-decisions for the trade-off analysis.
- `code-quality-patterns` -- After identifying Code Debt, reference code-quality-patterns for specific refactoring techniques, testing strategies, and review checklists.
- `diagnostic-debugging` -- When a tech debt item manifests as a recurring bug or performance issue, use diagnostic-debugging to trace root cause before deciding on remediation.
- `migration-runbooks` -- When Dependency Debt or Infrastructure Debt requires a major version upgrade or platform migration, hand off to migration-runbooks for the step-by-step execution plan.
- `codebase-conventions` -- Reference codebase-conventions to ensure remediated code follows the project's established patterns and file structure.
