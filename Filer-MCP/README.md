# Filer MCP

A Model Context Protocol (MCP) server for file operations with workspace isolation and a grants-based permission system.

## Features

- **Workspace Isolation**: AI operates in a dedicated workspace directory
- **Grants System**: External file access requires explicit permission via config
- **13 File Tools**: Create, read, update, delete, move, copy, search files
- **Audit Logging**: All operations logged to JSONL format
- **Auto Cleanup**: Temp files cleaned on server startup after configurable days
- **Dual Transport**: Supports stdio (Claude Desktop) and HTTP/SSE

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATION LAYER                           │
│  AI requests file operation → Filer MCP                         │
└─────────────────────────────────┬───────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                       FILER MCP                                  │
│                  (stdio or HTTP :8004)                           │
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
│ ~/Downloads/AI-Workspace│                   │ (Granted Access Only)   │
│                         │                   │                         │
│ • Always accessible     │                   │ • Requires grant        │
│ • AI creates files here │                   │ • Read or read-write    │
│ • Organized structure   │                   │ • User controls access  │
└─────────────────────────┘                   └─────────────────────────┘
```

## Installation

```bash
npm install
npm run build
npm start        # stdio mode for Claude Desktop
```

## Configuration

### Environment Variables

Create a `.env` file (see `.env.example`):

```bash
TRANSPORT=stdio                              # "stdio" or "http"/"sse"
PORT=8004                                    # Port for HTTP transport
WORKSPACE_PATH=~/Downloads/AI-Workspace/     # AI workspace directory
GRANTS_DB_PATH=~/.annabelle/data/grants.json # Grants storage
AUDIT_LOG_PATH=~/.annabelle/logs/fileops-audit.log
TEMP_CLEANUP_DAYS=7                          # Days before temp auto-delete
```

### Grants Configuration

Create `fileops-mcp.yaml` in the project root to grant access to external paths:

```yaml
grants:
  - path: ~/Documents/Work/
    permission: read-write
  - path: ~/Projects/
    permission: read
```

On startup, Filer loads these grants into its JSON store. The `request_grant` tool returns instructions explaining that grants must be configured via this file.

### Claude Desktop Setup

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "filer": {
      "command": "node",
      "args": ["/path/to/filer-mcp/dist/index.js"],
      "env": {
        "WORKSPACE_PATH": "~/Downloads/AI-Workspace/"
      }
    }
  }
}
```

## Available Tools

### File Operations

| Tool           | Description                                              |
| -------------- | -------------------------------------------------------- |
| `create_file`  | Create a file in workspace                               |
| `read_file`    | Read file contents (workspace or granted path)           |
| `list_files`   | List directory contents                                  |
| `update_file`  | Update existing file (with optional backup)              |
| `delete_file`  | Delete a file (workspace only)                           |
| `move_file`    | Move/rename a file within workspace                      |
| `copy_file`    | Copy a file (can copy from granted paths to workspace)   |
| `search_files` | Search by name pattern or content text                   |

### Grant Operations

| Tool            | Description                                          |
| --------------- | ---------------------------------------------------- |
| `check_grant`   | Check if AI has access to an external path           |
| `request_grant` | Request access (returns config file instructions)    |
| `list_grants`   | List all active grants                               |

### Info Operations

| Tool                 | Description                              |
| -------------------- | ---------------------------------------- |
| `get_workspace_info` | Workspace location, file count, disk usage |
| `get_audit_log`      | View operation history with filtering    |

## Tool API Details

### create_file

Create a file in the AI workspace. Path is relative to workspace root.

```jsonc
// Input
{ "path": "Documents/reports/analysis.md", "content": "# Analysis\n...", "overwrite": false }
// Output
{ "success": true, "full_path": "...", "created_at": "...", "size_bytes": 1234 }
```

### read_file

Read a file from workspace (relative path) or granted location (absolute path).

```jsonc
// Input (workspace)
{ "path": "Documents/reports/analysis.md" }
// Input (granted path)
{ "path": "/Users/you/Projects/app/README.md" }
// Output
{ "success": true, "content": "...", "path": "...", "size_bytes": 1234, "modified_at": "..." }
```

### list_files

List files and folders in a directory.

```jsonc
// Input
{ "path": "Documents/reports/", "recursive": false }
// Output
{ "files": [{ "name": "report.md", "type": "file", "size_bytes": 1234, "modified_at": "..." }] }
```

### update_file

Replace contents of an existing file, with optional backup.

```jsonc
// Input
{ "path": "Documents/reports/analysis.md", "content": "# Updated\n...", "create_backup": true }
// Output
{ "success": true, "backup_path": "...analysis.md.bak", "updated_at": "..." }
```

### delete_file

Delete a file from workspace only. Cannot delete files outside workspace.

```jsonc
// Input
{ "path": "temp/old-draft.md" }
// Output
{ "success": true, "deleted_path": "~/Downloads/AI-Workspace/temp/old-draft.md" }
```

### move_file

Move or rename a file within workspace.

```jsonc
// Input
{ "source": "temp/draft.md", "destination": "Documents/notes/meeting-notes.md" }
// Output
{ "success": true, "new_path": "~/Downloads/AI-Workspace/Documents/notes/meeting-notes.md" }
```

