# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Hexa Puffs, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, email: **annabelleivy71@gmail.com**

Include:

- Description of the vulnerability
- Steps to reproduce
- Which component is affected (Guardian, Orchestrator, specific MCP, etc.)
- Potential impact

You should receive a response within 72 hours.

## Architecture

Hexa Puffs includes **Guardian**, a dedicated security MCP that scans all tool inputs and outputs for prompt injection attacks. Guardian runs as a mandatory first-pass filter before any tool execution.

For details on the security architecture, see [Guardian documentation](.Documentation/guardian.md).

## Best Practices for Operators

- Never commit `.env` files — use `.env.example` as templates
- Keep `agents.json` out of version control (contains personal chat IDs)
- Set `SECURITY_FAIL_MODE=closed` in production (blocks tool calls when Guardian is unavailable)
- Set `SCAN_ALL_INPUTS=true` in the Orchestrator for full input scanning
- Use 1Password MCP for credential management instead of hardcoding secrets
