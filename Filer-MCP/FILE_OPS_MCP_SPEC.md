# File Ops MCP - Product Specification

**Parent Document:** `../SYSTEM_ARCHITECTURE.md`
**Related Specs:** `../Orchestrator/ORCHESTRATION_LAYER_SPEC.md`, `../Memory/MEMORY_MCP_SPEC.md`

---

## Purpose & Vision

The File Ops MCP manages all file system operations for Annabelle. It creates files the AI generates for the user, manages access to the user's existing files through a grants system, and organizes the AI workspace.

**Core Mission:** Enable AI to create useful files and safely access user files, with clear boundaries between AI workspace and user's personal files.

### Design Philosophy

**1. Workspace Isolation**
- AI has its own workspace directory
- User files require explicit grants
- Clear separation of AI-generated vs user files

**2. Permission First**
- No access to user files without grant
- Grants are explicit and auditable
- User controls what AI can see

**3. Useful Output**
- AI can create documents, code, reports
- Organized directory structure
- Easy for user to find AI-generated content

**4. Audit Everything**
- Log all file operations
- Track what was created, read, modified
- Security audit trail

---

## Architecture Position

```
┌─────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATION LAYER                           │
│                                                                  │
│  AI requests file operation → File Ops MCP                       │
│                                                                  │
└─────────────────────────────────┬───────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                      FILE OPS MCP                                │
│                    http://localhost:8003                         │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │  Workspace  │  │   Grants    │  │    File     │              │
│  │  Manager    │  │   System    │  │ Operations  │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐                               │
│  │   Audit     │  │   Cleanup   │                               │
│  │   Logger    │  │   Service   │                               │
│  └─────────────┘  └─────────────┘                               │
└─────────────────────────────────────┬───────────────────────────┘
                                      ↓
              ┌───────────────────────┴───────────────────────┐
              ↓                                               ↓
┌─────────────────────────┐                   ┌─────────────────────────┐
│    AI Workspace         │                   │    User Files           │
│ ~/Documents/AI-Workspace│                   │ (Granted Access Only)   │
│                         │                   │                         │
│ • Always accessible     │                   │ • Requires grant        │
│ • AI creates files here │                   │ • Read or read-write    │
│ • Organized structure   │                   │ • User controls access  │
└─────────────────────────┘                   └─────────────────────────┘
```

---

## Storage Domains

### Domain 1: AI Workspace (Always Accessible)

The primary directory where AI creates files for the user.

**Location:** `~/Downloads/AI-Workspace/` (user configures during setup)

**Structure:**
```
~/Downloads/AI-Workspace/
├── Documents/
│   ├── reports/           ← Generated reports, analysis
│   ├── notes/             ← Meeting notes, summaries
│   └── drafts/            ← Work in progress
│
├── Code/
│   ├── python/            ← Python scripts
│   ├── bash/              ← Shell scripts
│   └── other/             ← Other languages
│
├── Research/
│   ├── summaries/         ← Research summaries
│   └── sources/           ← Collected sources
│
├── Spreadsheets/          ← Generated spreadsheets
│
├── temp/                  ← Temporary files
│   └── (auto-cleaned after 7 days)
│
└── .fileops/              ← File Ops metadata (hidden)
    ├── index.json         ← File index for search
    └── audit.log          ← Local audit trail
```

**Properties:**
- AI has full read-write access
- No grant required
- User can browse anytime
- Organized by content type

### Domain 2: User Files (Grant Required)

User's existing files that AI may need to access.

**Examples:**
```
~/Documents/Work/          ← User's work files
~/Downloads/               ← Downloaded files
~/Projects/                ← User's code projects
```

**Access Control:**
- AI cannot access without explicit grant
- Grants can be: read-only or read-write
- Grants can be: permanent or session-only
- User can revoke anytime

---

## Grants System

### Grant Model

```json
{
  "id": "grant_abc123",
  "path": "/home/tomasz/Documents/Work/Projects/",
  "permission": "read-write",
  "scope": "permanent",
  "granted_at": "2026-02-01T10:30:00Z",
  "granted_by": "user_explicit",
  "expires_at": null,
  "last_accessed": "2026-02-01T14:20:00Z",
  "access_count": 15
}
```

