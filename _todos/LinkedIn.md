# LinkedIn MCP — Implementation Status

## Done (Phase 1 — Read-only)

All implemented, tested (17 unit + 3 integration), and live in production.

| Tool | Description |
|---|---|
| `get_profile` | Get profile by public ID |
| `get_own_profile` | Get authenticated user's profile |
| `search_people` | Search people by keywords/company/title |
| `get_feed_posts` | Read feed posts |
| `get_conversations` | List inbox conversations |

Supporting infrastructure also complete:
- Auto-discovery: `command`/`commandArgs` fields in manifest (Shared + Orchestrator)
- Tool discovery: ToolRouter labels/groups/hints, tool-selector keyword routes
- Skill/playbook: `~/.annabelle/skills/LinkedInNetworking/SKILL.md`
- Tests: unit (mocked client), integration (stdio subprocess), e2e (skipped w/o creds)
- Docs: `HOW-TO-ADD-NEW-MPC.md` updated with Python MCP example

## TODO: Phase 2 — Write Operations

| Tool | Description | `linkedin-api` method |
|---|---|---|
| `send_message` | Send DM to a connection | `api.send_message(conversation_urn, msg)` |
| `create_post` | Create a text post | `api.post(text)` |
| `react_to_post` | Like/react to a post | `api.react(urn, reaction_type)` |
| `comment_on_post` | Comment on a post | `api.comment(urn, text)` |

Notes:
- The playbook already references `linkedin_send_message` and `linkedin_create_post` — Thinker logs warnings that these are missing
- These are write operations, so the skill should always present drafts for user approval before executing
- Consider rate limiting to reduce LinkedIn detection risk

## TODO: Phase 3 — Network Management

| Tool | Description | `linkedin-api` method |
|---|---|---|
| `get_conversation` | Get a single conversation thread by ID | `api.get_conversation(conversation_urn)` |
| `get_connections` | List connections | `api.get_connections()` |
| `send_connection_request` | Send invitation with personalized note | `api.add_connection(profile_id, message)` |
| `search_companies` | Search companies by keyword | `api.search_companies(keywords)` |
| `get_company` | Get company details | `api.get_company(company_id)` |

## TODO: Playbook Updates

Once Phase 2/3 tools are implemented:
- Remove the `required_tools` entries that cause warnings (or implement the tools)
- Add rate-limiting guidance to the playbook
- Add connection request tracking (log outreach with `memory_store_fact`)

## TODO: Operational

- Consider adding `sensitive: true` to manifest if Guardian should scan LinkedIn inputs
- Monitor `~/.linkedin_api/cookies/` for session expiry — may need a health-check tool
- The `uv sync --extra dev` build preserves test deps; plain `uv sync` strips them
