# Annabelle Memory MCP

Persistent memory for the Annabelle AI Assistant. Learns from every interaction, recalls relevant context, and builds a rich user profile over time.

**Transport:** stdio (spawned by Orchestrator)

## Design Philosophy

1. **Learn by Default** — Automatic fact extraction from conversations. No user action required.
2. **Transparent Memory** — Users can see, edit, delete, and export everything the AI remembers.
3. **Simple First** — Text-based search (keyword, exact match). No vector DB needed yet.
4. **Privacy Respecting** — User controls their data. No sensitive data stored (passwords, keys, tokens).

## Quick Start

```bash
npm install
cp .env.example .env   # Edit with your GROQ_API_KEY
npm run build
npm start
```

## Configuration

All configuration via environment variables. See `.env.example` for all options.

### AI Provider (for fact extraction)

```bash
AI_PROVIDER=groq          # or: lmstudio

# Groq (cloud) — default
GROQ_API_KEY=gsk_xxx
GROQ_MODEL=llama-3.3-70b-versatile

# LM Studio (local)
LMSTUDIO_BASE_URL=http://localhost:1234/v1
LMSTUDIO_MODEL=local-model
```

### Storage

```bash
MEMORY_DB_PATH=~/.annabelle/data/memory.db
MEMORY_EXPORT_PATH=~/.annabelle/memory-export/
```

### Extraction Tuning

```bash
FACT_EXTRACTION_ENABLED=true
CONFIDENCE_THRESHOLD=0.7
MAX_FACTS_PER_CONVERSATION=3
SKIP_SHORT_CONVERSATIONS=50     # min chars
AI_TEMPERATURE=0.3
AI_MAX_TOKENS=500
```

## MCP Tools

### Facts

| Tool | Description |
|------|-------------|
| `store_fact` | Store a discrete fact about the user |
| `list_facts` | List facts with optional category filter |
| `update_fact` | Modify an existing fact |
| `delete_fact` | Delete a specific fact by ID |

### Conversations

| Tool                    | Description                                                  |
|-------------------------|--------------------------------------------------------------|
| `store_conversation`    | Log a conversation turn (triggers automatic fact extraction) |
| `search_conversations`  | Search conversation history by keyword                       |

### Profiles

| Tool               | Description                                      |
|--------------------|--------------------------------------------------|
| `get_profile`      | Get the user profile for an agent                |
| `update_profile`   | Update profile fields (dot notation supported)   |

### Skills

| Tool | Description |
|------|-------------|
| `store_skill` | Save a learned skill or pattern |
| `list_skills` | List all stored skills |
| `get_skill` | Retrieve a specific skill by ID |
| `update_skill` | Modify a skill |
| `delete_skill` | Remove a skill |

### Contacts

| Tool | Description |
|------|-------------|
| `create_contact` | Create a contact record for a person |
| `list_contacts` | List stored contacts |
| `update_contact` | Update contact details |

### Projects

| Tool | Description |
|------|-------------|
| `create_project` | Create a project record |
| `list_projects` | List stored projects |
| `update_project` | Update project details |

### Timeline

| Tool | Description |
|------|-------------|
| `query_timeline` | Query what happened across a time range — searches facts, conversations, profile changes, skills, contacts, and projects within given dates |

### Memory & Stats

| Tool | Description |
|------|-------------|
| `retrieve_memories` | Search for relevant facts and conversations |
| `get_memory_stats` | Get memory usage statistics |
| `export_memory` | Export memory to JSON files |
| `import_memory` | Import user-edited memory files |

## Fact Categories

- `preference` — User likes/dislikes
- `background` — Who the user is
- `pattern` — Behavioral patterns observed
- `project` — Current work/projects
- `contact` — People mentioned
- `decision` — Choices made

## Automatic Fact Extraction

When a conversation is stored, the AI provider extracts facts automatically:

1. Receive conversation (user message + agent response)
2. Call AI model with structured extraction prompt
3. Parse extracted facts with category and confidence score
4. Filter out low-confidence facts (below threshold)
5. Deduplicate against existing facts (fuzzy match by text + category)
6. Store new facts, update confidence on duplicates

Short conversations (< 50 chars) and error responses are skipped.

## Memory Export (Transparency)

Exported to `~/.annabelle/memory-export/`:

```
memory-export/
├── profile.json              ← Current profile (editable)
├── profile.md                ← Human-readable profile
├── facts/
│   ├── preferences.md        ← Facts by category
│   ├── patterns.md
│   ├── projects.md
│   └── all-facts.json        ← Complete facts export
├── conversations/
│   ├── 2026-02/
│   │   ├── 01.md             ← Conversations by day
│   │   └── 02.md
│   └── recent.md             ← Last 50 conversations
└── summary.md                ← High-level summary
```

Users can edit exported JSON files and re-import them.

## Security & Privacy

**Never stored:** passwords, API keys, credit card numbers, private keys, auth tokens.

Sensitive data patterns are detected and redacted during fact extraction. Users have full rights to view, edit, delete, and export all their data.

## Database

SQLite via `better-sqlite3`. Tables:

- `facts` — Discrete learnings with category and confidence
- `conversations` — Full interaction history
- `profiles` — Structured user knowledge per agent
- `profile_history` — Profile change history for rollback

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       MEMORY MCP (stdio)                        │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │    Facts    │  │Conversations│  │   Profiles  │             │
│  │   Storage   │  │   Storage   │  │  Management │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │    Fact     │  │   Memory    │  │   Skills    │             │
│  │ Extraction  │  │   Export    │  │   Storage   │             │
│  │(Groq/LM St)│  │             │  │             │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────┬───────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────┐
│                     SQLite Database                              │
│                   ~/.annabelle/data/memory.db                    │
└─────────────────────────────────────────────────────────────────┘
```

## Development

```bash
npm run dev        # Watch mode
npm run typecheck  # Type check
npm run build      # Build
```

## License

Part of the Annabelle AI Assistant project.