**Permission Levels:**
- `read` - Can read files, cannot modify
- `read-write` - Can read and modify files
- `write` - Can create new files, cannot read existing (rare)

**Scope:**
- `session` - Grant expires when session ends
- `permanent` - Grant persists until revoked

**Granted By:**
- `user_explicit` - User clicked "Grant Access"
- `user_implicit` - User drag-dropped file (grants read for that file)
- `system_setup` - Granted during initial setup

### Grant Storage

Grants stored in SQLite database: `~/.annabelle/data/grants.db`

```sql
CREATE TABLE grants (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    permission TEXT NOT NULL,
    scope TEXT NOT NULL,
    granted_at TIMESTAMP NOT NULL,
    granted_by TEXT NOT NULL,
    expires_at TIMESTAMP,
    last_accessed TIMESTAMP,
    access_count INTEGER DEFAULT 0
);

CREATE INDEX idx_grants_path ON grants(path);
```

### Grant Operations

**check_grant**

Check if AI has access to a path.

```
Input:
{
  "path": "/home/tomasz/Documents/Work/report.pdf"
}

Output:
{
  "has_access": true,
  "permission": "read",
  "grant_id": "grant_abc123",
  "granted_path": "/home/tomasz/Documents/Work/"
}
```

**request_grant**

Request access to a path (prompts user).

```
Input:
{
  "path": "/home/tomasz/Documents/Work/",
  "permission": "read-write",
  "reason": "To help organize your project files"
}

Output:
{
  "status": "pending",
  "request_id": "req_xyz789",
  "message": "Waiting for user approval"
}

// After user approves:
{
  "status": "granted",
  "grant_id": "grant_abc123",
  "permission": "read-write"
}

// If user denies:
{
  "status": "denied",
  "message": "User denied access request"
}
```

**list_grants**

List all active grants.

```
Input: {}

Output:
{
  "grants": [
    {
      "id": "grant_abc123",
      "path": "/home/tomasz/Documents/Work/",
      "permission": "read-write",
      "granted_at": "2026-02-01T10:30:00Z",
      "access_count": 15
    }
  ]
}
```

**revoke_grant**

Revoke a grant (user action).

```
Input:
{
  "grant_id": "grant_abc123"
}

Output:
{
  "success": true,
  "revoked_path": "/home/tomasz/Documents/Work/"
}
```

### Grant Request Flow

```
1. AI needs to read user file
       ↓
2. AI calls: read_file("/home/user/Documents/report.pdf")
       ↓
3. File Ops checks grants
       ↓
4. No grant found
       ↓
5. File Ops returns: "No access. Call request_grant() first."
       ↓
6. AI calls: request_grant(path, permission, reason)
       ↓
7. User sees prompt:
   ┌─────────────────────────────────────────────┐
   │  AI Assistant wants to access:              │
   │  ~/Documents/report.pdf                     │
   │                                             │
   │  Reason: To analyze the quarterly report    │
   │                                             │
   │  [Allow Once] [Allow Folder] [Deny]         │
   └─────────────────────────────────────────────┘
       ↓
8. User clicks "Allow Folder"
       ↓
9. Grant created for ~/Documents/ with read permission
       ↓
10. AI can now read the file
```

---

## File Operations

### Workspace Operations (No Grant Needed)

**create_file**

Create a file in AI workspace.

```
Input:
{
  "path": "Documents/reports/quarterly-analysis.md",  // Relative to workspace
  "content": "# Quarterly Analysis\n\n...",
  "overwrite": false
}

Output:
{
  "success": true,
  "full_path": "~/Downloads/AI-Workspace/Documents/reports/quarterly-analysis.md",
  "created_at": "2026-02-01T10:30:00Z",
  "size_bytes": 1234
}
```

**Note:** Path is relative to workspace root. Cannot use absolute paths or `..` to escape.

**read_file**

Read a file (workspace or granted path).

