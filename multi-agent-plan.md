# Multi-Agent Architecture: Path B (Multiple Thinker Instances)

## Context

Annabelle currently runs a single agent (Thinker) that polls Telegram, processes messages through a ReAct loop, and sends responses directly. To support multiple specialized agents (personal assistant, work assistant, code reviewer, etc.) with true process isolation — superior to OpenClaw's monolithic in-process model — we need to restructure responsibilities between Orchestrator and Thinker.

**Core shift**: Orchestrator evolves from a tool router into an agent router. Thinker evolves from a self-polling monolith into a generic agent runtime that receives messages via HTTP and returns responses.

**Design decisions** (from user):
- Orchestrator owns ALL agent config (prompts, tools, model, bindings)
- Orchestrator spawns Thinker instances (like it spawns MCPs)
- Incremental rollout in 3 phases

---

## Phase 1: Move Polling to Orchestrator + Single Thinker via HTTP

**Goal**: Restructure responsibility so Orchestrator polls channels and pushes messages to Thinker. Same single-agent behavior, just different ownership.

### Orchestrator changes

#### New file: `Orchestrator/src/core/channel-poller.ts`
- `ChannelPoller` class — extracts polling logic from `Thinker/src/agent/loop.ts` (`pollAndProcess`, `refreshMonitoredChats`)
- Uses the existing ToolRouter to call Telegram tools (`telegram_get_messages`, `telegram_list_chats`, `telegram_get_me`) — no new Telegram client needed
- Maintains `processedMessageIds: Set<string>` for deduplication
- Maintains `botUserId` (fetched via `telegram_get_me` at init)
- Maintains `monitoredChatIds` (refreshed every 5 min via `telegram_list_chats`)
- Emits messages via callback: `onMessage(msg: IncomingAgentMessage)`
- Same filtering logic as current Thinker: skip bot's own messages, skip old (>2min), skip bot-like patterns, max 3 per cycle
- `start(intervalMs)` / `stop()` methods

#### New file: `Orchestrator/src/core/thinker-client.ts`
- `ThinkerClient` class — HTTP client for communicating with a Thinker instance
- `processMessage(msg: IncomingAgentMessage): Promise<ProcessingResponse>` — POST to `/process-message`
- `executeSkill(instructions, maxSteps, notifyChatId?): Promise<SkillResponse>` — POST to `/execute-skill` (existing endpoint)
- `healthCheck(): Promise<boolean>` — GET `/health`
- Reuses same HTTP fetch pattern as `Thinker/src/orchestrator/client.ts`

#### New file: `Orchestrator/src/core/agent-types.ts`
- Shared types: `IncomingAgentMessage`, `ProcessingResponse` (Zod schemas for validation)

#### Modify: `Orchestrator/src/core/orchestrator.ts`
- Add `private channelPoller: ChannelPoller`
- Add `private thinkerClient: ThinkerClient`
- In `initialize()`, after tool discovery:
  - Create `ThinkerClient` pointing to `config.thinkerUrl`
  - Create `ChannelPoller` using `this.toolRouter`
  - Set `channelPoller.onMessage = (msg) => this.dispatchMessage(msg)`
  - Start polling (if enabled via config)
- Add `dispatchMessage(msg)` method:
  - Calls `thinkerClient.processMessage(msg)`
  - On success: sends response to Telegram via `toolRouter.routeToolCall('telegram_send_message', { chat_id, message })`
  - On failure: logs error (no message sent, matching current behavior)
  - Stores conversation via `toolRouter.routeToolCall('memory_store_conversation', {...})`

#### Modify: `Orchestrator/src/config/schema.ts`
- Add to Config:
  ```
  channelPolling?: {
    enabled: boolean (default: false)
    intervalMs: number (default: 10000)
    maxMessagesPerCycle: number (default: 3)
  }
  ```

#### Modify: `Orchestrator/src/config/index.ts`
- Wire `CHANNEL_POLLING_ENABLED`, `CHANNEL_POLL_INTERVAL_MS` env vars

