# Hexa Puffs Scripts

Utility scripts that run against a live Orchestrator instance.

## Scripts

| Script | Purpose | Prerequisites |
| --- | --- | --- |
| `seed-cron-skills.ts` | Seed 7 scheduled skills into Memorizer DB via Orchestrator | Orchestrator running on :8010, Memorizer connected |
| `generate-system-snapshot.ts` | Generate `~/.hexa-puffs/documentation/system-snapshot.md` from live system state | Orchestrator running on :8010 |
| `changelog_hook.py` | Claude Code pre-commit hook that auto-generates CHANGELOG.md entries | Configured in `.claude/settings.json` as a PreToolUse hook |

## Usage

```bash
# Seed cron skills (creates scheduled tasks in Memorizer)
npx tsx _scripts/seed-cron-skills.ts

# Generate system snapshot (queries live APIs)
npx tsx _scripts/generate-system-snapshot.ts
```

Both TypeScript scripts read the auth token from `~/.hexa-puffs/hexa-puffs.token` (created by `start-all.sh`) or from the `HEXA_PUFFS_TOKEN` environment variable.

## Changelog Hook

`changelog_hook.py` is a Python script that intercepts `git commit` commands in Claude Code. It:

1. Parses the commit message for conventional commit prefixes (`feat:`, `fix:`, `refactor:`, etc.)
2. Determines affected packages from staged files
3. Prepends a changelog entry under `## [Unreleased]` in CHANGELOG.md
4. Stages CHANGELOG.md so it's included in the same commit

Configured in `.claude/settings.json` as a `PreToolUse` hook matching the `Bash` tool.
