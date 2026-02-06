# Memory MCP - Product Specification

**Parent Document:** `../SYSTEM_ARCHITECTURE.md`
**Related Specs:** `../Orchestrator/ORCHESTRATION_LAYER_SPEC.md`, `../FileOps/FILE_OPS_MCP_SPEC.md`

---

## Purpose & Vision

The Memory MCP provides persistent, searchable memory capabilities for AI agents. It enables Annabelle to learn from every interaction, recall relevant past context, and continuously refine understanding of the user over time.

**Core Mission:** Transform stateless AI interactions into continuous, personalized assistance by maintaining context across conversations, extracting learnings, and building a rich user profile.

### The Problem We're Solving

**Without Memory:**
- Every conversation starts from zero context
- AI repeatedly asks the same questions
- User must re-explain preferences and background
- No learning from past interactions
- Stateless, transactional relationship

**With Memory:**
- AI builds on previous conversations
- Remembers user preferences automatically
- Learns patterns and working styles
- Provides increasingly personalized assistance
- Continuous, evolving relationship

### Design Philosophy

**1. Learn by Default**
- Automatic fact extraction from conversations
- No user action required to remember
- AI gets smarter over time

**2. Transparent Memory**
- User can see what AI remembers
- User can edit or delete memories
- Export to human-readable files

**3. Simple First**
- No vector database initially
- Text-based search (keyword, exact match)
- Add semantic search later if needed

**4. Privacy Respecting**
- User controls their data
- Right to view, edit, delete, export
- No sensitive data storage (passwords, keys)

---

## Architecture Position

```
┌─────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATION LAYER                           │
│                                                                  │
│  Before AI call:                 After AI call:                  │
│  └─→ retrieve_memories()         └─→ store_conversation()        │
│  └─→ get_profile()                                              │
└─────────────────────────────────────┬───────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────┐
│                       MEMORY MCP                                 │
│                      http://localhost:8005                       │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │    Facts    │  │Conversations│  │   Profiles  │              │
│  │   Storage   │  │   Storage   │  │  Management │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐                               │
│  │    Fact     │  │   Memory    │                               │
│  │ Extraction  │  │   Export    │                               │
│  └─────────────┘  └─────────────┘                               │
└─────────────────────────────────────┬───────────────────────────┘
                                      ↓
┌─────────────────────────────────────────────────────────────────┐
│                     SQLite Database                              │
│                   ~/.annabelle/data/memory.db                    │
└─────────────────────────────────────────────────────────────────┘
```

**Key Point:** Memory MCP is a peer to other MCP servers. It's shared infrastructure that the Orchestrator and other MCPs can use.

---

## Core Capabilities

### Phase 1 (MVP)

| Capability | Description |
|------------|-------------|
| Fact Storage | Store discrete learnings about the user |
| Fact Retrieval | Search facts by keyword/category |
| Conversation Logging | Store full conversation history |
| Conversation Search | Search past conversations by keyword |
| Profile Management | Build and maintain user profile |
| Memory Export | Export memories to readable files |
| Memory Transparency | User can view/edit what AI knows |

### Phase 2 (Future)

| Capability | Description |
|------------|-------------|
| Vector Search | Semantic similarity search |
| Weekly Synthesis | Aggregate learnings periodically |
| Multi-Agent Scopes | Per-agent memory isolation |
| Entity Extraction | Track people, places, concepts |

---

## Data Model

### Facts

Discrete learnings about the user.

```
Examples:
- "User prefers Python over JavaScript"
- "User works in laser materials engineering"
- "User is security-conscious, validates before implementing"
- "User's timezone is EST"
- "User prefers Docker for all services"
```

**Fact Categories:**
- `preference` - User likes/dislikes
- `background` - Who the user is
- `pattern` - Behavioral patterns observed
- `project` - Current work/projects
- `contact` - People mentioned
- `decision` - Choices made

### Conversations

Full interaction history.

```
{
  "id": "conv_abc123",
  "agent_id": "main",
  "session_id": "sess_xyz789",
  "user_message": "Help me write a Python script for...",
  "agent_response": "I'll help you create a script that...",
  "created_at": "2026-02-01T10:30:00Z",
  "tags": ["python", "scripting"]
}
```

### Profiles

Structured knowledge about the user per agent.

