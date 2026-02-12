# Cost Controls

Anomaly-based token consumption monitoring for autonomous Thinker agents. Detects runaway LLM usage via spike detection and hard caps, automatically pausing agents and sending Telegram alerts.

## Architecture

```
agents.json                    Orchestrator                        Thinker
┌──────────────┐    startup    ┌─────────────────────┐   spawn    ┌──────────────────────┐
│ costControls ├──────────────►│ AgentManager        ├──────────►│ Config               │
│   enabled    │               │   buildAgentEnv()   │  env vars  │   THINKER_COST_*     │
│   spikeMult  │               │                     │           │                      │
│   hardCap    │               │                     │           │ CostMonitor          │
│   ...        │               │                     │           │   60-bucket window   │
└──────────────┘               └──────┬──────────────┘           │   recordUsage()      │
                                      │                          │   checkThresholds()  │
                                      │ dispatch                 └──────┬───────────────┘
                                      │ message                         │
                                      ▼                                 │ paused: true
                               ┌─────────────────────┐                 │
                               │ Orchestrator         │◄────────────────┘
                               │   dispatchMessage()  │
                               │                      │  ┌─────────────────────┐
                               │   markPaused()       ├─►│ Telegram alert      │
                               │   block new messages │  │ to notifyChatId     │
                               └──────────────────────┘  └─────────────────────┘
```

**Flow summary:**
1. Orchestrator reads `costControls` from `agents.json` and injects them as `THINKER_COST_*` environment variables when spawning Thinker
2. Thinker's `CostMonitor` records token usage after every LLM call
3. If a threshold fires, Thinker returns `{ paused: true }` to Orchestrator
4. Orchestrator marks the agent as paused, blocks future messages, and sends a Telegram alert
5. Admin resumes via REST API

## Configuration

Cost controls are configured per-agent in `agents.json`:

```json
{
  "agents": [
    {
      "agentId": "annabelle",
      "costControls": {
        "enabled": true,
        "shortWindowMinutes": 2,
        "spikeMultiplier": 3.0,
        "hardCapTokensPerHour": 250000,
        "minimumBaselineTokens": 1000,
        "notifyChatId": "8304042211"
      }
    }
  ]
}
```

### Fields

| Field | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `enabled` | boolean | `false` | — | Master switch. When false, no tracking occurs. |
| `shortWindowMinutes` | integer | `2` | 1–30 | Size of the "recent" window for spike detection. |
| `spikeMultiplier` | number | `3.0` | 1.5–10 | Spike threshold. Short-window rate must exceed baseline rate multiplied by this value. |
| `hardCapTokensPerHour` | integer | `500000` | min 10,000 | Absolute safety cap — total tokens in any 60-minute window. |
| `minimumBaselineTokens` | integer | `1000` | min 100 | Minimum total tokens in the baseline window before spike detection activates. Prevents false positives during cold start. |
| `notifyChannel` | string | _(optional)_ | — | Channel for cost alert notifications. Falls back to originating message channel. |
| `notifyChatId` | string | _(optional)_ | — | Telegram chat ID for cost alert notifications. Falls back to the chat that triggered the pause. |

Schema: `CostControlsSchema` in `Orchestrator/src/config/agents.ts:17-38`

### Environment Variable Mapping

Orchestrator translates the config into env vars when spawning Thinker (`agent-manager.ts:445-452`):

| Config Field | Environment Variable |
|---|---|
| `enabled` | `THINKER_COST_CONTROL_ENABLED` |
| `shortWindowMinutes` | `THINKER_COST_SHORT_WINDOW_MINUTES` |
| `spikeMultiplier` | `THINKER_COST_SPIKE_MULTIPLIER` |
| `hardCapTokensPerHour` | `THINKER_COST_HARD_CAP_PER_HOUR` |
| `minimumBaselineTokens` | `THINKER_COST_MIN_BASELINE_TOKENS` |

## Algorithm

The `CostMonitor` class (`Thinker/src/cost/monitor.ts`) implements a sliding-window anomaly detector.

### Sliding Window

- **60 buckets**, one per minute, covering a 1-hour window
- Each bucket tracks: `promptTokens`, `completionTokens`, `callCount`
- The window advances automatically — when time moves to a new minute, old buckets shift left and expired ones are recycled
- If the time gap exceeds 60 minutes, the entire window resets

```
Minute:  [t-59] [t-58] ... [t-shortWindow] ... [t-1] [t-0]
         ├────── baseline window ──────────┤├─ short ─────┤
```

### Token Recording

After every `generateText()` call in the agent loop (`Thinker/src/agent/loop.ts`):

