# V3 Implementation Plan: Compiled Plans + Tiered Execution

## Context

Annabelle's current cron/skill system has critical bugs discovered during E2E testing:
- Playbook keyword matching misses common phrases ("every three hours")
- LLM hallucinates tool names from a stale 30-tool hardcoded list
- No validation at creation → broken jobs spam errors forever
- Two confusing systems (cron jobs vs skills) that overlap

The v3 architecture (documented in `_todos/tooling-for-cron-and-skills.md`) unifies everything into skills with tiered execution: Direct tier (zero LLM, `execution_plan`) for simple tasks, Agent tier (sandboxed LLM) for complex tasks. Implementation is split into 3 phases, each independently testable.

---

## Phase 1: Foundation (prevents broken skills)

### 1A. Input normalizer for `memory_store_skill`

**File**: `Orchestrator/src/core/http-handlers.ts` — insert BEFORE line 183 (before `required_tools` validation)

Extract into a new file: `Orchestrator/src/utils/skill-normalizer.ts`

```typescript
export function normalizeSkillInput(args: Record<string, unknown>): Record<string, unknown>
```

**What it fixes**:
- `trigger_config` flattened into root → re-nest into `trigger_config` object
  - If `args.schedule` exists but `args.trigger_config` doesn't → move to `{trigger_config: {schedule: args.schedule}}`
  - If `args.interval_minutes` exists → same pattern
- Missing `trigger_type` → infer from `trigger_config` (`schedule`/`interval_minutes` → `"cron"`)
- `required_tools` as string → parse to array (`"[\"a\",\"b\"]"` → `["a","b"]`)
- `required_tools` as single string → wrap in array (`"telegram_send_message"` → `["telegram_send_message"]`)
- `max_steps` as string → parse to number
- `notify_on_completion` as string `"true"`/`"false"` → boolean

**Hook point in http-handlers.ts**: Before the `toolRouter.routeToolCall(name, args)` call (line 173), add:
```typescript
if (name === 'memory_store_skill' || name === 'memory_update_skill') {
  args = normalizeSkillInput(args);
}
```

### 1B. Cron expression validation

**Same file**: `Orchestrator/src/utils/skill-normalizer.ts`

```typescript
export function validateCronExpression(expr: string): { valid: boolean; error?: string }
```

Uses `croner` (already in package.json, imported as `import { Cron } from 'croner'`).

**Hook point in http-handlers.ts**: After normalization, before routing:
```typescript
if ((name === 'memory_store_skill' || name === 'memory_update_skill') && args.trigger_config) {
  const tc = args.trigger_config as Record<string, unknown>;
  if (tc.schedule && typeof tc.schedule === 'string') {
    const cronCheck = validateCronExpression(tc.schedule);
    if (!cronCheck.valid) {
      // Return error directly, don't store the skill
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        content: [{ type: 'text', text: JSON.stringify({
          success: false,
          error: `Invalid cron expression "${tc.schedule}": ${cronCheck.error}`
        })}]
      }));
      return;
    }
  }
}
```

### 1C. Graduated backoff

**File**: `Orchestrator/src/jobs/functions.ts`

Replace the flat `FAILURE_COOLDOWN_MINUTES = 5` (line 510) with:

```typescript
const BACKOFF_MINUTES = [1, 5, 15, 60]; // indexed by consecutive failures (0-based)
const MAX_CONSECUTIVE_FAILURES = 5;
const failureCountMap = new Map<number, number>(); // skillId → consecutive failure count

function getBackoffMinutes(skillId: number): number {
  const count = failureCountMap.get(skillId) ?? 0;
  return BACKOFF_MINUTES[Math.min(count, BACKOFF_MINUTES.length - 1)];
}
```

**Change the cooldown check** (lines 598-609):
- Use `getBackoffMinutes(skill.id)` instead of `FAILURE_COOLDOWN_MINUTES`
- If `failureCountMap.get(skill.id) >= MAX_CONSECUTIVE_FAILURES` → auto-disable the skill via `memory_update_skill({ skill_id, enabled: false })` + send notification