```json
{
  "agent_id": "main",
  "user_info": {
    "name": "Tomasz",
    "background": "Software engineer with laser materials expertise",
    "timezone": "America/New_York",
    "current_role": "Building AI assistant system"
  },
  "preferences": {
    "communication": "Direct, technical, no fluff",
    "coding_languages": ["Python", "Bash"],
    "tools": ["Docker", "LM Studio", "1Password"],
    "working_style": "Iterative: design → validate → implement"
  },
  "current_projects": [
    {
      "name": "Annabelle AI Assistant",
      "status": "In progress",
      "started": "2026-01-15"
    }
  ],
  "learned_patterns": [
    "Asks for high-level explanation before code",
    "Validates security implications before implementation",
    "Uses Docker for all infrastructure"
  ],
  "updated_at": "2026-02-01T10:30:00Z"
}
```

### Memory Scopes (Multi-Agent Ready)

**Phase 1:** Single global scope for "main" agent.

**Future:** Each agent has isolated memory with shared user basics.

```
Memory Scopes:
├── global              ← Shared user profile (name, timezone, etc.)
├── main                ← Main agent's learnings
├── coder (future)      ← Technical knowledge, code patterns
├── researcher (future) ← Research findings, sources
└── secretary (future)  ← Contact preferences, scheduling
```

**Access Rules (Future):**
- Each agent writes to own scope
- Each agent reads own scope + global
- Guardian agent reads all (monitoring)

---

## Storage Architecture

### Database Schema

**SQLite** for simplicity. Located at `~/.annabelle/data/memory.db`

```sql
-- Facts table
CREATE TABLE facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL DEFAULT 'main',
    fact TEXT NOT NULL,
    category TEXT NOT NULL,
    source TEXT,                    -- conversation_id that created this
    confidence REAL DEFAULT 1.0,    -- 0.0-1.0
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_facts_agent ON facts(agent_id);
CREATE INDEX idx_facts_category ON facts(agent_id, category);

-- Conversations table
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,            -- conv_uuid
    agent_id TEXT NOT NULL DEFAULT 'main',
    session_id TEXT,
    user_message TEXT NOT NULL,
    agent_response TEXT NOT NULL,
    tags TEXT,                      -- JSON array
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_conversations_agent ON conversations(agent_id);
CREATE INDEX idx_conversations_session ON conversations(session_id);
CREATE INDEX idx_conversations_date ON conversations(created_at);

-- Profiles table
CREATE TABLE profiles (
    agent_id TEXT PRIMARY KEY,
    profile_data TEXT NOT NULL,     -- JSON
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Profile history (for rollback)
CREATE TABLE profile_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    profile_data TEXT NOT NULL,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    change_reason TEXT
);
```

### Search Strategy (Phase 1)

**No vector search initially.** Use text-based search:

**Fact Search:**
```sql
SELECT * FROM facts
WHERE agent_id = ?
  AND (fact LIKE '%keyword%' OR category = ?)
ORDER BY created_at DESC
LIMIT ?
```

**Conversation Search:**
```sql
SELECT * FROM conversations
WHERE agent_id = ?
  AND (user_message LIKE '%keyword%' OR agent_response LIKE '%keyword%')
ORDER BY created_at DESC
LIMIT ?
```

**Future Enhancement:** Add vector embeddings and semantic search when needed.

---

## Memory Operations

### Store Operations

**store_fact**

Store a discrete learning about the user.

```
Input:
{
  "agent_id": "main",
  "fact": "User prefers Docker for all services",
  "category": "preference",
  "source": "conv_abc123"        // optional
}

Output:
{
  "fact_id": 42,
  "stored_at": "2026-02-01T10:30:00Z"
}
```

**store_conversation**

Log a complete conversation turn.

```
Input:
{
  "agent_id": "main",
  "session_id": "sess_xyz789",
  "user_message": "Help me with Docker setup",
  "agent_response": "I'll help you create a docker-compose.yml..."
}

Output:
{
  "conversation_id": "conv_abc123",
  "facts_extracted": 2,
  "stored_at": "2026-02-01T10:30:00Z"
}
```

**Note:** `store_conversation` triggers automatic fact extraction.

**update_profile**

Update agent's user profile with new information.

```
Input:
{
  "agent_id": "main",
  "updates": {
    "preferences.tools": ["Docker", "LM Studio", "1Password", "Cursor"],
    "current_projects[0].status": "Completed"
  }
}

Output:
{
  "success": true,
  "updated_fields": ["preferences.tools", "current_projects[0].status"]
}
```

### Retrieve Operations

**retrieve_memories**

Search for relevant facts and conversations.