```
Input:
{
  "path": "Documents/reports/quarterly-analysis.md"  // Workspace
  // OR
  "path": "/home/tomasz/Documents/Work/report.pdf"   // Absolute (needs grant)
}

Output:
{
  "success": true,
  "content": "# Quarterly Analysis\n\n...",
  "path": "...",
  "size_bytes": 1234,
  "modified_at": "2026-02-01T10:30:00Z"
}
```

**list_files**

List files in a directory.

```
Input:
{
  "path": "Documents/reports/",   // Workspace
  "recursive": false
}

Output:
{
  "files": [
    {
      "name": "quarterly-analysis.md",
      "type": "file",
      "size_bytes": 1234,
      "modified_at": "2026-02-01T10:30:00Z"
    },
    {
      "name": "archive/",
      "type": "directory"
    }
  ]
}
```

**update_file**

Update an existing file.

```
Input:
{
  "path": "Documents/reports/quarterly-analysis.md",
  "content": "# Updated Quarterly Analysis\n\n...",
  "create_backup": true
}

Output:
{
  "success": true,
  "backup_path": "Documents/reports/quarterly-analysis.md.bak",
  "updated_at": "2026-02-01T10:30:00Z"
}
```

**delete_file**

Delete a file (workspace only).

```
Input:
{
  "path": "temp/old-draft.md"
}

Output:
{
  "success": true,
  "deleted_path": "~/Downloads/AI-Workspace/temp/old-draft.md"
}
```

**Note:** Cannot delete files outside workspace.

**move_file**

Move or rename a file within workspace.

```
Input:
{
  "source": "temp/draft.md",
  "destination": "Documents/notes/meeting-notes.md"
}

Output:
{
  "success": true,
  "new_path": "~/Downloads/AI-Workspace/Documents/notes/meeting-notes.md"
}
```

**copy_file**

Copy a file (can copy from granted paths to workspace).

```
Input:
{
  "source": "/home/tomasz/Documents/template.docx",  // Granted path
  "destination": "Documents/drafts/my-doc.docx"       // Workspace
}

Output:
{
  "success": true,
  "destination_path": "~/Downloads/AI-Workspace/Documents/drafts/my-doc.docx"
}
```

### Search Operations

**search_files**

Search for files by name or content.

```
Input:
{
  "query": "quarterly",
  "search_in": "workspace",     // or "granted" or "all"
  "search_type": "filename",    // or "content"
  "file_types": [".md", ".txt"]
}

Output:
{
  "results": [
    {
      "path": "Documents/reports/quarterly-analysis.md",
      "match_type": "filename",
      "modified_at": "2026-02-01T10:30:00Z"
    }
  ],
  "total_count": 1
}
```

### Workspace Info

**get_workspace_info**

Get workspace location and stats.

```
Input: {}

Output:
{
  "workspace_path": "~/Downloads/AI-Workspace/",
  "total_files": 127,
  "total_size_mb": 45.3,
  "temp_files": 5,
  "last_cleanup": "2026-02-01T00:00:00Z"
}
```

---

## Security Boundaries

### Path Validation

All paths are validated before operations:

```python
def validate_path(path, operation):
    # Normalize path
    normalized = os.path.normpath(os.path.expanduser(path))

    # Check for path traversal attempts
    if '..' in path:
        raise SecurityError("Path traversal not allowed")

    # Workspace operations
    if is_relative_path(path):
        full_path = os.path.join(WORKSPACE_ROOT, normalized)
        if not full_path.startswith(WORKSPACE_ROOT):
            raise SecurityError("Path escapes workspace")
        return full_path, "workspace"

    # External paths require grant
    if is_absolute_path(path):
        grant = check_grant(normalized)
        if not grant:
            raise PermissionError("No grant for path")
        if operation == "write" and grant.permission == "read":
            raise PermissionError("Read-only grant")
        return normalized, "granted"
```

### Forbidden Paths

Never allow access to (even with grants):

```python
FORBIDDEN_PATHS = [
    "~/.ssh/",              # SSH keys
    "~/.gnupg/",            # GPG keys
    "~/.aws/",              # AWS credentials
    "~/.config/",           # App configs (often contain tokens)
    "/etc/",                # System configs
    "/var/",                # System data
    "~/.annabelle/data/",   # Our own databases
]
```

