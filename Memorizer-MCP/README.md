# Annabelle Memory MCP

Memory MCP server for the Annabelle AI Assistant. Provides persistent memory capabilities with automatic fact extraction.

## Features

- **Fact Storage** - Store and retrieve discrete learnings about the user
- **Conversation Logging** - Full conversation history with search
- **User Profiles** - Structured knowledge about the user per agent
- **Automatic Fact Extraction** - AI extracts facts from conversations
- **Memory Transparency** - Export to human-readable markdown/JSON files
- **Configurable AI Provider** - Groq (cloud) or LM Studio (local)

## Quick Start

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your settings (GROQ_API_KEY required for cloud extraction)

# Build
npm run build

# Run
npm start
```

## Configuration

All configuration is via environment variables. See `.env.example` for all options.

### Required for Fact Extraction

```bash
# Choose AI provider
AI_PROVIDER=groq          # or: lmstudio

# For Groq (cloud)
GROQ_API_KEY=gsk_xxx

# For LM Studio (local)
LMSTUDIO_BASE_URL=http://localhost:1234/v1
LMSTUDIO_MODEL=your-model-name
```

### Storage Paths

```bash
MEMORY_DB_PATH=~/.annabelle/data/memory.db
MEMORY_EXPORT_PATH=~/.annabelle/memory-export/
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `store_fact` | Store a discrete fact about the user |
| `list_facts` | List facts with optional category filter |
| `delete_fact` | Delete a specific fact by ID |
| `store_conversation` | Log a conversation turn (triggers fact extraction) |
| `search_conversations` | Search conversation history by keyword |
| `get_profile` | Get the user profile for an agent |
| `update_profile` | Update profile fields (dot notation supported) |
| `retrieve_memories` | Search for relevant facts and conversations |
| `get_memory_stats` | Get memory usage statistics |
| `export_memory` | Export memory to markdown/JSON files |
| `import_memory` | Import user-edited memory files |

## Fact Categories

Facts are organized into these categories:

- `preference` - User likes/dislikes
- `background` - Who the user is
- `pattern` - Behavioral patterns observed
- `project` - Current work/projects
- `contact` - People mentioned
- `decision` - Choices made

## Database Schema

SQLite database with these tables:

- `facts` - Discrete learnings with category and confidence
- `conversations` - Full interaction history
- `profiles` - Structured user knowledge per agent
- `profile_history` - Profile change history for rollback

## Docker

```bash
# Build and run
docker-compose up -d

# View logs
docker-compose logs -f memory-mcp
```

## Integration with Orchestrator

The Orchestrator can connect to this MCP server to:

1. Retrieve relevant memories before AI calls
2. Store conversations after AI responses
3. Get user profile for context

Add to Orchestrator config:

```bash
MEMORY_MCP_URL=http://localhost:8005
```

## Development

```bash
# Watch mode
npm run dev

# Type check
npm run typecheck

# Build
npm run build
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       MEMORY MCP                                 │
│                    http://localhost:8005                         │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │    Facts    │  │Conversations│  │   Profiles  │              │
│  │   Storage   │  │   Storage   │  │  Management │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐                               │
│  │    Fact     │  │   Memory    │                               │
│  │ Extraction  │  │   Export    │                               │
│  │ (Groq/LM)   │  │             │                               │
│  └─────────────┘  └─────────────┘                               │
└─────────────────────────────────────┬───────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────┐
│                     SQLite Database                              │
│                   ~/.annabelle/data/memory.db                    │
└─────────────────────────────────────────────────────────────────┘
```

## License

Part of the Annabelle AI Assistant project.