```
Input:
{
  "agent_id": "main",
  "query": "Docker preferences",
  "limit": 5,
  "include_conversations": true
}

Output:
{
  "facts": [
    {
      "id": 42,
      "fact": "User prefers Docker for all services",
      "category": "preference",
      "created_at": "2026-02-01T10:30:00Z"
    }
  ],
  "conversations": [
    {
      "id": "conv_abc123",
      "user_message": "Help me with Docker setup",
      "agent_response": "I'll help you...",
      "created_at": "2026-02-01T10:30:00Z"
    }
  ]
}
```

**get_profile**

Retrieve agent's current understanding of the user.

```
Input:
{
  "agent_id": "main"
}

Output:
{
  "profile": {
    "user_info": {...},
    "preferences": {...},
    "current_projects": [...],
    "learned_patterns": [...]
  },
  "last_updated": "2026-02-01T10:30:00Z"
}
```

**search_conversations**

Search conversation history with filters.

```
Input:
{
  "agent_id": "main",
  "query": "laser coating",
  "limit": 10,
  "date_from": "2026-01-01",
  "date_to": "2026-02-01"
}

Output:
{
  "conversations": [
    {
      "id": "conv_xyz789",
      "user_message": "What parameters for laser coating?",
      "agent_response": "Based on your requirements...",
      "created_at": "2026-01-15T14:20:00Z"
    }
  ],
  "total_count": 15
}
```

### Management Operations

**list_facts**

List all facts with optional filtering.

```
Input:
{
  "agent_id": "main",
  "category": "preference",    // optional
  "limit": 50
}

Output:
{
  "facts": [...],
  "total_count": 127
}
```

**delete_fact**

Delete a specific fact.

```
Input:
{
  "fact_id": 42
}

Output:
{
  "success": true,
  "deleted_fact": "User prefers Docker for all services"
}
```

**get_memory_stats**

Memory usage statistics.

```
Input:
{
  "agent_id": "main"
}

Output:
{
  "fact_count": 127,
  "conversation_count": 543,
  "oldest_conversation": "2026-01-15T10:00:00Z",
  "newest_conversation": "2026-02-01T10:30:00Z",
  "database_size_mb": 12.5
}
```

---

## Memory Transparency (Export System)

### Purpose

Users can see and edit what the AI knows about them. Memory is exported to human-readable files.

### Export Location

```
~/.annabelle/memory-export/
├── profile.json              ← Current profile (editable)
├── profile.md                ← Profile in readable markdown
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

### Export Operation

**export_memory**

Export all memory to files.

```
Input:
{
  "agent_id": "main",
  "format": "markdown",        // or "json"
  "include_conversations": true
}

Output:
{
  "export_path": "~/.annabelle/memory-export/",
  "files_created": 12,
  "exported_at": "2026-02-01T10:30:00Z"
}
```

### Export File Formats

**profile.md:**
```markdown
# My AI Assistant's Understanding of Me

Last updated: February 1, 2026

## Who I Am
- **Name:** Tomasz
- **Background:** Software engineer with laser materials expertise
- **Timezone:** America/New_York

## My Preferences
- **Communication:** Direct, technical, no fluff
- **Languages:** Python, Bash
- **Tools:** Docker, LM Studio, 1Password, Cursor

## Current Projects
1. **Annabelle AI Assistant** (In progress, started Jan 15)

## Patterns the AI Has Noticed
- I ask for high-level explanations before code
- I validate security implications before implementation
- I use Docker for all infrastructure
```

**facts/preferences.md:**
```markdown
# Preferences I've Learned

## Coding
- Prefers Python over JavaScript (learned Jan 16)
- Uses type hints in Python code (learned Jan 20)
- Prefers Docker for service isolation (learned Jan 18)

## Communication
- Likes direct, technical responses (learned Jan 15)
- Appreciates examples over abstract explanations (learned Jan 22)

## Tools
- Primary editor: Cursor (learned Feb 1)
- Uses 1Password for all credentials (learned Jan 17)
```

### Import/Edit Flow

User edits `profile.json` or `facts/all-facts.json`:

**import_memory**

```
Input:
{
  "agent_id": "main",
  "file_path": "~/.annabelle/memory-export/profile.json"
}