### Thinker changes

#### Modify: `Thinker/src/index.ts`
- Add `POST /process-message` endpoint:
  - Accepts `{ chatId, senderId, text, agentId, messageId }` body
  - Calls `agent.processMessage(message)` (existing method)
  - Returns `{ success, response, toolsUsed, totalSteps, error }` as JSON
  - Does NOT send the response to Telegram — Orchestrator handles delivery
- Make `agent.startPolling()` conditional on `config.pollingEnabled`

#### Modify: `Thinker/src/config.ts`
- Add `pollingEnabled: z.boolean().default(true)` — env: `THINKER_POLLING_ENABLED`
- Add `sendResponseDirectly: z.boolean().default(true)` — env: `THINKER_SEND_RESPONSE_DIRECTLY`

#### Modify: `Thinker/src/agent/loop.ts`
- In `processMessage()`: make Telegram response sending conditional on `config.sendResponseDirectly`
- When `sendResponseDirectly=false`, the method still runs ReAct loop and returns the result, but skips the `telegramDirect.sendMessage()` and `orchestrator.storeConversation()` calls (Orchestrator does these)

### Migration (zero downtime)
1. Deploy Thinker first with new endpoint. `pollingEnabled=true` by default — no behavior change
2. Deploy Orchestrator with `CHANNEL_POLLING_ENABLED=false` — no behavior change
3. Switch: set `CHANNEL_POLLING_ENABLED=true` + `THINKER_POLLING_ENABLED=false` + `THINKER_SEND_RESPONSE_DIRECTLY=false`. Restart both
4. Verify identical behavior

### Tests
- `Orchestrator/tests/unit/channel-poller.test.ts` — mock ToolRouter, verify filtering/dedup
- `Orchestrator/tests/unit/thinker-client.test.ts` — mock fetch, verify request/response format
- `Thinker/tests/unit/process-message-endpoint.test.ts` — mock Agent, verify endpoint

---

## Phase 2: Multi-Agent Config + Spawn Multiple Thinkers

**Goal**: Orchestrator defines multiple agents and spawns a Thinker process per agent.

### Orchestrator changes

#### New file: `Orchestrator/src/config/agents.ts`
- `AgentDefinition` type + Zod schema:
  ```
  agentId: string
  enabled: boolean
  port: number
  llmProvider: 'groq' | 'lmstudio' | 'ollama'
  model: string
  systemPrompt: string
  allowedTools?: string[]  // glob patterns like 'gmail_*', 'filer_*'
  deniedTools?: string[]
  maxSteps: number
  ```
- Default agent config (backward compat: single "annabelle" agent matching current behavior)

#### New file: `Orchestrator/src/core/agent-manager.ts`
- `AgentManager` class — spawns and manages Thinker processes
- Reuses lifecycle pattern from existing `StdioMCPClient` (spawn via `child_process.spawn`, health check, auto-restart)
- `spawnAgent(def: AgentDefinition)`: spawns `node Thinker/dist/index.js` with env vars:
  - `THINKER_PORT`, `THINKER_AGENT_ID`, `ORCHESTRATOR_URL`
  - `THINKER_POLLING_ENABLED=false`, `THINKER_SEND_RESPONSE_DIRECTLY=false`
  - `THINKER_LLM_PROVIDER`, `GROQ_MODEL` / `OLLAMA_MODEL` / etc.
  - `THINKER_SYSTEM_PROMPT_PATH` (file path to prompt, written by Orchestrator at spawn)
- `initializeAll()`: spawns all enabled agents in parallel
- `getClient(agentId): ThinkerClient | null`
- `healthCheckAll()`: periodic checks, auto-restart crashed agents
- `getStatus(): Record<string, { available, port }>`
- Internal state: `Map<string, { config, client: ThinkerClient, process: ChildProcess, available }>`

#### Modify: `Orchestrator/src/core/orchestrator.ts`
- Replace `thinkerClient` with `agentManager: AgentManager`
- `dispatchMessage` becomes: `agentManager.getClient(agentId).processMessage(msg)`
- For Phase 2, still single routing: all messages go to default agent
- Add agent status to `getStatus()` response
- Agent health monitoring integrated into existing `startHealthMonitoring()` loop