```typescript
this.costMonitor.recordUsage(promptTokens, completionTokens);
```

This:
1. Advances the window (if the minute has changed)
2. Adds tokens to the current bucket
3. Checks both thresholds (unless already paused)

### Threshold 1: Hard Cap (always active)

```
totalTokensInWindow >= hardCapTokensPerHour  →  PAUSE
```

The hard cap is a simple absolute limit. It triggers regardless of baseline data, making it the safety net during cold start when spike detection can't activate yet.

**Example:** With `hardCapTokensPerHour: 250000`, if the agent consumes 250,000+ tokens in any rolling 60-minute window, it pauses immediately.

### Threshold 2: Spike Detection (requires baseline)

```
IF baselineTokens >= minimumBaselineTokens:
  shortRate = shortWindowTokens / shortWindowMinutes
  baselineRate = baselineTokens / activeBaselineBuckets
  IF shortRate > baselineRate × spikeMultiplier  →  PAUSE
```

Key details:

- **Short window** = last N minutes (configured by `shortWindowMinutes`)
- **Baseline** = everything before the short window in the 60-minute history
- **Active buckets only** — baseline rate is averaged over buckets that have at least 1 LLM call (`callCount > 0`). This prevents empty/idle buckets from diluting the rate and causing false spikes during ramp-up or intermittent usage.
- **Cold-start protection** — spike detection is skipped entirely until the baseline accumulates `minimumBaselineTokens`. During cold start, only the hard cap provides protection.

**Example:** With `spikeMultiplier: 3.0` and `shortWindowMinutes: 2`, if the baseline rate is 100 tokens/min and the last 2 minutes average 350 tokens/min, that's a 3.5x spike — exceeds the 3.0x threshold — pause triggered.

### Why Active-Bucket Averaging?

Consider an agent that processes a few messages, then goes idle for 30 minutes, then gets another message. Without active-bucket filtering, the 30 idle minutes would deflate the baseline rate, making the next normal message look like a spike. By only counting minutes with actual LLM calls, the baseline reflects true usage patterns.

## Pause Behavior

When either threshold triggers:

### Thinker Side

1. `CostMonitor` sets `paused = true` and records the `pauseReason`
2. On the next message, the agent loop checks `costMonitor.paused` before processing
3. Returns early with:
   ```json
   {
     "success": false,
     "toolsUsed": [],
     "totalSteps": 0,
     "error": "Agent paused: Hard cap exceeded: 260,000 tokens...",
     "paused": true
   }
   ```

### Orchestrator Side

**Post-dispatch** (`orchestrator.ts:574-590`): When Thinker returns `paused: true`:
1. Calls `agentManager.markPaused(agentId, reason)` — records the pause state
2. Sends a Telegram notification to the configured `notifyChatId` (or falls back to the originating chat)

**Pre-dispatch** (`orchestrator.ts:555-561`): On subsequent messages:
1. Calls `agentManager.isAgentPaused(agentId)` before dispatching
2. If paused, immediately responds with `"Agent is currently paused due to cost controls"` — the message never reaches Thinker

This two-layer approach means:
- The first message that triggers the pause still gets a response (the pause reason)
- All subsequent messages are blocked at the Orchestrator level without hitting Thinker

## Notification System

When a cost-control pause is detected, Orchestrator sends a Telegram alert:

```
Agent "annabelle" has been paused due to unusual token consumption.

Reason: Token spike detected: 1,200 tokens/min in the last 2 min vs 150 tokens/min baseline (3x threshold)

The agent will not process messages until resumed.
```

**Destination logic:**
1. If `notifyChatId` is configured → always notify that chat (useful for admin monitoring regardless of who triggered the spike)
2. Otherwise → notify the user whose message triggered the pause

The `notifyChannel` field works the same way for the channel (e.g., `"telegram"`), falling back to the originating message's channel.

## Resume

### REST API: Orchestrator

```
POST /agents/{agentId}/resume
Content-Type: application/json

{ "resetWindow": true }
```

- `resetWindow` (optional, default `false`): Clears the entire 60-minute token history
- Returns: `{ "success": true, "message": "Agent \"annabelle\" resumed" }`
- Returns 400 if agent is not paused or not found
- Returns 404 in single-agent mode (no AgentManager)

Source: `Orchestrator/src/index.ts:123-142`

This endpoint calls through to Thinker's `/cost-resume` internally.

### REST API: Thinker (direct)

```
GET /cost-status
```

Returns the current `CostStatus` snapshot:

```json
{
  "enabled": true,
  "paused": true,
  "pauseReason": "Hard cap exceeded: 260,000 tokens in the last hour (cap: 250,000)",
  "pausedAt": "2026-02-10T14:32:00.000Z",
  "currentHourTokens": 260000,
  "shortWindowTokensPerMinute": 1200,
  "baselineTokensPerMinute": 150,
  "hardCapTokensPerHour": 250000,
  "spikeMultiplier": 3.0,
  "shortWindowMinutes": 2,
  "activeBuckets": 25
}
```

```
POST /cost-resume
Content-Type: application/json

{ "resetWindow": true }
```

Directly resumes the Thinker's CostMonitor. Used internally by Orchestrator's `agentManager.resumeAgent()`.

Source: `Thinker/src/index.ts:192-214`

### Reset Window: When to Use It

| Scenario | Use `resetWindow`? | Why |
|---|---|---|
| Transient spike (one-off large context) | Yes | Old data would immediately re-trigger the pause |
| Legitimate sustained high usage | Yes | You've acknowledged the usage and want a fresh baseline |
| Investigating a potential issue | No | Keep the data for analysis via `/cost-status` |

**Without reset:** The old token data remains. If it already exceeded the hard cap, even recording 1 more token will re-trigger the pause. Use this when you want conservative monitoring.

**With reset:** All 60 buckets are cleared. The agent starts fresh with zero history. Spike detection won't activate until the baseline rebuilds past `minimumBaselineTokens`.

## Tuning Guide

### Conservative (tight monitoring)

```json
{
  "shortWindowMinutes": 1,
  "spikeMultiplier": 2.0,
  "hardCapTokensPerHour": 100000,
  "minimumBaselineTokens": 500
}
```

Catches smaller spikes faster, but may produce false positives during bursty workloads.

### Balanced (default-like)

```json
{
  "shortWindowMinutes": 2,
  "spikeMultiplier": 3.0,
  "hardCapTokensPerHour": 250000,
  "minimumBaselineTokens": 1000
}
```

Good for general use. Allows normal variation while catching genuine runaway consumption.

### Relaxed (high-throughput agents)

```json
{
  "shortWindowMinutes": 5,
  "spikeMultiplier": 5.0,
  "hardCapTokensPerHour": 500000,
  "minimumBaselineTokens": 5000
}
```

Wider windows and higher thresholds for agents that handle large contexts or many concurrent conversations.

### Key Relationships

- **Lower `shortWindowMinutes`** = faster detection but more noise from brief bursts
- **Higher `spikeMultiplier`** = more tolerant of variation, only catches extreme spikes
- **Lower `minimumBaselineTokens`** = spike detection activates sooner after cold start, but baseline may be less reliable
- **Hard cap** is your ultimate safety net — set it to the absolute maximum you'd tolerate in any 60-minute period regardless of pattern

## Design Decisions

1. **In-process monitoring** — No background jobs or polling. Checks happen synchronously inside `recordUsage()` after each LLM call. Zero latency between token consumption and detection.

2. **Active-bucket averaging** — Prevents false positives during idle periods by only counting minutes with actual LLM activity in the baseline rate.

3. **Dual thresholds** — Spike detection handles anomalies relative to normal patterns. Hard cap provides an absolute safety net that works even during cold start.

4. **Orchestrator-level blocking** — Once paused, messages are rejected at the Orchestrator before they reach Thinker, preventing any further token consumption.

5. **Configurable notification destination** — Alerts can go to a dedicated admin chat rather than the user who happened to trigger the spike.

6. **Explicit resume required** — The agent stays paused until a human explicitly resumes it via REST API. No auto-recovery, no timeout. This is intentional for safety.

## File Reference

| Component | File | Key Lines |
|---|---|---|
| Config schema | `Orchestrator/src/config/agents.ts` | 17–38 |
| Type definitions | `Thinker/src/cost/types.ts` | Full file |
| Core algorithm | `Thinker/src/cost/monitor.ts` | Full file (238 lines) |
| Token recording | `Thinker/src/agent/loop.ts` | recordUsage calls, pause checks |
| Thinker HTTP endpoints | `Thinker/src/index.ts` | 192–214 |
| Env var injection | `Orchestrator/src/agents/agent-manager.ts` | 445–452 |
| Pause/resume tracking | `Orchestrator/src/agents/agent-manager.ts` | 719–757 |
| Dispatch interception | `Orchestrator/src/core/orchestrator.ts` | 555–561, 574–590 |
| REST API resume | `Orchestrator/src/index.ts` | 123–142 |
| Configuration | `agents.json` | costControls block |
| Tests (16 tests) | `Thinker/tests/cost-monitor.test.ts` | Full file (242 lines) |