### File Type Restrictions

For security, restrict executable operations:

```yaml
security:
  # Cannot create executable files
  forbidden_extensions_create:
    - .exe
    - .sh (unless in Code/bash/)
    - .bat
    - .ps1

  # Cannot read binary files over size limit
  max_binary_read_mb: 10

  # Warn on potentially sensitive files
  sensitive_patterns:
    - "**/credentials*"
    - "**/secret*"
    - "**/*.pem"
    - "**/*.key"
```

---

## Audit Logging

### What Gets Logged

Every file operation is logged:

```json
{
  "timestamp": "2026-02-01T10:30:00Z",
  "operation": "read_file",
  "path": "/home/tomasz/Documents/Work/report.pdf",
  "domain": "granted",
  "grant_id": "grant_abc123",
  "agent_id": "main",
  "session_id": "sess_xyz789",
  "success": true,
  "size_bytes": 45678
}
```

### Audit Log Location

```
~/.annabelle/logs/fileops-audit.log      # Full audit trail
~/Downloads/AI-Workspace/.fileops/audit.log  # Workspace-only log
```

### Audit Queries

**get_audit_log**

```
Input:
{
  "path_filter": "/home/tomasz/Documents/Work/",
  "operation_filter": "read",
  "date_from": "2026-02-01",
  "limit": 100
}

Output:
{
  "entries": [
    {
      "timestamp": "2026-02-01T10:30:00Z",
      "operation": "read_file",
      "path": "/home/tomasz/Documents/Work/report.pdf",
      "success": true
    }
  ]
}
```

---

## Temporary File Management

### Temp Directory

`~/Downloads/AI-Workspace/temp/` for temporary files.

### Auto-Cleanup

Cron job runs daily:

```python
def cleanup_temp():
    temp_dir = WORKSPACE_ROOT / "temp"
    cutoff = datetime.now() - timedelta(days=7)

    for file in temp_dir.rglob("*"):
        if file.is_file() and file.stat().st_mtime < cutoff.timestamp():
            file.unlink()
            log_cleanup(file)
```

### Cleanup Configuration

```yaml
cleanup:
  temp_retention_days: 7
  run_schedule: "0 2 * * *"  # 2 AM daily
  notify_before_delete: false
```

---

## API Specification

### MCP Protocol

File Ops MCP implements standard MCP protocol.

**Base URL:** `http://localhost:8003`
**Format:** HTTP POST with JSON body

### Tool Definitions

**Tool 1: create_file**
```yaml
name: create_file
description: Create a file in AI workspace
parameters:
  path:
    type: string
    required: true
    description: Relative path within workspace
  content:
    type: string
    required: true
  overwrite:
    type: boolean
    default: false
returns:
  success: boolean
  full_path: string
  created_at: timestamp
  size_bytes: integer
```

**Tool 2: read_file**
```yaml
name: read_file
description: Read a file (workspace or granted path)
parameters:
  path:
    type: string
    required: true
    description: Relative workspace path or absolute granted path
returns:
  success: boolean
  content: string
  path: string
  size_bytes: integer
  modified_at: timestamp
```

**Tool 3: list_files**
```yaml
name: list_files
description: List files in a directory
parameters:
  path:
    type: string
    required: true
  recursive:
    type: boolean
    default: false
returns:
  files: array of file objects
```

**Tool 4: update_file**
```yaml
name: update_file
description: Update an existing file
parameters:
  path:
    type: string
    required: true
  content:
    type: string
    required: true
  create_backup:
    type: boolean
    default: true
returns:
  success: boolean
  backup_path: string (if backup created)
  updated_at: timestamp
```

**Tool 5: delete_file**
```yaml
name: delete_file
description: Delete a file (workspace only)
parameters:
  path:
    type: string
    required: true
    description: Relative path within workspace
returns:
  success: boolean
  deleted_path: string
```