Output:
{
  "success": true,
  "changes_applied": 3,
  "fields_updated": ["preferences.tools", "user_info.timezone"]
}
```

### Sync Strategy

**Auto-export triggers:**
- After every 10 new facts
- After profile update
- Daily at midnight (cron)
- On explicit export request

**User edit detection:**
- Check file modification timestamps
- On Memory MCP startup, import any user edits
- Manual import via API

---

## Automatic Fact Extraction

### When It Happens

After every conversation is stored, Memory MCP extracts facts.

### Extraction Process

1. Receive conversation (user message + agent response)
2. Call AI model with extraction prompt
3. Parse extracted facts
4. Filter low-confidence facts
5. Deduplicate against existing facts
6. Store new facts

### Extraction Prompt

```
Analyze this conversation and extract discrete facts about the user.

Conversation:
User: {user_message}
Assistant: {agent_response}

Extract facts in these categories:
- preference: What the user likes or dislikes
- background: Information about who the user is
- pattern: Behavioral patterns you observe
- project: Current work or projects mentioned
- decision: Choices the user made

Rules:
- Only extract CLEAR, EXPLICIT facts (not assumptions)
- Facts should be standalone (understandable without context)
- Skip generic statements that aren't user-specific
- Maximum 3 facts per conversation

Return JSON:
{
  "facts": [
    {"fact": "...", "category": "...", "confidence": 0.9}
  ]
}
```

### Extraction Configuration

```yaml
fact_extraction:
  enabled: true
  model: claude-haiku-4         # Fast, cheap model
  confidence_threshold: 0.7     # Minimum confidence to store
  max_facts_per_conversation: 3

  skip_if:
    - conversation_too_short: 50  # chars
    - agent_response_is_error: true
```

### Deduplication

Before storing, check if fact already exists:

```sql
SELECT * FROM facts
WHERE agent_id = ?
  AND fact LIKE ?            -- fuzzy match
  AND category = ?
LIMIT 1
```

If similar fact exists:
- Update confidence (average)
- Update timestamp
- Don't create duplicate

---

## Integration Patterns

### Orchestrator Integration

**Before AI Interaction:**

```python
# Orchestrator code (conceptual)

# 1. Get relevant memories
memories = memory_mcp.retrieve_memories(
    agent_id="main",
    query=user_message,
    limit=5
)

# 2. Get user profile
profile = memory_mcp.get_profile(agent_id="main")

# 3. Construct enhanced prompt
prompt = f"""
System: You are Annabelle, a personal AI assistant.

User Profile:
{format_profile(profile)}

Relevant Memories:
{format_memories(memories)}

Current Request:
{user_message}
"""

# 4. Call AI model
response = ai_model.generate(prompt)
```

**After AI Interaction:**

```python
# Orchestrator code (conceptual)

# Store conversation (triggers fact extraction)
memory_mcp.store_conversation(
    agent_id="main",
    session_id=session_id,
    user_message=user_message,
    agent_response=response
)
```

### AI Agent Direct Use

AI agents can use Memory MCP tools directly:

**Example: AI explicitly stores a fact**
```
User: "I'm switching from Windows to Linux"

AI (thinking): This is important context to remember
AI calls tool: store_fact(
    agent_id="main",
    fact="User switched from Windows to Linux",
    category="background"
)
AI: "Got it, I'll remember you're on Linux now."
```

**Example: AI searches memory**
```
User: "What were the parameters we decided for laser coating?"

AI calls tool: search_conversations(
    agent_id="main",
    query="laser coating parameters"
)

AI: "Based on our discussion on Jan 15, you decided on:
     - Power: 2kW
     - Speed: 5mm/s"
```

### Other MCP Integration

Other MCPs can log important events to memory.

**Example: File Ops MCP logs file creation**
```python
# File Ops MCP code (conceptual)

# After creating important file
memory_mcp.store_fact(
    agent_id="main",
    fact=f"Created infrastructure file: {filename}",
    category="decision",
    source="fileops_mcp"
)
```

---

## Security & Privacy

### What Memory MCP NEVER Stores

- Passwords or API keys
- Credit card numbers
- Social security numbers
- Private keys or certificates
- Authentication tokens

### Sensitive Data Detection

During fact extraction, detect and redact:

```python
SENSITIVE_PATTERNS = [
    r'sk-[a-zA-Z0-9]+',           # API keys
    r'password[:\s]+\S+',          # Passwords
    r'\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}',  # Credit cards
]

def sanitize_fact(fact):
    for pattern in SENSITIVE_PATTERNS:
        if re.search(pattern, fact):
            return None  # Don't store this fact
    return fact