**On success** (after line 781): `failureCountMap.delete(skill.id)`
**On failure** (after line 789): `failureCountMap.set(skill.id, (failureCountMap.get(skill.id) ?? 0) + 1)`

Update `notifySkillFailure()` message to include backoff level and failures remaining before auto-disable.

### Phase 1 Tests

**Create**: `Orchestrator/tests/unit/skill-normalizer.test.ts`
1. Normalizes flattened `schedule` into `trigger_config.schedule`
2. Normalizes flattened `interval_minutes` into `trigger_config.interval_minutes`
3. Infers `trigger_type: "cron"` when missing but `trigger_config.schedule` present
4. Parses `required_tools` from JSON string to array
5. Wraps single string `required_tools` into array
6. Parses `max_steps` from string to number
7. Parses `notify_on_completion` from string to boolean
8. Passes through already-correct input unchanged
9. Validates good cron expression → `{ valid: true }`
10. Rejects 4-field cron → `{ valid: false, error: ... }`
11. Rejects invalid characters → `{ valid: false, error: ... }`
12. Accepts cron with seconds (6 fields) → `{ valid: true }`

**Create**: `Orchestrator/tests/unit/graduated-backoff.test.ts`
1. First failure → 1 min backoff
2. Second failure → 5 min backoff
3. Third failure → 15 min backoff
4. Fourth+ failure → 60 min backoff
5. Success resets counter to 0
6. 5th failure → auto-disable (returns `shouldDisable: true`)

**Create**: `Orchestrator/tests/integration/workflow-skill-normalizer.test.ts`
1. Store skill with flattened `schedule` field → stored correctly with nested `trigger_config`
2. Store skill with invalid cron expression → error returned, skill NOT stored
3. Store skill with valid cron expression → success, no error
4. Store skill with string `required_tools` → parsed and stored as array

**Run**: `cd Orchestrator && npx vitest run tests/unit/skill-normalizer.test.ts tests/unit/graduated-backoff.test.ts`
**Run**: `cd Orchestrator && npx vitest run tests/integration/workflow-skill-normalizer.test.ts`
**Run**: `cd Orchestrator && npx tsc --noEmit`

---

## Phase 2: Direct Execution Tier (the big win)

### 2A. Add `execution_plan` column to Memorizer

**File**: `Memorizer-MCP/src/db/schema.ts`
- Add to `MIGRATIONS_SQL`: `ALTER TABLE skills ADD COLUMN execution_plan TEXT DEFAULT NULL;`
- Add to `SkillRow` interface: `execution_plan: string | null;`

**File**: `Memorizer-MCP/src/tools/skills.ts`
- Add to `StoreSkillInputSchema`: `execution_plan: z.array(z.object({ id: z.string(), name: z.string(), toolName: z.string(), parameters: z.record(z.unknown()).optional() })).optional()`
- Add to `UpdateSkillInputSchema`: same field, optional
- Update `handleStoreSkill` INSERT statement: add `execution_plan` column, `JSON.stringify(execution_plan)` if present
- Update `handleUpdateSkill` SET clause builder: add `execution_plan` handling
- Update `formatSkill()` response: include `execution_plan: row.execution_plan ? JSON.parse(row.execution_plan) : null`
- Make `instructions` conditionally required: if `execution_plan` is provided, `instructions` can be a short description instead of full NL instructions

### 2B. Tier router + direct executor in skill poller

**File**: `Orchestrator/src/jobs/functions.ts`

Add `execution_plan` to `SkillRecord` interface (line 498):
```typescript
execution_plan?: string | null;
```

**Insert tier router** at line ~717 (before `await step.run('execute-skill-...')`):

