# Voice Capabilities for Annabelle

## Context

Annabelle currently processes only text messages. Voice messages sent to Telegram are silently dropped by the ChannelPoller (line 146 of `channel-poller.ts` filters out messages with empty `text`). The goal is to add voice input (STT) and voice output (TTS) capabilities in a modular, channel-agnostic way that fits the existing architecture.

## Architecture Decision: New Voice MCP (stdio)

Create a dedicated **Voice-MCP** as a stdio MCP. Rationale:
- **Single responsibility** — Telegram handles Telegram protocol, Voice handles audio processing
- **Channel-agnostic** — when WhatsApp/Discord/web are added, they all call the same Voice MCP tools
- **Provider isolation** — STT/TTS API failures don't affect other MCPs
- **Auto-discoverable** — follows existing pattern, just drop the folder

## Voice MCP Tools

### `transcribe` (STT)
- **Input**: `file_path` (string, required), `language` (string, optional ISO 639-1 hint)
- **Output**: `{ text, language, duration_seconds, provider, confidence? }`
- Annotations: `readOnlyHint: true, idempotentHint: true`

### `synthesize` (TTS)
- **Input**: `text` (string), `voice_id` (string, optional), `output_format` (ogg|mp3|wav, default ogg), `speed` (0.5-2.0, optional)
- **Output**: `{ file_path, format, duration_seconds, provider, voice_id }`
- Audio files written to `~/.annabelle/voice-temp/`

### `list_voices` (informational)
- **Input**: `provider` (string, optional filter)
- **Output**: `{ voices: [{ id, name, provider, language, gender? }] }`

## Provider Strategy

Provider interfaces (`STTProvider`, `TTSProvider`) with factory pattern, configured via env vars.

**Phase 1 (MVP)**:
- **STT**: Groq Whisper (`whisper-large-v3-turbo`) — free, fast, Groq API key already available
- **TTS**: ElevenLabs — high quality, good free tier

**Future**: OpenAI Whisper, Kokoro (local TTS), etc.

## Voice MCP Package Structure

```
Voice-MCP/
  package.json          # annabelle: { mcpName: "voice", transport: "stdio" }
  tsconfig.json
  src/
    index.ts            # Entry point, stdio transport
    server.ts           # McpServer + registerTool() calls
    providers/
      types.ts          # STTProvider / TTSProvider interfaces
      groq-whisper.ts   # Groq Whisper implementation
      elevenlabs.ts     # ElevenLabs TTS implementation
      factory.ts        # Provider factory (env-driven)
    tools/
      transcribe.ts
      synthesize.ts
      list-voices.ts
    utils/
      audio.ts          # File validation, temp file management, cleanup
      config.ts         # Zod config schema
  tests/
```

## Changes to Existing Code

### 1. Telegram MCP — Better voice detection

**File**: `Telegram-MCP/src/telegram/types.ts`

Add `mediaSubtype` and `mediaDuration` to `MessageInfo`:
```typescript
interface MessageInfo {
  // ... existing fields ...
  mediaSubtype?: 'voice' | 'audio' | 'video' | 'photo' | 'document' | 'sticker';
  mediaDuration?: number;
}
```

Update `formatMessage()` to detect voice by checking `DocumentAttributeAudio.voice` attribute on the GramJS message.

**File**: `Telegram-MCP/src/tools/media/send-media.ts`

Add `as_voice: boolean` optional param to `send_media` tool schema. When true, use `voiceNote: true` in `client.sendFile()` so Telegram displays it as a playable voice message.

### 2. Orchestrator — Voice pipeline in ChannelPoller

**File**: `Orchestrator/src/core/channel-poller.ts`

- Add `hasMedia`, `mediaType`, `mediaSubtype`, `mediaDuration` to local `TelegramMessage` interface
- Fix the filter at line 146: allow voice messages through even with empty text
- Add `transcribeVoiceMessage()` method that:
  1. Calls `telegram_download_media` to save the voice file to temp dir
  2. Calls `voice_transcribe` to get text
  3. Returns transcribed text + voice metadata
- In the dispatch loop, call `transcribeVoiceMessage()` for voice messages before creating `IncomingAgentMessage`

### 3. Orchestrator — Voice response in dispatchMessage

**File**: `Orchestrator/src/core/orchestrator.ts`

