# Role-Based Development Skills

Composable Claude Code skills organized by development function, assembled into role profiles.

## Quick Start

1. Fill in [tech-stack-preferences.md](tech-stack-preferences.md) with your stack choices
2. Pick a role profile from `role-profiles/`
3. Copy the profile content into your project's `.claude/CLAUDE.md`
4. Install the listed skills in Claude Code

## Structure

```text
role-skills/
├── STRATEGY.md               <- Full approach: architecture, catalog, mappings
├── tech-stack-preferences.md <- Your stack choices (fill this in first)
├── foundation/               <- Skills serving 3+ roles
├── specialist/               <- Skills serving 1-2 roles
└── role-profiles/            <- Role -> skills mappings for CLAUDE.md
```

## Role Profiles

| Role            | Foundation Skills                                                         | Specialist Skills                                         |
| --------------- | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| Full-Stack Dev  | architecture-decisions, diagnostic-debugging, code-quality, codebase-conv | payment-engine, performance-optimization                  |
| Backend Dev     | architecture-decisions, diagnostic-debugging, code-quality, codebase-conv | api-integration-guide, payment-engine                     |
| Frontend Dev    | diagnostic-debugging, code-quality, codebase-conv                         | component-design, performance-optimization                |
| DevOps / SRE    | diagnostic-debugging, ci-cd-pipelines                                     | infrastructure-ops, migration-runbooks, incident-response |
| QA / Testing    | diagnostic-debugging, code-quality                                        | test-strategy                                             |
| Security        | diagnostic-debugging                                                      | security-assessment, incident-response                    |
| Architect       | architecture-decisions, code-quality, codebase-conv                       | tech-debt-assessment, requirements-gathering              |
| ML Engineer     | diagnostic-debugging, ci-cd-pipelines                                     | ml-experiment-workflow, ai-feature-implementation         |
| Data Engineer   | diagnostic-debugging, ci-cd-pipelines                                     | data-pipeline-design                                      |
| Product Manager | —                                                                         | requirements-gathering, tech-debt-assessment              |

For the full strategy, architecture decisions, and build plan, see [STRATEGY.md](STRATEGY.md).