```typescript
// Tier Router: Direct vs Agent execution
const executionPlan = skill.execution_plan
  ? (() => { try { return JSON.parse(skill.execution_plan); } catch { return null; } })()
  : null;

if (executionPlan && Array.isArray(executionPlan) && executionPlan.length > 0) {
  // DIRECT TIER — execute via ToolRouter, zero LLM
  await step.run(`direct-skill-${skill.id}`, async () => {
    const { executeWorkflow } = await import('./executor.js');
    const results = await executeWorkflow(executionPlan);
    // Check all steps succeeded
    const allSuccess = Object.values(results).every(r => r.success);
    const summary = allSuccess
      ? `Direct execution: ${executionPlan.length} step(s) completed`
      : `Direct execution: some steps failed`;
    // Update skill status
    await toolRouter.routeToolCall('memory_update_skill', {
      skill_id: skill.id,
      last_run_at: new Date().toISOString(),
      last_run_status: allSuccess ? 'success' : 'error',
      last_run_summary: summary,
    });
    if (!allSuccess) {
      await notifySkillFailure(skill, summary, triggerConfig);
    }
    executed++;
  });
  continue; // Skip the Thinker dispatch below
}
// AGENT TIER — existing Thinker dispatch follows...
```

### 2C. Update playbook instructions

**File**: `Thinker/src/agent/playbook-seed.ts` — rewrite `cron-scheduling` playbook

Key changes to instructions:
- Remove STEP 1 (CLASSIFY CRON JOB OR SKILL) — everything is a skill now
- Remove STEP 2A (IF CRON JOB) — no more `create_job`
- Replace with unified flow:
  1. Call `get_tool_catalog` to discover tools
  2. Determine if task is **simple** (fixed tool calls, static params) or **complex** (needs reasoning)
  3. For **simple**: produce `execution_plan` array with `{id, name, toolName, parameters}`
  4. For **complex**: produce `instructions` (natural language) + `required_tools`
  5. Confirm with user
  6. Call `memory_store_skill`

Update `required_tools` array: remove `create_job`, `list_jobs`, `delete_job`. Keep `memory_store_skill`, `memory_list_skills`, `memory_delete_skill`, `get_tool_catalog`.

### Phase 2 Tests

**Create**: `Memorizer-MCP/tests/unit/skill-execution-plan.test.ts` (or add to existing skill tests)
1. Store skill with `execution_plan` → stored and retrievable
2. Store skill without `execution_plan` → null in response
3. Update skill to add `execution_plan` → persisted
4. `execution_plan` round-trips through JSON serialization correctly

**Create**: `Orchestrator/tests/unit/tier-router.test.ts`
1. Skill with `execution_plan` → routes to direct execution
2. Skill with only `instructions` → routes to agent execution
3. Skill with invalid JSON `execution_plan` → falls back to agent
4. Skill with empty array `execution_plan` → falls back to agent
5. Direct execution calls `executeWorkflow()` with parsed plan steps

**Create**: `Orchestrator/tests/integration/workflow-direct-execution.test.ts`
1. Store a skill with `execution_plan` containing `telegram_send_message` step → verify stored
2. (If full stack running) Verify direct tier executes without Thinker involvement — check that `last_run_status` updates after poller fires

**Update**: `Thinker/tests/unit/playbook-seed.test.ts`
- Update test: `cron-scheduling` playbook no longer has `create_job` in `required_tools`
- Add test: playbook instructions mention `execution_plan` for simple tasks
- Add test: playbook `required_tools` includes `memory_store_skill`, `memory_list_skills`, `memory_delete_skill`, `get_tool_catalog`

**Run**: `cd Memorizer-MCP && npx vitest run` (all Memorizer tests)
**Run**: `cd Orchestrator && npx vitest run tests/unit/tier-router.test.ts`
**Run**: `cd Orchestrator && npx vitest run tests/integration/workflow-direct-execution.test.ts`
**Run**: `cd Thinker && npx vitest run tests/unit/playbook-seed.test.ts`
**Run**: `npx tsc --noEmit` in Orchestrator, Memorizer-MCP, and Thinker

