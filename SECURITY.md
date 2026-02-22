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

Hexa Puffs employs defense-in-depth across multiple layers: Guardian (prompt injection scanning), tool policies (per-agent access control), destructive tool blocking, and cost controls (anomaly-based spike detection).

For the full security architecture, see [Security Architecture](docs/security.md).

## Best Practices for Operators

- Never commit `.env` files — use `.env.example` as templates
- Keep `agents.json` out of version control (contains personal chat IDs)
- Set `SECURITY_FAIL_MODE=closed` in production (blocks tool calls when Guardian is unavailable)
- Set `SCAN_ALL_INPUTS=true` in the Orchestrator for full input scanning
- Use 1Password MCP for credential management instead of hardcoding secrets
