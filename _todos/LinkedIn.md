# LinkedIn MCP — Implementation Status

## Done — All Phases Complete

All tools implemented, tested (46 unit + 3 integration), and wired into the ecosystem.

### Phase 1 — Read-only (MVP)

| Tool | Description |
|---|---|
| `get_profile` | Get profile by public ID |
| `get_own_profile` | Get authenticated user's profile |
| `search_people` | Search people by keywords/company/title |
| `get_feed_posts` | Read feed posts |
| `get_conversations` | List inbox conversations |

### Phase 2 — Write Operations

| Tool | Description |
|---|---|
| `send_message` | Send DM (reply to conversation or start new) |
| `react_to_post` | Like/celebrate/empathy/interest/appreciation |

### Phase 3 — Network & Company

| Tool | Description |
|---|---|
| `get_conversation` | Get messages from a specific conversation thread |
| `get_connections` | List authenticated user's connections |
| `send_connection_request` | Send invitation with personalized note (max 300 chars) |
| `search_companies` | Search companies by keyword |
| `get_company` | Get detailed company info |

### Not Implementable

| Tool | Reason |
|---|---|
| `create_post` | `linkedin-api` library doesn't expose this method |
| `comment_on_post` | `linkedin-api` library doesn't expose this method |

### Supporting Infrastructure

- Auto-discovery: `command`/`commandArgs` fields in manifest (Shared + Orchestrator)
- Tool discovery: ToolRouter labels/groups/hints, tool-selector keyword routes
- Skill/playbook: `~/.annabelle/skills/LinkedInNetworking/SKILL.md`
- Guardian: disabled for linkedin (input + output) in `guardian.ts`
- Tests: 46 unit (mocked client), 3 integration (stdio subprocess), e2e (skipped w/o creds)
- Docs: `HOW-TO-ADD-NEW-MPC.md` updated with Python MCP example

## Operational Notes

- Guardian is currently disabled for LinkedIn — re-enable in `Orchestrator/src/config/guardian.ts` when ready
- Monitor `~/.linkedin_api/cookies/` for session expiry — may need a health-check tool
- The `uv sync --extra dev` build preserves test deps; plain `uv sync` strips them
