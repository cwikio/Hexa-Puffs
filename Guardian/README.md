# Guardian MCP Server

MCP server that scans content for prompt injection attacks using multiple scanning backends:

- **Groq Llama Guard** (`meta-llama/llama-guard-4-12b`) — cloud-based, fast, category-based classification
- **Groq Safeguard** (`openai/gpt-oss-safeguard-20b`) — cloud-based, policy-driven JSON scanning
- **Ollama** ([Granite Guardian 3.3-8B](https://huggingface.co/ibm-granite/granite-guardian-3.3-8b)) — local, offline, GPU-accelerated

The provider is selected lazily based on environment variables (see Configuration below).

## Purpose

Guardian acts as a security filter for AI orchestration systems. Before an AI agent processes external content (emails, web pages, files), Guardian scans it for:

- **Prompt injection attacks** - Hidden instructions trying to hijack AI behavior
- **Jailbreak attempts** - Attempts to bypass safety guidelines
- **Social engineering** - Manipulation attempts embedded in content

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- **Groq** (cloud): `GROQ_API_KEY` environment variable, OR
- **Ollama** (local): [Ollama](https://ollama.ai/) installed and running

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Download and load the Guardian model (~5GB)
./scripts/setup-model.sh

# 3. Start the server
./start.sh
```

### Single Command

```bash
./start.sh
# - Ensures Ollama is running
# - Loads guardian model if needed
# - Builds TypeScript if needed
# - Starts MCP server
```

## Tools

### `scan_content`

Scans content for prompt injection attacks.

**Input:**
```json
{
  "content": "string | object | array",
  "source": "email",
  "context": "optional context"
}
```

**Output:**
```json
{
  "safe": false,
  "confidence": 0.92,
  "threats": [
    {
      "path": "body",
      "type": "prompt_injection",
      "snippet": "Ignore all previous instructions..."
    }
  ],
  "explanation": "Detected prompt injection attempt in email body",
  "scan_id": "uuid"
}
```

**Features:**
- Accepts strings, objects, or arrays
- Recursively scans all text fields in nested structures
- Reports exact JSON path where threats are found (e.g., `emails[0].subject`)

### `get_scan_log`

Retrieve audit log of past scans.

**Input:**
```json
{
  "scan_id": "optional - get specific scan",
  "limit": 50,
  "threats_only": true
}
```

**Output:**
```json
{
  "scans": [
    {
      "scan_id": "uuid",
      "timestamp": "2025-01-31T12:00:00Z",
      "source": "email",
      "safe": false,
      "threats": ["prompt_injection"],
      "content_hash": "abc123..."
    }
  ],
  "total": 1
}
```

## Configuration

Environment variables (`.env`):

```bash
# Transport mode
TRANSPORT=stdio          # "stdio" (default) or "http"
PORT=3000               # HTTP port (when TRANSPORT=http)

# Provider selection (lazy — resolved at first scan)
# If GROQ_API_KEY is set → uses Groq (Llama Guard or Safeguard based on GROQ_MODEL)
# If GROQ_API_KEY is not set → falls back to Ollama

# Groq settings (cloud)
GROQ_API_KEY=gsk_...                           # Required for Groq providers
GROQ_BASE_URL=https://api.groq.com/openai/v1  # Default
GROQ_MODEL=meta-llama/llama-guard-4-12b        # Or include "safeguard" for Safeguard provider

# Rate limiting (optional, Groq only)
GUARDIAN_RATE_LIMIT_ENABLED=true               # Enable rate limiting
GUARDIAN_RATE_LIMIT_RPM=80                     # Requests per minute

# Ollama settings (local fallback)
OLLAMA_HOST=http://localhost:11434
MODEL_NAME=guardian
```

### Provider Selection Logic

1. If `GROQ_API_KEY` is **not set** → uses **Ollama** (local)
2. If `GROQ_API_KEY` is set and `GROQ_MODEL` contains `"safeguard"` → uses **Groq Safeguard** (policy-driven JSON scanning)
3. If `GROQ_API_KEY` is set and `GROQ_MODEL` does not contain `"safeguard"` → uses **Groq Llama Guard** (category-based classification)

**Source:** `Guardian/src/provider.ts`

## Swapping Models

### Ollama (local)

1. Download a new GGUF file to `models/`
2. Edit `models/Modelfile`:
   ```
   FROM ./your-new-model.gguf
   ```
3. Reload:
   ```bash
   ollama create guardian -f models/Modelfile
   ```

See [models/README.md](models/README.md) for alternative models.

### Groq (cloud)

Set `GROQ_MODEL` to any supported model (e.g., `meta-llama/llama-guard-4-12b`).

## Claude Desktop Integration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "guardian": {
      "command": "/path/to/Guardian/run.sh"
    }
  }
}
```

## Docker (Optional)

```bash
# stdio mode (requires Ollama on host)
docker-compose up -d

# HTTP mode
TRANSPORT=http docker-compose up -d
curl http://localhost:3000/health
```

Note: Docker on macOS cannot access Apple Silicon GPU. Ollama must run natively on the host for GPU acceleration.

## Audit Logging

All scans are logged to `logs/audit.jsonl`:

```json
{
  "scan_id": "uuid",
  "timestamp": "2025-01-31T12:00:00Z",
  "source": "email",
  "content_hash": "sha256...",
  "content_length": 1234,
  "safe": false,
  "confidence": 0.92,
  "threats": [{"path": "body", "type": "prompt_injection", "snippet": "..."}],
  "model": "guardian",
  "latency_ms": 450
}
```

Content is hashed (not stored) for privacy.

## Orchestrator Integration (Pass-Through Mode)

Guardian integrates with the Orchestrator as a **transparent security decorator**. When enabled, it automatically scans tool calls flowing through the Orchestrator to downstream MCPs — no manual scan calls needed.

### How It Works

```
Caller (Claude/Thinker)
  │
  ▼
Orchestrator
  │
  ├─→ [GuardedMCPClient] ──scan input──→ Guardian MCP ──scan──→ Ollama
  │         │                                                       │
  │         │◄──────────── allowed / blocked ◄──────────────────────┘
  │         │
  │         ├─→ Telegram MCP (if allowed)
  │         │
  │         │◄── response ◄── Telegram MCP
  │         │
  │         ├─→ Guardian MCP ──scan output──→ Ollama (if output scanning enabled)
  │         │
  │         ▼
  │     return result (or block)
  │
  ├─→ Memory MCP (no wrapper, scanning disabled in config)
  ├─→ Searcher MCP (no wrapper)
  └─→ ...
```

Guardian wraps individual MCP clients using a **decorator pattern** (`GuardedMCPClient`). The Orchestrator's tool router sees guarded clients as normal MCP clients — zero changes to routing logic.

### Scanning Configuration

Guardian scanning is controlled by a single config file:

**File:** `Orchestrator/src/config/guardian.ts` (symlinked at repo root as `guardian-config.ts`)

```typescript
export const guardianConfig = {
  enabled: true,
  failMode: 'closed' as const,

  defaultInput: true,           // Scan inputs for unknown/new MCPs
  defaultOutput: true,          // Scan outputs for unknown/new MCPs

  input: {                      // Scan tool arguments BEFORE reaching the MCP
    telegram: false,
    onepassword: true,
    memory: true,
    filer: true,
    searcher: false,
    gmail: true,
    codexec: true,
  },

  output: {                     // Scan tool results BEFORE returning to caller
    telegram: false,
    onepassword: false,
    memory: false,
    filer: true,
    searcher: true,
    gmail: true,
    codexec: false,
  },
};
```

### Enabling Guardian

Guardian scanning is enabled by default (`enabled: true`). Ensure a scanning provider is available:
1. **Groq (cloud):** Set `GROQ_API_KEY` in Guardian's `.env`
2. **Ollama (local):** Ensure Ollama is running with the Guardian model loaded
3. Restart the Orchestrator

### Disabling Guardian

**Disable all scanning globally:**

```typescript
// In Orchestrator/src/config/guardian.ts
enabled: false,  // All MCPs pass through without scanning
```

**Disable scanning for a specific MCP:**

```typescript
input: {
  telegram: false,  // Stop scanning Telegram inputs
  // ...
},
output: {
  telegram: false,  // Stop scanning Telegram outputs
  // ...
},
```

**Fail mode when Guardian MCP is unavailable:**

- `'closed'` (default) — block all requests to guarded MCPs (secure)
- `'open'` — allow requests through without scanning (availability over security)

### What Gets Scanned

| MCP        | Input Scanning | Output Scanning | Rationale                                  |
| ---------- | -------------- | --------------- | ------------------------------------------ |
| Telegram   | No             | No              | AI-composed messages, low risk both ways    |
| 1Password  | Yes            | No              | Protect queries; output is trusted          |
| Memory     | Yes            | No              | Protect stored facts; output is trusted     |
| Filer      | Yes            | Yes             | File content could carry injections         |
| Searcher   | No             | Yes             | Queries are low-risk; web results untrusted |
| Gmail      | Yes            | Yes             | Emails are the primary injection vector     |
| CodeExec   | Yes            | No              | Code args are high-risk; output follows     |
| (unknown)  | Yes            | Yes             | New/external MCPs scanned both ways         |

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Guardian MCP (Node.js)                         │
│  • TypeScript server                            │
│  • stdio/HTTP transport                         │
│  • Audit logging                                │
│  • Lazy provider selection                      │
│                                                 │
│         ┌──────────┼──────────┐                 │
│         ↓          ↓          ↓                 │
│  ┌───────────┐ ┌────────┐ ┌────────────────┐   │
│  │ Groq      │ │ Groq   │ │ Ollama         │   │
│  │ Llama     │ │ Safe-  │ │ (local)        │   │
│  │ Guard     │ │ guard  │ │ granite-       │   │
│  │ (cloud)   │ │(cloud) │ │ guardian       │   │
│  └───────────┘ └────────┘ └────────────────┘   │
└─────────────────────────────────────────────────┘
```

## License

MIT
