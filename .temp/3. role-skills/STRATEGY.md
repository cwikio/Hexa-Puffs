# Role-Based Development Skills: Strategy

## What This Is

A composable skill library for Claude Code, organized by development function and assembled into role profiles. Instead of one monolithic skill per role, skills are medium-grained (200-500 lines each), organized by what they DO, and composed into roles via lightweight profile files.

---

## Core Decision: Skills, Not Agents

**Use Claude Code skills (SKILL.md), not standalone agents.**

- Skills compose with existing Claude Code workflows — no separate runtime needed
- The 11 architecture templates (01-11) are designed for skills
- CLAUDE.md "role profiles" provide the orchestration layer for free
- Agents only make sense for persistent memory, scheduling, or multi-channel communication — rare for dev roles

**Exception:** An Architect / Engineering Manager role that tracks architectural decisions across sessions could warrant an agent later. Start with skills.

---

## Architecture: Three Composable Layers

```text
Layer 3: Role Profiles (lightweight .md files)
         "DevOps = infrastructure-ops + diagnostic-debugging + ci-cd-pipelines + migration-runbooks"
         Copy into a project's CLAUDE.md to activate the role.

Layer 2: Domain Skills (SKILL.md files, 200-500 lines each)
         Organized by FUNCTION, not role. Each serves multiple roles.
         Built using the existing templates (01-11).

Layer 1: Tech Stack Preferences (tech-stack-preferences.md)
         User-configurable file declaring your actual stack choices.
         Every skill reads this to adapt its output to your tools.
```

### Why This Layering

**Why not monolithic (one skill per role)?** Roles overlap heavily. A Full-Stack dev needs parts of Frontend, Backend, and DevOps skills. Duplicating content across monolithic role skills wastes tokens and creates maintenance nightmares.

**Why not fully atomized (100 tiny skills)?** Too many small skills means Claude scans too many descriptions to decide which to load, and individual skills lack enough context to be useful.

**Why a preferences file instead of stack-specific skill variants?** Instead of building `diagnostic-debugging-nextjs` and `diagnostic-debugging-python` as separate skills, you build ONE `diagnostic-debugging` skill that reads `tech-stack-preferences.md` and adapts. This prevents the explosion of N skills x M stacks = N*M variants.

---

## Skill Catalog

### Foundation Skills (serve 3+ roles — build first)

| Skill                    | Template              | Roles Served                          | What It Does                                                                                        |
| ------------------------ | --------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `architecture-decisions` | 03 Decision-Framework | Full-Stack, Backend, Architect        | Structured approach to choosing patterns, libraries, architectures. Decision trees + trade-off matrices. |
| `diagnostic-debugging`   | 09 Diagnostic         | Full-Stack, Backend, Frontend, DevOps, QA | Symptom -> root cause -> fix methodology. Diagnostic decision trees per error category.             |
| `code-quality-patterns`  | 04 Hierarchical       | Full-Stack, Backend, Frontend, QA     | Progressive depth on testing, refactoring, review. Anti-patterns with fixes.                        |
| `codebase-conventions`   | 08 Codebase-Aware     | Full-Stack, Backend, Frontend, Architect | "Where does X go?" routing tables. File structure conventions, naming, layer boundaries.            |
| `ci-cd-pipelines`        | 01 Procedural         | DevOps, Backend, Full-Stack           | Pipeline definitions, deployment automation, environment management. Step-by-step procedures.       |

### Specialist Skills (serve 1-2 roles — build per need)

| Skill                       | Template             | Roles                      | What It Does                                                                              |
| --------------------------- | -------------------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| `infrastructure-ops`        | 01 Procedural        | DevOps, SRE                | Cloud provisioning, container orchestration, server management commands.                   |
| `migration-runbooks`        | 10 Migration         | DevOps, Backend            | Database migrations, infrastructure transitions, system upgrades with rollback.            |
| `component-design`          | 05 Creative          | Frontend                   | Design philosophy -> component architecture. Aesthetic decisions, layout patterns.         |
| `test-strategy`             | 03 Decision          | QA, Architect              | Which tests to write. Unit vs integration vs e2e decision framework. Coverage trade-offs.  |
| `security-assessment`       | 09 Diagnostic        | Security                   | Vulnerability diagnosis, threat modeling, OWASP-guided analysis.                           |
| `incident-response`         | 09 Diagnostic        | DevOps, SRE, Security      | On-call diagnostic trees, outage response procedures, post-mortem structure.               |
| `performance-optimization`  | 09 Diagnostic        | Frontend, Backend          | Performance profiling methodology. Bottleneck identification -> fix.                       |
| `requirements-gathering`    | 11 Conversational    | Product Manager, Architect | Multi-turn dialogue to extract requirements, constraints, priorities.                      |
| `tech-debt-assessment`      | 03 Decision          | Architect                  | Evaluate, prioritize, and plan tech debt remediation. Cost/benefit framework.              |
| `ml-experiment-workflow`    | 07 Meta-Orchestrator | ML Engineer                | Multi-phase experiment lifecycle: hypothesis -> train -> evaluate -> deploy.               |
| `data-pipeline-design`      | 01 Procedural        | Data Engineer              | ETL/ELT pipeline construction, data quality checks, scheduling.                            |
| `api-integration-guide`     | 06 API               | Backend, Full-Stack        | API design patterns, versioning, documentation, multi-language examples.                   |
| `payment-engine`            | 01 Procedural        | Backend, Full-Stack        | Stripe checkout, subscriptions, webhook sync, entitlements, billing portal.                |
| `ai-feature-implementation` | 01 Procedural        | ML Engineer, Full-Stack    | Production AI: streaming, structured output, embeddings, conversations, safety.            |

