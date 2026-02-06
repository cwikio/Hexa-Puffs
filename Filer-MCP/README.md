# Filer MCP

A Model Context Protocol (MCP) server for file operations with workspace isolation and a grants-based permission system.

## Features

- **Workspace Isolation**: AI operates in a dedicated workspace directory
- **Grants System**: External file access requires explicit permission
- **13 File Tools**: Create, read, update, delete, move, copy, search files
- **Audit Logging**: All operations logged to JSONL format
- **Auto Cleanup**: Temp files automatically deleted after configurable days
- **Dual Transport**: Supports stdio (Claude Desktop) and HTTP/SSE

## Installation

```bash
# Install dependencies
npm install

# Build
npm run build

# Run (stdio mode for Claude Desktop)
npm start
```

## Configuration

### Environment Variables

Create a `.env` file (see `.env.example`):

```bash
TRANSPORT=stdio                              # "stdio" or "http"/"sse"
PORT=8003                                    # Port for HTTP transport
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

## Claude Desktop Setup

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

| Tool | Description |
|------|-------------|
| `create_file` | Create a file in workspace |
| `read_file` | Read file contents |
| `list_files` | List directory contents |
| `update_file` | Update existing file |
| `delete_file` | Delete a file |
| `move_file` | Move/rename a file |
| `copy_file` | Copy a file |
| `search_files` | Search by name or content |

### Grant Operations

| Tool | Description |
|------|-------------|
| `check_grant` | Check access to external path |
| `request_grant` | Request access (returns config instructions) |
| `list_grants` | List all active grants |

### Info Operations

| Tool | Description |
|------|-------------|
| `get_workspace_info` | Workspace location and stats |
| `get_audit_log` | View operation history |

## Workspace Structure

```
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
├── temp/              ← Auto-cleaned after 7 days
└── .fileops/
    └── audit.log
```

## Security

- **Path Traversal Prevention**: `..` not allowed in paths
- **Forbidden Paths**: `~/.ssh/`, `~/.aws/`, `~/.gnupg/`, `/etc/`, etc.
- **Workspace Boundary**: AI cannot escape workspace without grants
- **Audit Trail**: All operations logged with timestamps

## Example Usage

**Create a file:**
```
AI: I'll create a report in your workspace.
→ create_file({ path: "Documents/reports/analysis.md", content: "# Analysis\n..." })
```

**Read external file (with grant):**
```
AI: Let me read that project file.
→ read_file({ path: "/Users/you/Projects/app/README.md" })
```

**Search workspace:**
```
AI: I'll find all Python files.
→ search_files({ pattern: "*.py", search_type: "filename" })
```

## Development

```bash
# Watch mode
npm run dev

# Type check
npx tsc --noEmit
```

## Related Docs

- [FILE_OPS_MCP_SPEC.md](FILE_OPS_MCP_SPEC.md) - Full specification
- [KNOWN_ISSUES.md](KNOWN_ISSUES.md) - Known gaps and future work

## License

MIT