In `dispatchMessage()` (around line 592-599), after getting Thinker's text response:
- Check if original message had `voice` metadata AND agent has `voiceResponse: "mirror"` or `"always"`
- If yes: call `voice_synthesize` → then `telegram_send_media` with `as_voice: true`
- Fallback to text if synthesis fails

### 4. Orchestrator — Agent voice config

**File**: `Orchestrator/src/core/agent-types.ts`

Add optional `voice` field to `IncomingAgentMessageSchema`:
```typescript
voice: z.object({
  originalFilePath: z.string(),
  durationSeconds: z.number(),
  transcriptionProvider: z.string(),
}).optional()
```

**File**: `Orchestrator/src/config/agents.ts`

Add `voiceConfig` to `AgentDefinitionSchema`:
```typescript
voiceConfig: z.object({
  transcribeIncoming: z.boolean().default(true),
  voiceResponse: z.enum(['never', 'mirror', 'always']).default('mirror'),
  defaultVoiceId: z.string().optional(),
  maxVoiceDurationSeconds: z.number().int().min(5).max(300).default(120),
}).optional()
```

### 5. Thinker — Minimal awareness

**File**: Thinker `agent/tool-selector.ts`

Add `voice` tool group: `['voice_*']` with keyword route for `voice|audio|speak|transcribe|read.*aloud`.

**File**: Thinker `agent/loop.ts`

Add brief voice section to system prompt so the agent knows transcriptions may have minor errors.

## End-to-End Voice Memo Flow

1. User sends voice message in Telegram saying "Remember my favorite restaurant is Szara Ges"
2. Telegram MCP event handler queues it: `hasMedia: true, mediaSubtype: "voice", text: ""`
3. ChannelPoller sees voice message, allows through (new filter logic)
4. ChannelPoller calls `telegram_download_media` → saves `/tmp/annabelle-voice/voice_123.ogg`
5. ChannelPoller calls `voice_transcribe` → gets `"Remember my favorite restaurant is Szara Ges"`
6. Dispatches to Thinker with `text: "Remember my favorite restaurant..."` + `voice: { ... }`
7. Thinker's LLM calls `memory_store_fact` → saves the preference
8. Thinker responds: "Got it, I'll remember that!"
9. Orchestrator sees `voice` metadata + `voiceResponse: "mirror"` → calls `voice_synthesize`
10. Sends voice response via `telegram_send_media` with `as_voice: true`

## Configuration

**Environment variables** (Voice MCP):
```
VOICE_STT_PROVIDER=groq
VOICE_TTS_PROVIDER=elevenlabs
GROQ_API_KEY=...          # already in env
ELEVENLABS_API_KEY=...
VOICE_AUDIO_TEMP_DIR=~/.annabelle/voice-temp
```

**agents.json** addition:
```json
"voiceConfig": {
  "transcribeIncoming": true,
  "voiceResponse": "mirror",
  "defaultVoiceId": "rachel",
  "maxVoiceDurationSeconds": 120
}
```

## Audio File Lifecycle

- Download to `~/.annabelle/voice-temp/voice_{messageId}.ogg`
- TTS output to `~/.annabelle/voice-temp/tts_{uuid}.ogg`
- Periodic cleanup (every 10 min) removes files older than 30 minutes
- Voice MCP owns temp dir management

## Implementation Phases

1. **Voice MCP foundation**: package setup, Groq Whisper STT provider, `transcribe` tool, auto-discovery verification
2. **Telegram voice detection**: `MessageInfo` enhancement, `formatMessage` update, `as_voice` param on `send_media`
3. **Orchestrator pipeline**: ChannelPoller voice handling, `IncomingAgentMessage` schema update, voice transcription in poll cycle
4. **TTS integration**: ElevenLabs provider, `synthesize` tool, `list_voices` tool
5. **Orchestrator voice response**: `dispatchMessage` voice response path, `voiceConfig` in agent definition
6. **Thinker awareness**: tool selector voice group, system prompt update
7. **Testing**: unit tests for Voice MCP, integration test (voice → transcribe → respond → voice back)

## Verification

- **Unit**: `cd Voice-MCP && npx vitest run` — test transcribe/synthesize with mocked providers
- **Integration**: Send a voice message in Telegram → check Orchestrator logs for transcription → verify Thinker receives text → verify voice response sent back
- **TypeScript**: `npx tsc --noEmit` in Voice-MCP, Orchestrator, Telegram-MCP, and Thinker
- **Manual**: Record a "remember this" voice note → check Memorizer has the fact stored