**Total: ~19 skills composing into 10+ role profiles.**

---

## Role-to-Skill Mapping

| Role                | Foundation Skills                                                                         | Specialist Skills                                         |
| ------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **Full-Stack Dev**  | architecture-decisions, diagnostic-debugging, code-quality-patterns, codebase-conventions | payment-engine, performance-optimization                  |
| **Backend Dev**     | architecture-decisions, diagnostic-debugging, code-quality-patterns, codebase-conventions | api-integration-guide, payment-engine                     |
| **Frontend Dev**    | diagnostic-debugging, code-quality-patterns, codebase-conventions                         | component-design, performance-optimization                |
| **DevOps / SRE**    | diagnostic-debugging, ci-cd-pipelines                                                     | infrastructure-ops, migration-runbooks, incident-response |
| **QA / Testing**    | diagnostic-debugging, code-quality-patterns                                               | test-strategy                                             |
| **Security**        | diagnostic-debugging                                                                      | security-assessment, incident-response                    |
| **Architect**       | architecture-decisions, code-quality-patterns, codebase-conventions                       | tech-debt-assessment, requirements-gathering              |
| **ML Engineer**     | diagnostic-debugging, ci-cd-pipelines                                                     | ml-experiment-workflow, ai-feature-implementation         |
| **Data Engineer**   | diagnostic-debugging, ci-cd-pipelines                                                     | data-pipeline-design                                      |
| **Product Manager** | —                                                                                         | requirements-gathering, tech-debt-assessment              |

---

## How Skills Adapt to Your Stack

Every skill includes a "Stack Adaptation" section that reads `tech-stack-preferences.md`:

```markdown
## Stack Adaptation

Before executing, read `tech-stack-preferences.md` for the user's actual stack.
Apply these substitutions:
- Database commands -> use the ORM listed in preferences (default: raw SQL)
- Deployment -> use the hosting provider's CLI from preferences
- Testing -> use the test framework from preferences
```

This means `diagnostic-debugging` can say "check your database logs" and Claude knows to run Prisma-specific commands because preferences says `ORM: Prisma`.

---

## Build Strategy

### Phase 1: Foundations

1. Fill in `tech-stack-preferences.md` with your stack choices
2. Build the 5 foundation skills using the existing template workflow
3. Each skill: pick template -> fill BRIEF -> study exemplars -> AI-generate -> QA (12+ on Scorecard)

### Phase 2: First Role Profile

Assemble one complete role (e.g., Full-Stack Developer). Build any missing specialist skills. Validate end-to-end: install skills in Claude Code, run real dev tasks, verify triggering and quality.

### Phase 3: Expand Roles

Add specialist skills by role priority. Each additional role needs only 1-3 new specialist skills on top of the shared foundation.

### Per-Skill Creation Process

1. Pick template from `skill-templates/XX/TEMPLATE.md`
2. Fill the BRIEF from `skill-templates/XX/BRIEF.md`
3. Study 2-3 exemplars from `downloaded-skills/` for that template type
4. AI-assisted generation: point Claude at template + brief + exemplars + MASTER-PATTERNS.md
5. QA with the 8 Expert Traits Scorecard (target 12+)
6. Validate structure with `00-skill-procedure/scripts/quick_validate.py`

---

## Key Reference Files

| File                                            | Purpose                                              |
| ----------------------------------------------- | ---------------------------------------------------- |
| `skill-templates/SKILL-CREATION-GUIDE.md`       | Master workflow for creating each skill               |
| `skill-templates/MASTER-PATTERNS.md`            | 15 prompt patterns + template-specific combinations   |
| `skill-templates/XX/TEMPLATE.md`                | Copy-paste skeleton for each template type            |
| `skill-templates/XX/BRIEF.md`                   | Fill-in questionnaire before writing                  |
| `skill-templates/00-skill-procedure/scripts/quick_validate.py` | Structural validation                     |

---

## What This Produces

When fully executed:

- **19 composable skills** built on proven templates
- **10 role profiles** that mix-and-match skills per development role
- **1 tech-stack-preferences file** that makes all skills adapt to your actual tools
- A **README catalog** mapping roles -> skills for easy navigation
