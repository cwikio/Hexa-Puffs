# ADR-002: ESM-Only Modules Across All Packages

**Status:** Accepted
**Date:** 2026-02-15

## Context

Node.js supports both CommonJS (`require()`) and ES Modules (`import`). Mixing them causes interop issues, especially with TypeScript's module resolution. The MCP SDK and Vercel AI SDK are ESM-first packages.

## Decision

**All packages use `"type": "module"` in package.json and `"module": "NodeNext"` in tsconfig.** No CommonJS. All imports use `.js` extensions.

## Consequences

**Benefits:**
- No CJS/ESM interop issues
- Native `import`/`export` everywhere
- Compatible with modern npm packages (MCP SDK, Vercel AI SDK)
- `NodeNext` module resolution is explicit about file extensions, eliminating ambiguity

**Trade-offs:**
- All import paths must include `.js` extensions (even for `.ts` files)
- Some older packages may need `esModuleInterop: true` (already set in base tsconfig)
- Dynamic `require()` is not available (use `createRequire()` if absolutely needed)

## Related

- `tsconfig.base.json` — Shared TypeScript configuration
- `CONVENTIONS.md` — Module system section