```

### User Rights

**Right to View:**
- Export memory anytime
- See all facts and conversations
- View profile

**Right to Edit:**
- Edit profile directly
- Correct facts via import
- Add manual facts

**Right to Delete:**
- Delete specific facts
- Delete date ranges
- Delete all memory (nuclear option)

**Right to Export:**
- Export all data as JSON
- Export as markdown
- GDPR-compliant portability

### Data Retention

```yaml
retention:
  conversations:
    default_days: 90           # Keep 90 days
    after_expiry: summarize    # Or: delete

  facts:
    default: indefinite        # Keep forever
    user_can_delete: true

  profiles:
    keep_history_days: 30      # Profile change history
```

---

## API Specification

### MCP Protocol

Memory MCP implements standard MCP protocol.

**Base URL:** `http://localhost:8005`
**Format:** HTTP POST with JSON body

### Tool Definitions

**Tool 1: store_fact**
```yaml
name: store_fact
description: Store a discrete fact or learning about the user
parameters:
  agent_id:
    type: string
    required: true
    description: Which agent is storing this
  fact:
    type: string
    required: true
    description: The fact to store
  category:
    type: string
    required: true
    enum: [preference, background, pattern, project, contact, decision]
  source:
    type: string
    required: false
    description: Conversation ID that created this fact
returns:
  fact_id: integer
  stored_at: timestamp
```

**Tool 2: retrieve_memories**
```yaml
name: retrieve_memories
description: Search for relevant facts and conversations
parameters:
  agent_id:
    type: string
    required: true
  query:
    type: string
    required: true
    description: Search keywords
  limit:
    type: integer
    default: 5
  include_conversations:
    type: boolean
    default: true
returns:
  facts: array of fact objects
  conversations: array of conversation objects
```

**Tool 3: store_conversation**
```yaml
name: store_conversation
description: Log a conversation turn (triggers fact extraction)
parameters:
  agent_id:
    type: string
    required: true
  session_id:
    type: string
    required: false
  user_message:
    type: string
    required: true
  agent_response:
    type: string
    required: true
returns:
  conversation_id: string
  facts_extracted: integer
  stored_at: timestamp
```

**Tool 4: get_profile**
```yaml
name: get_profile
description: Get agent's user profile
parameters:
  agent_id:
    type: string
    required: true
returns:
  profile: object
  last_updated: timestamp
```

**Tool 5: update_profile**
```yaml
name: update_profile
description: Update user profile
parameters:
  agent_id:
    type: string
    required: true
  updates:
    type: object
    required: true
    description: Fields to update (dot notation supported)
returns:
  success: boolean
  updated_fields: array of strings
```

**Tool 6: search_conversations**
```yaml
name: search_conversations
description: Search conversation history
parameters:
  agent_id:
    type: string
    required: true
  query:
    type: string
    required: true
  limit:
    type: integer
    default: 10
  date_from:
    type: string
    format: date
    required: false
  date_to:
    type: string
    format: date
    required: false
returns:
  conversations: array
  total_count: integer
```

**Tool 7: list_facts**
```yaml
name: list_facts
description: List all facts with optional filtering
parameters:
  agent_id:
    type: string
    required: true
  category:
    type: string
    required: false
  limit:
    type: integer
    default: 50
returns:
  facts: array
  total_count: integer
```

**Tool 8: delete_fact**
```yaml
name: delete_fact
description: Delete a specific fact
parameters:
  fact_id:
    type: integer
    required: true
returns:
  success: boolean
  deleted_fact: string
```

**Tool 9: export_memory**
```yaml
name: export_memory
description: Export memory to human-readable files
parameters:
  agent_id:
    type: string
    required: true
  format:
    type: string
    enum: [markdown, json]
    default: markdown
  include_conversations:
    type: boolean
    default: true
returns:
  export_path: string
  files_created: integer
  exported_at: timestamp
```

**Tool 10: import_memory**
```yaml
name: import_memory
description: Import user-edited memory files
parameters:
  agent_id:
    type: string
    required: true
  file_path:
    type: string
    required: true
returns:
  success: boolean
  changes_applied: integer
  fields_updated: array of strings
```

**Tool 11: get_memory_stats**
```yaml
name: get_memory_stats
description: Get memory usage statistics
parameters:
  agent_id:
    type: string
    required: true
returns:
  fact_count: integer
  conversation_count: integer
  oldest_conversation: timestamp
  newest_conversation: timestamp
  database_size_mb: float
```

---

## Configuration

### Configuration File