#### Modify: `Orchestrator/src/core/sessions.ts`
- `getOrCreate(agentId: string, sessionId?: string)` — compound key `${agentId}:${sessionId}`
- Add `agentId` field to `Session` interface
- `getStats()` returns per-agent breakdown

#### Modify: `Orchestrator/src/config/schema.ts` + `index.ts`
- Add `agents?: AgentDefinition[]` to Config
- Load from `AGENTS_CONFIG_PATH` env var (JSON file) or fall back to single agent from `thinkerUrl`

### Thinker changes

#### Modify: `Thinker/src/config.ts`
- Add `systemPromptPath: z.string().optional()` — env: `THINKER_SYSTEM_PROMPT_PATH`

#### Modify: `Thinker/src/agent/loop.ts`
- In `buildContext()`: if `config.systemPromptPath` is set, read file and use as system prompt instead of `DEFAULT_SYSTEM_PROMPT`
- Agent personality is now driven by config, not hardcoded

#### Modify: `Thinker/src/orchestrator/client.ts`
- Add `X-Agent-Id` header to all requests (from `config.thinkerAgentId`)
- `discoverTools()` passes `agentId` query param → Orchestrator can filter in Phase 3

### Migration
1. Deploy with no `agents` config — falls back to single agent, identical behavior
2. Create `agents.json`, set `AGENTS_CONFIG_PATH`, remove manual Thinker from `start-all.sh`
3. Orchestrator spawns Thinker automatically
4. Add second agent definition to test multi-agent

### Tests
- `Orchestrator/tests/unit/agent-manager.test.ts` — mock child_process, verify spawn env vars, health check, restart
- `Orchestrator/tests/unit/agent-config.test.ts` — validate schema, test fallback to single agent

---

## Phase 3: Channel Bindings + Tool Policy Enforcement

**Goal**: Config-driven message routing, per-agent tool enforcement at Orchestrator level, per-agent Guardian policies.

### Orchestrator changes

#### New file: `Orchestrator/src/core/message-router.ts`
- `MessageRouter` class
- `resolveAgents(channel: string, chatId: string): string[]` — returns agent IDs
- Config-driven bindings:
  ```
  bindings:
    - { channel: telegram, chatId: "12345", agentId: work }
    - { channel: telegram, chatId: "*", agentId: annabelle }   # default
    - { channel: gmail, chatId: "*", agentId: annabelle }
  ```
- Matching: exact chatId > wildcard > default agent
- Broadcast support: returns multiple agentIds for broadcast channels

#### Modify: `Orchestrator/src/core/tool-router.ts`
- Add `getFilteredToolDefinitions(allowedTools?: string[], deniedTools?: string[]): MCPToolDefinition[]`
  - Filters using glob matching on tool names
- Add `routeToolCallWithPolicy(toolName, args, agentId): Promise<ToolCallResult>`
  - Looks up agent's tool policy
  - Rejects if tool not allowed: `{ success: false, error: 'Tool not available for agent X' }`
  - Otherwise delegates to existing `routeToolCall()`

#### Modify: `Orchestrator/src/core/orchestrator.ts`
- Integrate `MessageRouter` — `dispatchMessage` uses router to find correct agent
- Tool calls from Thinker instances pass through policy check (via `X-Agent-Id` header)

#### Modify: `Orchestrator/src/server.ts`
- `GET /tools/list?agentId=X` → returns filtered tool list
- `POST /tools/call` reads `X-Agent-Id` header → enforces tool policy

#### Modify: `Orchestrator/src/config/guardian.ts`
- Add per-agent overrides: `agentOverrides: Record<string, { input, output }>` — allows stricter/relaxed scanning per agent

### Thinker changes (cleanup)

#### Delete: `Thinker/src/telegram/client.ts`
- No longer needed — all channel I/O goes through Orchestrator