---

## Phase 3: Unified Skills + Polish

### 3A. SKILL.md auto-scheduling

**File**: `Thinker/src/agent/skill-loader.ts`
- In `parseSkillFile()`, extract `trigger_config` from `metadata`:
  ```typescript
  const triggerConfig = meta.trigger_config as Record<string, unknown> | undefined;
  const maxSteps = typeof meta.max_steps === 'number' ? meta.max_steps : undefined;
  ```
- Add these to the returned `CachedPlaybook` (extend interface if needed) or return a richer object

**File**: `Thinker/src/agent/playbook-cache.ts`
- In `refresh()` (line 84), after loading file skills:
  - For each file skill with `trigger_config`, call Orchestrator to upsert a DB skill
  - Use a flag/timestamp to avoid re-syncing unchanged files
  - New method: `syncScheduledFileSkills(fileSkills)`

**Alternative approach** (simpler): Do the sync in the Orchestrator skill poller itself. Add a step at the beginning of `cronJobPollerFunction` that calls a new Orchestrator util to scan `~/.annabelle/skills/` for SKILL.md files with `trigger_config` and upsert them into Memorizer. This keeps all scheduling logic in the Orchestrator.

### 3B. One-shot `at` schedule

**File**: `Orchestrator/src/jobs/functions.ts` — insert after interval mode check (line 591):

```typescript
} else if (triggerConfig?.at) {
  // One-shot: fire if current time >= scheduled time
  const atTime = new Date(triggerConfig.at as string);
  if (!isNaN(atTime.getTime()) && now >= atTime) {
    isDue = true;
  }
}
```

After successful execution of a one-shot skill, auto-delete or disable:
```typescript
if (triggerConfig?.at) {
  await toolRouter.routeToolCall('memory_update_skill', {
    skill_id: skill.id,
    enabled: false,  // or memory_delete_skill
    last_run_summary: `One-shot fired at ${new Date().toISOString()}`,
  });
}
```

### 3C. Strict tool sandboxing

**File**: `Thinker/src/agent/loop.ts` (lines 1305-1322)

Currently, when `requiredTools` is provided, the code resolves tools from `this.tools[name]`. This already acts as a filter — only tools in `requiredTools` are included. But `this.tools` contains ALL available tools.

Make it stricter: after building `selectedTools` from `requiredTools`, do NOT fall back to `selectToolsWithFallback()`. Currently the code does:
```typescript
if (requiredTools && requiredTools.length > 0) {
  selectedTools = { ... };
} else {
  selectedTools = await selectToolsWithFallback(...);
}
```

This is already strict for skills with `requiredTools`. Verify it doesn't leak other tools.

### 3D. Remove cron job system

**Files to modify**:
- `Orchestrator/src/tools/jobs.ts` — remove `create_job`, `list_jobs`, `get_job_status`, `delete_job` definitions and handlers. Keep `queue_task` and `trigger_backfill` if still used.
- `Orchestrator/src/tools/index.ts` — remove job tool re-exports
- `Orchestrator/src/core/http-handlers.ts` — remove from `customToolDefinitions`
- `Orchestrator/src/server.ts` — remove from `customToolDefinitions`
- `Orchestrator/src/jobs/functions.ts` — remove `cronJobPollerFunction` (lines 208-336)
- `Orchestrator/src/jobs/executor.ts` — remove `BACKWARD_COMPAT_MAP` entries for old cron job tool names (keep the file since `executeWorkflow()` is used by direct tier)

### Phase 3 Tests

**Create**: `Thinker/tests/unit/skill-loader-schedule.test.ts`
1. SKILL.md with `trigger_config.schedule` in metadata → extracted correctly
2. SKILL.md without `trigger_config` → no schedule data
3. SKILL.md with `trigger_config.at` → extracted as one-shot

