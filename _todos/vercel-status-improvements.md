# Vercel Status Response Improvements

**Goal**: When asking "what's the status of my project on Vercel", get actionable error/warning logs instead of generic info like "uses Next.js, hobby plan".

## Available Vercel MCP Tool Capabilities

### getDeployments
- `state` param: filter by `"ERROR"`, `"READY"`, `"BUILDING"`, etc.
- `since`/`until` timestamps: filter by time range
- `limit`: cap number of results
- `app`: filter by project name
- Returns: `errorCode`, `errorMessage`, `checksConclusion`, `oomReport` per deployment

### getDeploymentEvents
- `direction: "backward"` — newest first
- `limit` — cap number of events
- `statusCode` — server-side filter by HTTP status code range
- Returns events with `type` (stderr, fatal, exit, stdout, command) and `level` (error, warning)
- **No server-side error/warning filter** — must filter post-response

### getDeployment
- Returns: `status`, `errorCode`, `errorMessage`, `oomReport`, per-lambda `readyState`

---

## Options

### A. Playbook-only (no code changes)

Rewrite `~/.annabelle/skills/VercelStatus/SKILL.md` instructions to tell the LLM:

1. Call `getDeployments` with `limit: 5` — get recent deployments
2. Scan the list for any with `state: "ERROR"` or `checksConclusion: "failed"`
3. For the latest deployment, call `getDeploymentEvents` with `direction: "backward"`, `limit: 50`
4. In the response, **only show**: deployment status, error events (type=stderr/fatal, level=error/warning), and timing
5. Format as: status line, then bulleted error/warning log entries with timestamps
6. Skip generic info like "uses Next.js" or "hobby plan"

**Pros**: Zero code, fast to iterate, LLM follows the formatting rules
**Cons**: LLM still receives all the data and decides what to show — might still include fluff

### B. Response post-processor in Thinker (code change)

Add a lightweight formatter in `Thinker/src/orchestrator/tools.ts` that intercepts Vercel tool responses before they reach the LLM:

- Strip noisy fields (`creator`, `meta`, `team`, `customEnvironment`, etc.)
- Highlight `state: "ERROR"` deployments
- From `getDeploymentEvents`, pre-filter to only `type=stderr|fatal` or `level=error|warning` events
- Add a computed `errorSummary` field

**Pros**: LLM gets clean data, shorter context, more reliable formatting
**Cons**: Tight coupling to Vercel's response format, more code to maintain

### C. Dedicated composite tool (most robust)

Add a new tool in the Orchestrator that chains the 2-3 Vercel MCP calls internally:

1. `getDeployments(app, limit:5)` — find latest deployments
2. For any ERROR deployments, `getDeploymentEvents(id, direction:backward, limit:50)` — get logs
3. Filter events to errors/warnings, compute timing (how long ago, build duration)
4. Return a single structured response: `{ deployments: [...], errors: [...], warnings: [...] }`

**Pros**: Single tool call instead of 3, cleanest LLM context, most consistent output
**Cons**: Most work, new tool to maintain, less flexible

---

## Recommendation

Start with **A** (rewrite the playbook) — zero code, tests whether better instructions alone fix output quality. If the LLM still includes fluff or misses errors, escalate to **B** (response post-processor) which strips noise before the LLM sees it. Option C is overkill for now.

## Key Error Event Types to Filter

```
type === "stderr"           → standard error output
type === "fatal"            → fatal errors
level === "error"           → explicit error level
level === "warning"         → warning level
type === "exit"             → process exit (check exit code)
payload.statusCode >= 400   → HTTP errors
```

## Key Deployment Error Fields

```
state: "ERROR"              → deployment failed
errorCode + errorMessage    → error details
checksConclusion: "failed"  → checks failed
oomReport: "out-of-memory"  → OOM
lambdas[].readyState: "ERROR" → individual function failures
```