#### Modify: `Thinker/src/agent/loop.ts`
- Remove `telegramDirect` usage entirely
- Remove `startPolling()`, `pollAndProcess()`, `refreshMonitoredChats()`
- Remove bot message filtering (Orchestrator handles this now)
- The `send_telegram` essential tool becomes a ToolRouter call (already works as fallback)

### Migration
1. Deploy with default routing (all messages → default agent). Identical behavior
2. Add bindings for specific chats → specific agents. Test incrementally
3. Enable tool policies per agent. Verify restricted agents can't call denied tools
4. Remove Thinker's direct Telegram client (cleanup)

### Tests
- `Orchestrator/tests/unit/message-router.test.ts` — exact match, wildcard, default, broadcast
- `Orchestrator/tests/unit/tool-policy.test.ts` — allow/deny glob matching, rejection of denied tools
- `Orchestrator/tests/integration/multi-agent-routing.test.ts` — end-to-end: message from chat A → agent A, chat B → agent B

---

## Files Summary

### New files (6)
| File | Phase |
|------|-------|
| `Orchestrator/src/core/agent-types.ts` | 1 |
| `Orchestrator/src/core/channel-poller.ts` | 1 |
| `Orchestrator/src/core/thinker-client.ts` | 1 |
| `Orchestrator/src/config/agents.ts` | 2 |
| `Orchestrator/src/core/agent-manager.ts` | 2 |
| `Orchestrator/src/core/message-router.ts` | 3 |

### Modified files
| File | Phases | Key changes |
|------|--------|-------------|
| `Orchestrator/src/core/orchestrator.ts` | 1,2,3 | Add poller, agent manager, message router |
| `Orchestrator/src/config/schema.ts` | 1,2 | Add channelPolling, agents config sections |
| `Orchestrator/src/config/index.ts` | 1,2 | Wire new env vars |
| `Orchestrator/src/core/sessions.ts` | 2 | Scope sessions by agentId |
| `Orchestrator/src/core/tool-router.ts` | 3 | Add filtered tool lists, policy enforcement |
| `Orchestrator/src/server.ts` | 3 | agentId param on /tools/list and /tools/call |
| `Orchestrator/src/config/guardian.ts` | 3 | Per-agent Guardian overrides |
| `Thinker/src/index.ts` | 1 | Add POST /process-message, conditional polling |
| `Thinker/src/config.ts` | 1,2 | Add pollingEnabled, sendResponseDirectly, systemPromptPath |
| `Thinker/src/agent/loop.ts` | 1,2,3 | Conditional response sending, prompt from file, remove polling |
| `Thinker/src/orchestrator/client.ts` | 2 | Add X-Agent-Id header |

### Deleted (Phase 3)
| File | Reason |
|------|--------|
| `Thinker/src/telegram/client.ts` | Orchestrator owns all channel I/O |
| Polling code in `Thinker/src/agent/loop.ts` | Replaced by Orchestrator's ChannelPoller |

---

## Verification

### Phase 1
1. Start full stack with `CHANNEL_POLLING_ENABLED=true`, `THINKER_POLLING_ENABLED=false`, `THINKER_SEND_RESPONSE_DIRECTLY=false`
2. Send a Telegram message → verify Orchestrator polls it, dispatches to Thinker, receives response, sends to Telegram
3. Run `cd Orchestrator && npx vitest run` and `cd Thinker && npx vitest run`
4. Run `npx tsc --noEmit` in both packages

### Phase 2
1. Create `agents.json` with two agents on different ports
2. Start stack — verify Orchestrator spawns both Thinker instances
3. Kill a Thinker process — verify Orchestrator auto-restarts it
4. Check `/health` on both Thinker ports
5. Run tests, TypeScript check

### Phase 3
1. Add channel bindings routing chat A to agent 1 and chat B to agent 2
2. Send message in chat A → verify agent 1 handles it
3. Send message in chat B → verify agent 2 handles it
4. Verify agent 2 (restricted tools) cannot call denied tools
5. Run full test suite: `./test-all.sh`