**Create**: `Orchestrator/tests/unit/one-shot-schedule.test.ts`
1. `trigger_config.at` in the past → `isDue = true`
2. `trigger_config.at` in the future → `isDue = false`
3. After one-shot fires → skill auto-disabled

**Update**: `Orchestrator/tests/integration/workflow-skills.test.ts`
- Verify cron job tools (`create_job`, etc.) are no longer available
- Verify `memory_store_skill` with `execution_plan` works end-to-end

**Run**: `cd Thinker && npx vitest run tests/unit/skill-loader-schedule.test.ts`
**Run**: `cd Orchestrator && npx vitest run tests/unit/one-shot-schedule.test.ts`
**Run**: Full test suite: `./test.sh`
**Run**: `npx tsc --noEmit` in all modified packages

---

## Files Summary

### Phase 1 (Foundation)
| Action | File |
|--------|------|
| Create | `Orchestrator/src/utils/skill-normalizer.ts` |
| Modify | `Orchestrator/src/core/http-handlers.ts` — add normalizer + cron validation hook |
| Modify | `Orchestrator/src/jobs/functions.ts` — graduated backoff replacing flat cooldown |
| Create | `Orchestrator/tests/unit/skill-normalizer.test.ts` |
| Create | `Orchestrator/tests/unit/graduated-backoff.test.ts` |
| Create | `Orchestrator/tests/integration/workflow-skill-normalizer.test.ts` |

### Phase 2 (Direct Execution Tier)
| Action | File |
|--------|------|
| Modify | `Memorizer-MCP/src/db/schema.ts` — add `execution_plan` column + migration |
| Modify | `Memorizer-MCP/src/tools/skills.ts` — add `execution_plan` to schemas + handlers |
| Modify | `Orchestrator/src/jobs/functions.ts` — tier router + direct executor |
| Modify | `Thinker/src/agent/playbook-seed.ts` — rewrite cron-scheduling playbook |
| Create | `Orchestrator/tests/unit/tier-router.test.ts` |
| Create | `Orchestrator/tests/integration/workflow-direct-execution.test.ts` |
| Update | `Thinker/tests/unit/playbook-seed.test.ts` |

### Phase 3 (Unified Skills + Polish)
| Action | File |
|--------|------|
| Modify | `Thinker/src/agent/skill-loader.ts` — extract `trigger_config` from SKILL.md |
| Modify | `Thinker/src/agent/playbook-cache.ts` — sync scheduled file skills to Memorizer |
| Modify | `Orchestrator/src/jobs/functions.ts` — add `at` one-shot schedule mode |
| Modify | `Orchestrator/src/tools/jobs.ts` — remove cron job tools |
| Modify | `Orchestrator/src/tools/index.ts` — remove job tool exports |
| Modify | `Orchestrator/src/core/http-handlers.ts` — remove from customToolDefinitions |
| Modify | `Orchestrator/src/server.ts` — remove from customToolDefinitions |
| Modify | `Orchestrator/src/jobs/executor.ts` — clean up backward compat map |
| Create | `Thinker/tests/unit/skill-loader-schedule.test.ts` |
| Create | `Orchestrator/tests/unit/one-shot-schedule.test.ts` |
| Update | `Orchestrator/tests/integration/workflow-skills.test.ts` |

---

## End-to-end verification after all phases

1. **Manual Telegram test** — send "send me hello every minute" → should create Direct-tier skill with `execution_plan` → verify Telegram messages arrive without Thinker involvement
2. **Manual Telegram test** — send "check AI news every 3 hours, summarize, send to Telegram" → should create Agent-tier skill with `instructions` + `required_tools`
3. **Manual Telegram test** — send "remind me at 5pm about the meeting" → should create one-shot skill, fire once, auto-delete
4. Full test suite: `./test.sh`
5. `npx tsc --noEmit` in Orchestrator, Memorizer-MCP, and Thinker
