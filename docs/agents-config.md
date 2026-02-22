# agents.json Configuration Reference

The agents config file defines Thinker agent instances and channel-to-agent routing. Set the path via `AGENTS_CONFIG_PATH` in `Orchestrator/.env`.

Copy the example to get started:

```bash
cp agents.json.example agents.json
```

## Top-Level Structure

```json
{
  "agents": [ ... ],
  "bindings": [ ... ]
}
```

## Agent Definition

Each object in the `agents` array defines one Thinker instance:

```json
{
  "agentId": "hexa-puffs",
  "enabled": true,
  "port": 8006,
  "llmProvider": "groq",
  "model": "meta-llama/llama-4-maverick-17b-128e-instruct",
  "temperature": 0.6,
  "systemPrompt": "",
  "allowedTools": [],
  "deniedTools": [],
  "maxSteps": 8,
  "idleTimeoutMinutes": 30,
  "costControls": { ... }
}
```

### Agent Fields

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `agentId` | string | Yes | — | Unique identifier for this agent |
| `enabled` | boolean | No | `true` | Whether the agent is active |
| `port` | number | Yes | — | HTTP port for this Thinker instance |
| `llmProvider` | string | No | `"groq"` | LLM provider: `"groq"`, `"lmstudio"`, or `"ollama"` |
| `model` | string | No | provider default | Provider-specific model name |
| `temperature` | number | No | `0.4` | LLM temperature (0-2) |
| `systemPrompt` | string | No | `""` | Custom system prompt (empty = use default persona) |
| `allowedTools` | string[] | No | `[]` | Glob patterns of permitted tools (empty = all allowed) |
| `deniedTools` | string[] | No | `[]` | Glob patterns of denied tools (evaluated after allow) |
| `maxSteps` | number | No | `8` | Max ReAct loop steps per message (1-50) |
| `idleTimeoutMinutes` | number | No | `30` | Minutes of inactivity before the agent is idle-killed |
| `costControls` | object | No | — | Cost control config (see below) |

### Tool Policy

- `allowedTools: ["telegram_*", "memory_*"]` — only these glob patterns are permitted
- `deniedTools: ["telegram_delete_*"]` — blocked even if allowed
- Empty `allowedTools` = all tools permitted (only `deniedTools` evaluated)
- Glob matching uses `*` as wildcard (e.g., `gmail_*` matches `gmail_send_email`)

### Cost Controls

Per-agent LLM cost monitoring with anomaly-based spike detection. When triggered, the agent pauses and Orchestrator sends a Telegram alert.

```json
{
  "costControls": {
    "enabled": true,
    "shortWindowMinutes": 2,
    "spikeMultiplier": 3.0,
    "hardCapTokensPerHour": 250000,
    "minimumBaselineTokens": 1000,
    "notifyChatId": "<YOUR_TELEGRAM_CHAT_ID>"
  }
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | Enable cost monitoring |
| `shortWindowMinutes` | number | `2` | Short window for spike detection (1-30) |
| `spikeMultiplier` | number | `3.0` | Spike threshold: short-window rate must exceed baseline x this (1.5-10) |
| `hardCapTokensPerHour` | number | `500000` | Absolute max tokens in any 60-minute window (min 10,000) |
| `minimumBaselineTokens` | number | `1000` | Min baseline tokens before spike detection activates (min 100) |
| `notifyChatId` | string | — | Telegram chat ID for cost alert notifications (falls back to message sender) |

**How it works:**

1. Orchestrator passes cost config to Thinker via environment variables at spawn time
2. Thinker's `CostMonitor` tracks tokens in a 60-bucket sliding window (1 bucket/minute)
3. After each LLM call, checks for spike (short-window rate > baseline x multiplier) or hard cap
4. If triggered, Thinker pauses and returns `{ paused: true }`
5. Orchestrator marks agent paused, sends Telegram notification, stops dispatching
6. Resume via `POST /agents/:agentId/resume` or `/cost-resume` on the Thinker

## Bindings

Bindings map `(channel, chatId)` pairs to agents:

```json
{
  "bindings": [
    { "channel": "telegram", "chatId": "*", "agentId": "hexa-puffs" },
    { "channel": "telegram", "chatId": "123456", "agentId": "work-assistant" }
  ]
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `channel` | string | Yes | Channel type (currently `"telegram"`) |
| `chatId` | string | Yes | Specific chat ID or `"*"` for wildcard |
| `agentId` | string | Yes | Which agent handles messages from this binding |

**Resolution order:**

1. **Exact match** — `channel` + `chatId` both match
2. **Wildcard** — `channel` matches, `chatId` is `"*"`
3. **Default** — falls back to the first available agent

## Example: Multi-Agent Setup

```json
{
  "agents": [
    {
      "agentId": "hexa-puffs",
      "enabled": true,
      "port": 8006,
      "llmProvider": "groq",
      "model": "meta-llama/llama-4-maverick-17b-128e-instruct",
      "maxSteps": 8,
      "costControls": {
        "enabled": true,
        "hardCapTokensPerHour": 250000,
        "notifyChatId": "123456"
      }
    },
    {
      "agentId": "work-assistant",
      "enabled": true,
      "port": 8007,
      "llmProvider": "groq",
      "model": "llama-3.3-70b-versatile",
      "allowedTools": ["gmail_*", "memory_*", "filer_*"],
      "deniedTools": ["gmail_delete_*"],
      "maxSteps": 12
    }
  ],
  "bindings": [
    { "channel": "telegram", "chatId": "123456", "agentId": "work-assistant" },
    { "channel": "telegram", "chatId": "*", "agentId": "hexa-puffs" }
  ]
}
```

## Related

- [Orchestrator README](../Orchestrator/README.md) — Multi-Agent Architecture, Cost Controls
- [docs/cost-controls.md](cost-controls.md) — Detailed algorithm documentation
