# Guardian MCP Server

MCP server that scans content for prompt injection attacks using [Granite Guardian 3.3-8B](https://huggingface.co/ibm-granite/granite-guardian-3.3-8b) running locally via Ollama.

## Purpose

Guardian acts as a security filter for AI orchestration systems. Before an AI agent processes external content (emails, web pages, files), Guardian scans it for:

- **Prompt injection attacks** - Hidden instructions trying to hijack AI behavior
- **Jailbreak attempts** - Attempts to bypass safety guidelines
- **Social engineering** - Manipulation attempts embedded in content

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Ollama](https://ollama.ai/) installed and running

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

# Ollama settings
OLLAMA_HOST=http://localhost:11434
MODEL_NAME=guardian
```

## Swapping Models

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

## Architecture

```
┌─────────────────────────────────────────────────┐
│  macOS (Apple Silicon)                          │
│                                                 │
│  ┌──────────────────────────────────────────┐   │
│  │ Ollama (native)                          │   │
│  │ • Uses Apple Silicon GPU (Metal)         │   │
│  │ • Model: granite-guardian                │   │
│  │ • API: localhost:11434                   │   │
│  └──────────────────────────────────────────┘   │
│                    ↑                            │
│                    │ HTTP API                   │
│                    ↓                            │
│  ┌──────────────────────────────────────────┐   │
│  │ Guardian MCP (Node.js)                   │   │
│  │ • TypeScript server                      │   │
│  │ • stdio/HTTP transport                   │   │
│  │ • Audit logging                          │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

## License

MIT