**Tool 6: move_file**
```yaml
name: move_file
description: Move or rename a file within workspace
parameters:
  source:
    type: string
    required: true
  destination:
    type: string
    required: true
returns:
  success: boolean
  new_path: string
```

**Tool 7: copy_file**
```yaml
name: copy_file
description: Copy a file (can copy from granted paths to workspace)
parameters:
  source:
    type: string
    required: true
  destination:
    type: string
    required: true
returns:
  success: boolean
  destination_path: string
```

**Tool 8: search_files**
```yaml
name: search_files
description: Search for files
parameters:
  query:
    type: string
    required: true
  search_in:
    type: string
    enum: [workspace, granted, all]
    default: workspace
  search_type:
    type: string
    enum: [filename, content]
    default: filename
  file_types:
    type: array
    required: false
returns:
  results: array of file matches
  total_count: integer
```

**Tool 9: check_grant**
```yaml
name: check_grant
description: Check if path is accessible
parameters:
  path:
    type: string
    required: true
returns:
  has_access: boolean
  permission: string (if granted)
  grant_id: string (if granted)
```

**Tool 10: request_grant**
```yaml
name: request_grant
description: Request access to a path
parameters:
  path:
    type: string
    required: true
  permission:
    type: string
    enum: [read, read-write]
    required: true
  reason:
    type: string
    required: true
    description: Why AI needs access (shown to user)
returns:
  status: string (pending, granted, denied)
  grant_id: string (if granted)
  message: string
```

**Tool 11: list_grants**
```yaml
name: list_grants
description: List all active grants
parameters: {}
returns:
  grants: array of grant objects
```

**Tool 12: get_workspace_info**
```yaml
name: get_workspace_info
description: Get workspace location and statistics
parameters: {}
returns:
  workspace_path: string
  total_files: integer
  total_size_mb: float
  temp_files: integer
```

**Tool 13: get_audit_log**
```yaml
name: get_audit_log
description: Get file operation audit log
parameters:
  path_filter:
    type: string
    required: false
  operation_filter:
    type: string
    required: false
  date_from:
    type: string
    format: date
    required: false
  limit:
    type: integer
    default: 100
returns:
  entries: array of audit entries
```

---

## Configuration

### Configuration File

```yaml
# fileops-mcp.yaml

server:
  host: 0.0.0.0
  port: 8003

workspace:
  path: ~/Downloads/AI-Workspace/
  create_if_missing: true

  structure:
    - Documents/reports/
    - Documents/notes/
    - Documents/drafts/
    - Code/python/
    - Code/bash/
    - Research/
    - Spreadsheets/
    - temp/

grants:
  database: ~/.annabelle/data/grants.db
  default_scope: permanent

security:
  forbidden_paths:
    - ~/.ssh/
    - ~/.gnupg/
    - ~/.aws/
    - ~/.config/
    - ~/.annabelle/data/

  forbidden_extensions_create:
    - .exe
    - .bat
    - .ps1

  max_file_size_mb: 50
  max_binary_read_mb: 10

cleanup:
  temp_retention_days: 7
  run_schedule: "0 2 * * *"

audit:
  enabled: true
  log_path: ~/.annabelle/logs/fileops-audit.log
  max_log_size_mb: 100
```

### Environment Variables

```bash
TRANSPORT=stdio                              # "stdio" or "http"/"sse"
PORT=8003                                    # Port for HTTP transport
WORKSPACE_PATH=~/Downloads/AI-Workspace/     # AI workspace directory
GRANTS_DB_PATH=~/.annabelle/data/grants.db   # Grants storage path
AUDIT_LOG_PATH=~/.annabelle/logs/fileops-audit.log
TEMP_CLEANUP_DAYS=7                          # Days before temp files auto-delete
AGENT_ID=main                                # Agent identifier for audit logs
SESSION_ID=default                           # Session identifier
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

EXPOSE 8003

CMD ["python", "-m", "fileops_mcp.main"]
```

### Docker Compose

```yaml
services:
  fileops-mcp:
    build: ./fileops-mcp
    ports:
      - "8003:8003"
    volumes:
      - ~/Documents/AI-Workspace:/workspace
      - annabelle-data:/data
      - ./config:/app/config
    networks:
      - annabelle
    restart: unless-stopped
```

