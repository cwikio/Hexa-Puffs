# Changelog

All notable changes to Hexa Puffs will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- Project documentation overhaul: CONVENTIONS.md, tech-stack-preferences.md, ADRs, agents-config schema reference, docs/ index
- Consolidated all documentation from `.documentation/` into `docs/`
- Thinker README rewritten as operational documentation (replaces design spec)

### Fixed

- CONTRIBUTING.md broken link (`how-to-add-new-mpc.md` -> `how-to-add-new-mcp.md`)
- getting-started.md clone path (`cd MCPs` -> `cd Hexa-Puffs`)
- getting-started.md broken link to MCP guide
- Orchestrator README architecture diagram updated (all MCPs now shown as stdio)
- Orchestrator README tool count corrected (148+ tools)
- Orchestrator README launch description updated (no separate HTTP MCPs)
- Memorizer env var documentation clarified (AI_PROVIDER vs EMBEDDING_PROVIDER)
- README.md documentation reference now links to Claude Desktop integration guide

## [1.0.0] - 2026-02-15

### Added

- Initial release of the Hexa Puffs AI Assistant system
- **Orchestrator** -- central hub with auto-discovery, multi-agent support, tool routing, slash commands, kill switch, Inngest job scheduling
- **Thinker** -- AI reasoning engine with ReAct loop (Vercel AI SDK), embedding-based tool selection, session persistence with compaction, cost controls with spike detection, playbook system, fact extraction
- **Guardian** -- prompt injection scanning via IBM Granite Guardian with multi-provider support
- **Memorizer-MCP** -- persistent memory with facts, conversations, profiles, skills, contacts, projects, timeline queries, 3-tier hybrid search (vector + FTS5 + keyword)
- **Filer-MCP** -- file operations with workspace isolation, grants-based permissions, audit logging
- **Telegram-MCP** -- MTProto messaging via GramJS with real-time message handling
- **Searcher-MCP** -- web/news/image search via Brave Search API, URL content extraction
- **Gmail-MCP** -- email and calendar operations via Google APIs with OAuth2
- **Onepassword-MCP** -- read-only 1Password vault access via `op` CLI
- **CodeExec-MCP** -- sandboxed Python/Node/Bash execution with script library
- **Browser-MCP** -- headless Chromium via Playwright with proxy support
- **Connector-MCP** -- Claude Desktop integration bridge
- **Shared** -- common types, utilities, logger, register-tool pattern, StandardResponse, dual-transport, discovery, testing helpers
- External MCP system with hot-reload (`external-mcps.json`)
- Per-agent cost controls with anomaly-based spike detection and Telegram notifications
- Channel bindings for multi-agent message routing
- Subagent spawning with tool policy inheritance and cascade-kill
- Comprehensive documentation (13 architecture docs, 5 Mermaid diagrams)
