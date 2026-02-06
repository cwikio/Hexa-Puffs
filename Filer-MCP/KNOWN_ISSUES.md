# Known Issues & Deviations from Spec

This document tracks known gaps between the implementation and the specification (`FILE_OPS_MCP_SPEC.md`), as well as areas for future improvement.

## Spec Deviations

### 1. Grant Storage: JSON instead of SQLite

**Spec says:** Grants stored in SQLite database `~/.annabelle/data/grants.db`

**Implementation:** Uses JSON file storage for simplicity

**Impact:** Works fine for MVP with small number of grants. May need migration for scale.

**Files:** [src/db/index.ts](src/db/index.ts), [src/db/grants.ts](src/db/grants.ts)

---

### 2. Cleanup: Startup-only instead of Scheduled

**Spec says:** Cron job runs daily at 2 AM

**Implementation:** Cleanup runs only on server startup

**Impact:** Long-running servers won't clean temp files until restart. Acceptable for Claude Desktop usage pattern (frequent restarts).

**Files:** [src/index.ts](src/index.ts), [src/services/cleanup.ts](src/services/cleanup.ts)

---

### 3. File Index Not Implemented

**Spec says:** `.fileops/index.json` for fast file search

**Implementation:** Search scans files directly without index

**Impact:** Slower search on large workspaces. Current implementation caps at 100 results.

**Files:** [src/tools/search-files.ts](src/tools/search-files.ts)

---

## Missing Integrations

### 4. Guardian MCP Integration

**Spec says:** All inputs should be security-scanned via Guardian MCP

**Implementation:** Not integrated - relies on local path validation only

**Impact:** No prompt injection or malicious content scanning

**To implement:** Add Guardian MCP client call before file operations

---

### 5. Memory MCP Integration

**Spec says:** Should integrate with Memory MCP for context

**Implementation:** Not integrated - standalone operation

**Impact:** No persistent memory of user preferences or file patterns

---

## Implementation Gaps

### 6. No Test Coverage

**Status:** Zero test files

**Impact:** No automated verification of security boundaries, grant logic, or tool behavior

**Priority:** High - security-critical code needs tests

---

### 7. Audit Log Rotation

**Spec says:** 100MB max audit log

**Implementation:** Log grows indefinitely

**Impact:** Disk space consumption over time

**To implement:** Add size check and rotation in [src/logging/audit.ts](src/logging/audit.ts)

---

### 8. Write File Size Limit

**Spec says:** 50MB file size limit

**Implementation:** Only enforced on read operations, not write

**Impact:** Could create oversized files

**Files:** [src/tools/create-file.ts](src/tools/create-file.ts), [src/tools/update-file.ts](src/tools/update-file.ts)

---

### 9. YAML Config Parsing

**Implementation:** Uses regex-based parsing instead of proper YAML parser

**Impact:** May fail on complex YAML structures

**Files:** [src/utils/config.ts](src/utils/config.ts)

---

## Future Enhancements

- [ ] Migrate to SQLite for grants
- [ ] Add scheduled cleanup (node-cron or similar)
- [ ] Build file index for faster search
- [ ] Integrate Guardian MCP for security scanning
- [ ] Integrate Memory MCP for context
- [ ] Add comprehensive test suite
- [ ] Implement log rotation
- [ ] Add write size limits
- [ ] Use proper YAML parser (js-yaml)

---

*Last updated: 2026-02-01*