### copy_file

Copy a file. Can copy from granted paths into workspace.

```jsonc
// Input
{ "source": "/Users/you/Documents/template.docx", "destination": "Documents/drafts/my-doc.docx" }
// Output
{ "success": true, "destination_path": "~/Downloads/AI-Workspace/Documents/drafts/my-doc.docx" }
```

### search_files

Search for files by name pattern or content text. Capped at 100 results.

```jsonc
// Input (filename search)
{ "pattern": "*.py", "search_type": "filename" }
// Input (content search)
{ "query": "quarterly", "search_type": "content" }
// Output
{ "results": [{ "path": "...", "match_type": "filename", "modified_at": "..." }], "total_count": 1 }
```

### check_grant

Check if AI has access to a path outside workspace.

```jsonc
// Input
{ "path": "/Users/you/Documents/Work/report.pdf" }
// Output
{ "has_access": true, "permission": "read", "grant_id": "grant_abc123", "granted_path": "/Users/you/Documents/Work/" }
```

### request_grant

Request access to an external path. Returns instructions for configuring access via `fileops-mcp.yaml`.

```jsonc
// Input
{ "path": "/Users/you/Documents/Work/", "permission": "read-write", "reason": "To organize project files" }
// Output
{ "status": "instructions", "message": "Add the path to fileops-mcp.yaml and restart" }
```

### list_grants

List all active file access grants.

```jsonc
// Input
{}
// Output
{ "grants": [{ "id": "grant_abc123", "path": "/Users/you/Documents/Work/", "permission": "read-write", "granted_at": "...", "access_count": 15 }] }
```

### get_workspace_info

Get workspace root path, file count, and disk usage stats.

```jsonc
// Input
{}
// Output
{ "workspace_path": "~/Downloads/AI-Workspace/", "total_files": 127, "total_size_mb": 45.3, "temp_files": 5 }
```

### get_audit_log

Get audit log of file operations with optional filtering.

```jsonc
// Input
{ "path_filter": "/Users/you/Documents/", "operation_filter": "read", "date_from": "2026-02-01", "limit": 100 }
// Output
{ "entries": [{ "timestamp": "...", "operation": "read_file", "path": "...", "success": true }] }
```

## Grants System

### Storage Domains

**AI Workspace** (always accessible): `~/Downloads/AI-Workspace/` — AI has full read-write access, no grant required.

**User Files** (grant required): Any path outside the workspace. Access must be explicitly granted via `fileops-mcp.yaml` config. Grants can be `read` or `read-write`.

### Grant Flow

1. AI calls `read_file` with an absolute path
2. Filer checks grants store
3. No grant found — returns "No access. Call request_grant() first."
4. AI calls `request_grant` — receives instructions to add the path to `fileops-mcp.yaml`
5. After user edits config and restarts, the grant is active

## Workspace Structure

```text
~/Downloads/AI-Workspace/
├── Documents/
│   ├── reports/
│   ├── notes/
│   └── drafts/
├── Code/
│   ├── python/
│   ├── bash/
│   └── other/
├── Research/
│   ├── summaries/
│   └── sources/
├── Spreadsheets/
├── temp/              ← Auto-cleaned on startup (default: 7 days)
└── .fileops/
    └── audit.log
```

## Security

### Path Validation

- All paths normalized before operations
- `..` not allowed in paths (prevents traversal)
- Relative paths resolve within workspace only
- Absolute paths require a matching grant

### Forbidden Paths

Never allow access (even with grants):

- `~/.ssh/` — SSH keys
- `~/.gnupg/` — GPG keys
- `~/.aws/` — AWS credentials
- `~/.config/` — App configs (often contain tokens)
- `/etc/` — System configs
- `/var/` — System data
- `~/.annabelle/data/` — Internal databases

### Audit Trail

Every file operation is logged to JSONL:

```json
{
  "timestamp": "2026-02-01T10:30:00Z",
  "operation": "read_file",
  "path": "/Users/you/Documents/Work/report.pdf",
  "domain": "granted",
  "grant_id": "grant_abc123",
  "success": true,
  "size_bytes": 45678
}
```

Log location: `~/.annabelle/logs/fileops-audit.log`

## Known Issues

### Spec Deviations

1. **Grant storage uses JSON, not SQLite** — works fine for MVP with small grant counts
2. **Cleanup runs on startup only**, not on a daily schedule — acceptable for Claude Desktop usage (frequent restarts)
3. **No file index** — search scans files directly, capped at 100 results
4. **YAML config parsing uses regex**, not a proper parser — may fail on complex structures

### Missing Integrations

1. **No Guardian MCP integration** — relies on local path validation only, no prompt injection scanning
2. **No Memory MCP integration** — standalone operation, no persistent user preferences

### Implementation Gaps

1. **No test coverage** — security-critical code needs tests (high priority)
2. **No audit log rotation** — log grows indefinitely
3. **Write file size limit not enforced** — only checked on read, not write

## Development

```bash
npm run dev          # Watch mode
npx tsc --noEmit     # Type check
npx vitest run       # Tests
```

## License

MIT