**Volume Mounts:**
- `/workspace` → User's AI workspace (for file creation)
- `/data` → Grants database, audit logs

### Resource Requirements

- CPU: 0.25 cores
- Memory: 128-256MB
- Storage: Minimal (workspace storage is user's disk)

---

## User Setup Flow

### Initial Configuration

During Annabelle setup:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Workspace Setup                              │
│                                                                  │
│  Where should AI save files it creates?                          │
│                                                                  │
│  Default: ~/Downloads/AI-Workspace/                              │
│                                                                  │
│  [Use Default]     [Choose Different Location...]                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   Pre-Grant Access (Optional)                    │
│                                                                  │
│  Grant AI access to these folders now?                           │
│  (You can always grant more access later)                        │
│                                                                  │
│  ☐ ~/Documents/Work/        [Read-Write]                         │
│  ☐ ~/Downloads/             [Read Only]                          │
│  ☐ Add another folder...                                         │
│                                                                  │
│  [Skip for Now]     [Continue]                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Runtime Grant Requests

When AI needs access during conversation:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Access Request                                │
│                                                                  │
│  AI wants to read files in:                                      │
│  ~/Documents/Work/Projects/laser-coating/                        │
│                                                                  │
│  Reason: "To help analyze your simulation results"               │
│                                                                  │
│  [Allow This File]  [Allow Folder]  [Allow Folder (Read-Write)]  │
│                                                                  │
│  [Deny]                                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Success Criteria

### Functional Requirements

✅ **Must support:**
- Create files in workspace
- Read files (workspace and granted)
- List directory contents
- Search files by name
- Grant management (request, list, revoke)
- Audit logging

✅ **Must enforce:**
- No access without grant
- Path validation (no traversal)
- Forbidden paths blocked
- File size limits

### Performance Requirements

⚡ **Latency targets:**
- create_file: < 100ms for < 1MB
- read_file: < 100ms for < 1MB
- list_files: < 200ms
- search_files: < 500ms (workspace)
- check_grant: < 20ms

### Security Requirements

🛡️ **Must prevent:**
- Path traversal attacks
- Access to forbidden paths
- Unauthorized file access
- Executable creation (outside Code/)

---

## Implementation Phases

### Phase 1: Core Operations (MVP)

- Workspace directory setup
- create_file, read_file, list_files
- Basic grants (check, manual grant via config)
- Audit logging

### Phase 2: Full Grants System

- request_grant with UI prompt
- list_grants, revoke_grant
- Grant persistence
- Session vs permanent grants

### Phase 3: Enhancements

- Content search
- Temp cleanup automation
- Workspace statistics
- File versioning/backup

---

## Decisions Made

### Grant UI Approach (MVP)

**Decision:** Use config file for pre-populated grants.

For MVP, grants are defined in a config file rather than interactive approval:

```yaml
# In fileops-mcp.yaml or grants-config.yaml
grants:
  - path: ~/Documents/Work/
    permission: read-write
    scope: permanent
  - path: ~/Downloads/
    permission: read
    scope: permanent
```

On startup, Filer loads these grants into grants.db. The `request_grant` tool will return an error explaining that grants must be configured via config file.

**Next Step:** Implement interactive grant approval UI (Phase 2) - options include:

- Web UI popup in Annabelle frontend
- System notification with approval link
- Telegram message via Telegram MCP

---

## Open Questions

### Phase 1 Decisions

1. ~~**Grant UI:** How to show grant request to user?~~ → **RESOLVED: Config file for MVP**
2. **Workspace location:** Should user be able to change workspace after setup?
3. **File versioning:** Keep backups of overwritten files? How many?

### Future Considerations

1. **Cloud sync:** Sync workspace to cloud storage?
2. **Collaboration:** Share files between users?
3. **Large files:** How to handle files > 50MB?
4. **Binary files:** Support for images, PDFs? (read content vs just copy)
5. **Interactive grant approval:** Build UI for runtime grant requests