```yaml
# memory-mcp.yaml

server:
  host: 0.0.0.0
  port: 8005

database:
  type: sqlite
  path: ~/.annabelle/data/memory.db

fact_extraction:
  enabled: true
  model: claude-haiku-4
  api_key: ${ANTHROPIC_API_KEY}
  confidence_threshold: 0.7
  max_facts_per_conversation: 3

memory_export:
  path: ~/.annabelle/memory-export/
  auto_export:
    enabled: true
    trigger_after_facts: 10
    daily_cron: "0 0 * * *"

retention:
  conversations_days: 90
  facts: indefinite
  profile_history_days: 30

agents:
  default: main
  # Future: define additional agent scopes
```

### Environment Variables

```bash
# Required for fact extraction
ANTHROPIC_API_KEY=sk-ant-...

# Optional
MEMORY_MCP_PORT=8005
MEMORY_DB_PATH=~/.annabelle/data/memory.db
MEMORY_EXPORT_PATH=~/.annabelle/memory-export/
LOG_LEVEL=INFO
```

---

## Deployment

### Docker Container

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Create data directories
RUN mkdir -p /data/memory /data/export

EXPOSE 8005

CMD ["python", "-m", "memory_mcp.main"]
```

### Docker Compose

```yaml
services:
  memory-mcp:
    build: ./memory-mcp
    ports:
      - "8005:8005"
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    volumes:
      - annabelle-data:/data
      - ./config:/app/config
    networks:
      - annabelle
    restart: unless-stopped

volumes:
  annabelle-data:
```

### Resource Requirements

- CPU: 0.5 cores
- Memory: 256-512MB
- Storage: 100MB+ (grows with usage)

### Initialization

On first startup:
1. Create database schema
2. Initialize default profile for "main" agent
3. Create export directories
4. Health check endpoint ready

**Health check:** `GET /health` returns 200 if ready

---

## Monitoring & Observability

### Key Metrics

```
# Volume
memory_facts_total{agent_id}
memory_conversations_total{agent_id}
memory_facts_extracted_total{agent_id}

# Performance
memory_retrieve_duration_seconds
memory_store_duration_seconds
memory_extraction_duration_seconds

# Storage
memory_database_size_bytes
memory_export_size_bytes
```

### Logging

```json
{
  "timestamp": "2026-02-01T10:30:00Z",
  "level": "INFO",
  "component": "memory_mcp.store",
  "event": "fact_stored",
  "data": {
    "agent_id": "main",
    "category": "preference",
    "fact_id": 42
  }
}
```

### Alerts

Alert on:
- Database connection failure
- Fact extraction failures > 5/hour
- Disk space < 100MB
- Export directory not writable

---

## Testing Strategy

### Unit Tests

- Store/retrieve facts
- Store/search conversations
- Profile update/merge logic
- Fact extraction parsing
- Sensitive data detection
- Export file generation

### Integration Tests

- Full store → retrieve cycle
- Fact extraction with real AI model
- Export → edit → import cycle
- Multi-agent scope isolation (future)

### Performance Tests

- Store 10,000 facts → measure query time
- Search with 100K conversations
- Concurrent operations

---

## Success Criteria

### Functional Success

✅ **Must support:**
- Store and retrieve facts
- Log and search conversations
- Maintain user profile
- Export memory to readable files
- Import user-edited memory
- Automatic fact extraction

### Performance Success

⚡ **Must achieve:**
- retrieve_memories: < 200ms
- store_conversation: < 300ms (including extraction)
- get_profile: < 50ms
- export_memory: < 5s for 1000 facts

### Quality Success

🎯 **Must deliver:**
- Facts extracted with 85% accuracy
- No false positives (inventing facts)
- No sensitive data stored
- User can see/edit all memory

---

## Implementation Phases

### Phase 1: Core Memory (MVP)

- SQLite database setup
- store_fact, retrieve_memories
- store_conversation, search_conversations
- get_profile, update_profile
- Basic text search
- Memory export (markdown)

### Phase 2: Intelligence

- Automatic fact extraction
- Deduplication logic
- Memory import
- Profile history/rollback

### Phase 3: Enhancements (Future)

- Vector embeddings (semantic search)
- Weekly synthesis
- Multi-agent scopes
- Entity extraction

---

## Open Questions

### Phase 1 Decisions

1. **Fact confidence:** How to handle conflicting facts?
2. **Conversation summarization:** Summarize old conversations or keep full?
3. **Export format:** Is markdown sufficient, or need other formats?
4. **Edit conflicts:** What if user edits during active session?

### Future Considerations

1. **Vector DB migration:** When to add semantic search?
2. **Sync to cloud:** Backup memory to cloud storage?
3. **Multi-device:** Sync memory across devices?
4. **Shared memory:** Share select facts between users (teams)?
