# Contributing to Hexa Puffs

Thank you for your interest in contributing to Hexa Puffs!

## Getting Started

1. Fork the repository
2. Clone your fork and set up the project:
   ```bash
   git clone https://github.com/<your-username>/Hexa-Puffs.git
   cd Hexa-Puffs
   ```
3. Copy environment configs:
   ```bash
   for dir in Orchestrator Thinker Guardian Memorizer-MCP Filer-MCP Telegram-MCP Searcher-MCP Gmail-MCP Onepassword-MCP CodeExec-MCP Browser-MCP; do
     [ -f "$dir/.env.example" ] && cp "$dir/.env.example" "$dir/.env"
   done
   cp agents.json.example agents.json
   ```
4. Build all packages:
   ```bash
   ./rebuild.sh
   ```
5. Run tests:
   ```bash
   ./test.sh --vitest
   ```

See [getting-started.md](getting-started.md) for the full setup guide including external service configuration.

## Development Workflow

- Each subdirectory is an independent package with its own `package.json`. There is no root `package.json`.
- Build order matters: **Shared** must build first (`./rebuild.sh` handles this automatically).
- Run `npx tsc --noEmit` in any package to check for type errors.
- Run `npx vitest run` in any package to run its tests.

## Submitting Changes

1. Create a feature branch from `main`
2. Make your changes
3. Ensure tests pass: `./test.sh`
4. Ensure no type errors in changed packages: `cd <Package> && npx tsc --noEmit`
5. Open a pull request against `main`

## Adding a New MCP

See [how-to-add-new-mcp.md](how-to-add-new-mcp.md) for the complete guide. The short version:

1. Create a directory with a `package.json` containing a `"hexa-puffs"` field
2. Add `mcpName` to the manifest for auto-discovery
3. Build and restart the Orchestrator

## Code Style

- TypeScript with strict mode
- Zod schemas for all tool input validation
- Structured return objects using `StandardResponse` from `@mcp/shared`
- Avoid type casting (`as`) — prefer type guards and narrowing

## Reporting Issues

- Use [GitHub Issues](https://github.com/cwikio/Hexa-Puffs/issues)
- Include steps to reproduce, expected behavior, and actual behavior
- Include relevant log output from `~/.hexa-puffs/logs/`

## License

By contributing, you agree that your contributions will be licensed under the same [Hexa Puffs License](LICENSE) that covers the project. See [LICENSE](LICENSE) for details.
