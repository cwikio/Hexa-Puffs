#!/bin/bash

# =============================================================================
# MCP Stack - Comprehensive Test Suite
# =============================================================================
#
# Runs all tests across all MCP servers:
# - Filer MCP (file operations)
# - Memorizer MCP (fact/conversation storage)
# - Telegram MCP (messaging)
# - Guardian MCP (security scanning)
# - Orchestrator (coordination layer + workflow tests)
#
# Prerequisites:
#   - All MCP servers should be running (use ./launch-all.sh)
#   - Node.js 18+ installed
#
# Usage:
#   ./test-all.sh           # Run all tests
#   ./test-all.sh --quick   # Run only health checks + quick curl tests
#   ./test-all.sh --vitest  # Run only vitest tests (skip curl tests)
#
# =============================================================================

set -e

# Colors
BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

# Counters
PASSED=0
FAILED=0
SKIPPED=0
CURL_PASSED=0
CURL_FAILED=0

# MCPs directory
MCP_DIR="$(cd "$(dirname "$0")" && pwd)"

# Parse arguments
RUN_CURL=true
RUN_VITEST=true

for arg in "$@"; do
  case $arg in
    --quick)
      RUN_VITEST=false
      ;;
    --vitest)
      RUN_CURL=false
      ;;
  esac
done

# =============================================================================
# Helper Functions
# =============================================================================

print_header() {
  echo -e "\n${BOLD}${BLUE}╔═══════════════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}${BLUE}║  $1${RESET}"
  echo -e "${BOLD}${BLUE}╚═══════════════════════════════════════════════════════════════════╝${RESET}\n"
}

print_section() {
  echo -e "\n${BOLD}${CYAN}━━━ $1 ━━━${RESET}\n"
}

check_health() {
  local name=$1
  local url=$2
  local expected=$3

  echo -n "  Checking $name... "

  RESPONSE=$(curl -s --connect-timeout 5 "$url" 2>/dev/null || echo "CONNECT_FAILED")

  if [ "$RESPONSE" = "CONNECT_FAILED" ]; then
    echo -e "${YELLOW}DOWN (not running)${RESET}"
    return 1
  elif echo "$RESPONSE" | grep -q "$expected"; then
    echo -e "${GREEN}UP${RESET}"
    return 0
  else
    echo -e "${YELLOW}UNHEALTHY${RESET}"
    return 1
  fi
}

run_mcp_tests() {
  local name=$1
  local dir=$2

  if [ ! -d "$dir" ]; then
    echo -e "  ${YELLOW}⚠ $name directory not found - skipping${RESET}"
    ((SKIPPED++))
    return
  fi

  if [ ! -f "$dir/package.json" ]; then
    echo -e "  ${YELLOW}⚠ $name has no package.json - skipping${RESET}"
    ((SKIPPED++))
    return
  fi

  # Check if test script exists
  if ! grep -q '"test"' "$dir/package.json"; then
    echo -e "  ${YELLOW}⚠ $name has no test script - skipping${RESET}"
    ((SKIPPED++))
    return
  fi

  echo -e "  Running ${BOLD}$name${RESET} tests..."

  cd "$dir"

  if npm test 2>&1; then
    echo -e "  ${GREEN}✓ $name tests passed${RESET}"
    ((PASSED++))
  else
    echo -e "  ${RED}✗ $name tests failed${RESET}"
    ((FAILED++))
  fi

  cd "$MCP_DIR"
}

test_curl() {
  local name=$1
  local url=$2
  local data=$3
  local expected=$4

  echo -n "  $name... "

  RESPONSE=$(curl -s -X POST "$url" \
    -H "Content-Type: application/json" \
    -d "$data" 2>/dev/null || echo "FAILED")

  if echo "$RESPONSE" | grep -q "$expected"; then
    echo -e "${GREEN}✓${RESET}"
    ((CURL_PASSED++))
  else
    echo -e "${RED}✗${RESET}"
    ((CURL_FAILED++))
  fi
}

# =============================================================================
# Main Test Suite
# =============================================================================

print_header "MCP Stack - Comprehensive Test Suite"

echo -e "Test mode: ${BOLD}$([ "$RUN_CURL" = true ] && [ "$RUN_VITEST" = true ] && echo "Full" || ([ "$RUN_VITEST" = true ] && echo "Vitest only" || echo "Quick (curl only)"))${RESET}"
echo -e "MCP Directory: ${CYAN}$MCP_DIR${RESET}"

# =============================================================================
# Section 1: Health Checks
# =============================================================================

print_section "Section 1: Health Checks"

# New architecture: Orchestrator (8010) + Thinker (8006)
ORCHESTRATOR_STDIO_UP=false
THINKER_UP=false

echo -e "  ${BOLD}New Architecture (stdio mode):${RESET}"
check_health "Orchestrator (stdio mode)" "http://localhost:8010/health" "ok" && ORCHESTRATOR_STDIO_UP=true
check_health "Thinker" "http://localhost:8006/health" "ok" && THINKER_UP=true

# Legacy architecture: Individual MCPs with HTTP (backwards compatibility)
FILER_UP=false
MEMORIZER_UP=false
TELEGRAM_UP=false
GUARDIAN_UP=false
ORCHESTRATOR_UP=false

echo -e "\n  ${BOLD}Legacy Architecture (individual HTTP MCPs):${RESET}"
check_health "Filer MCP" "http://localhost:8004/health" "healthy" && FILER_UP=true
check_health "Memorizer MCP" "http://localhost:8005/health" "ok" && MEMORIZER_UP=true
check_health "Telegram MCP" "http://localhost:8002/health" "ok" && TELEGRAM_UP=true
check_health "Guardian MCP" "http://localhost:8003/health" "ok" && GUARDIAN_UP=true
check_health "Orchestrator MCP (legacy)" "http://localhost:8000/health" "ok" && ORCHESTRATOR_UP=true

echo ""
if [ "$ORCHESTRATOR_STDIO_UP" = true ]; then
  echo -e "  ${GREEN}✓ New architecture available (Orchestrator stdio mode on 8010)${RESET}"
  if [ "$THINKER_UP" = true ]; then
    echo -e "  ${GREEN}✓ Thinker connected${RESET}"
  fi
fi
echo -e "  Legacy services: ${GREEN}$([ "$FILER_UP" = true ] && echo "Filer ")$([ "$MEMORIZER_UP" = true ] && echo "Memorizer ")$([ "$TELEGRAM_UP" = true ] && echo "Telegram ")$([ "$GUARDIAN_UP" = true ] && echo "Guardian ")$([ "$ORCHESTRATOR_UP" = true ] && echo "Orchestrator ")${RESET}"

# =============================================================================
# Section 2: Quick Curl Tests (if --quick or full mode)
# =============================================================================

if [ "$RUN_CURL" = true ]; then
  print_section "Section 2: Quick Integration Tests (curl)"

  # =====================================================
  # New Architecture: Test via Orchestrator (stdio mode)
  # =====================================================
  if [ "$ORCHESTRATOR_STDIO_UP" = true ]; then
    echo -e "\n  ${BOLD}Orchestrator (stdio mode - routes to all MCPs):${RESET}"
    test_curl "Get status" "http://localhost:8010/tools/call" \
      '{"name": "get_status", "arguments": {}}' "ready"
    test_curl "List tools" "http://localhost:8010/tools/list" \
      '{}' "name"
    test_curl "List chats (via Telegram)" "http://localhost:8010/tools/call" \
      '{"name": "list_chats", "arguments": {"limit": 5}}' "content"
    test_curl "Get memory stats (via Memory)" "http://localhost:8010/tools/call" \
      '{"name": "get_memory_stats", "arguments": {}}' "content"
    test_curl "Get workspace info (via Filer)" "http://localhost:8010/tools/call" \
      '{"name": "get_workspace_info", "arguments": {}}' "content"
  fi

  # Thinker tests (if running)
  if [ "$THINKER_UP" = true ]; then
    echo -e "\n  ${BOLD}Thinker:${RESET}"
    # Thinker doesn't expose tools, just health
    THINKER_RESP=$(curl -s http://localhost:8006/health 2>/dev/null)
    if echo "$THINKER_RESP" | grep -q "llmProvider"; then
      echo -e "  Thinker config... ${GREEN}✓${RESET}"
      ((CURL_PASSED++))
    else
      echo -e "  Thinker config... ${RED}✗${RESET}"
      ((CURL_FAILED++))
    fi
  fi

  # =====================================================
  # Legacy Architecture: Direct MCP tests
  # =====================================================
  # Filer tests
  if [ "$FILER_UP" = true ]; then
    echo -e "\n  ${BOLD}Filer MCP (legacy):${RESET}"
    test_curl "List files" "http://localhost:8004/tools/call" \
      '{"name": "list_files", "arguments": {}}' "success"
    test_curl "Get workspace info" "http://localhost:8004/tools/call" \
      '{"name": "get_workspace_info", "arguments": {}}' "workspace_path"
  fi

  # Memorizer tests
  if [ "$MEMORIZER_UP" = true ]; then
    echo -e "\n  ${BOLD}Memorizer MCP (legacy):${RESET}"
    test_curl "Get memory stats" "http://localhost:8005/tools/call" \
      '{"name": "get_memory_stats", "arguments": {}}' "fact_count"
    test_curl "List facts" "http://localhost:8005/tools/call" \
      '{"name": "list_facts", "arguments": {}}' "success"
  fi

  # Telegram tests
  if [ "$TELEGRAM_UP" = true ]; then
    echo -e "\n  ${BOLD}Telegram MCP (legacy):${RESET}"
    test_curl "List chats" "http://localhost:8002/tools/call" \
      '{"name": "list_chats", "arguments": {"limit": 5}}' "chats"
  fi

  # Guardian tests
  if [ "$GUARDIAN_UP" = true ]; then
    echo -e "\n  ${BOLD}Guardian MCP (legacy):${RESET}"
    test_curl "Scan clean content" "http://localhost:8003/tools/call" \
      '{"name": "scan_content", "arguments": {"content": "Hello world"}}' "allowed"
  fi

  echo -e "\n  Curl tests: ${GREEN}$CURL_PASSED passed${RESET}, ${RED}$CURL_FAILED failed${RESET}"
fi

# =============================================================================
# Section 3: Vitest Tests (if --vitest or full mode)
# =============================================================================

if [ "$RUN_VITEST" = true ]; then
  print_section "Section 3: Vitest Integration Tests"

  echo -e "Running vitest for each MCP with tests...\n"

  # Run tests for each MCP (legacy architecture)
  run_mcp_tests "Filer" "$MCP_DIR/Filer"
  run_mcp_tests "Memorizer" "$MCP_DIR/Memorizer"
  run_mcp_tests "Telegram" "$MCP_DIR/Telegram"
  run_mcp_tests "Guardian" "$MCP_DIR/Guardian"

  # Orchestrator tests (Level 2 + Level 3 workflows + stdio mode)
  print_section "Section 4: Orchestrator Tests"
  run_mcp_tests "Orchestrator" "$MCP_DIR/Orchestrator"

  # Thinker tests (if available)
  print_section "Section 5: Thinker Tests"
  run_mcp_tests "Thinker" "$MCP_DIR/Thinker"
fi

# =============================================================================
# Summary
# =============================================================================

print_header "Test Summary"

TOTAL=$((PASSED + FAILED + SKIPPED))

echo -e "  ${BOLD}Vitest Suites:${RESET}"
echo -e "    ${GREEN}Passed:${RESET}  $PASSED"
echo -e "    ${RED}Failed:${RESET}  $FAILED"
echo -e "    ${YELLOW}Skipped:${RESET} $SKIPPED"
echo ""

if [ "$RUN_CURL" = true ]; then
  echo -e "  ${BOLD}Curl Tests:${RESET}"
  echo -e "    ${GREEN}Passed:${RESET}  $CURL_PASSED"
  echo -e "    ${RED}Failed:${RESET}  $CURL_FAILED"
  echo ""
fi

if [ $FAILED -eq 0 ] && [ ${CURL_FAILED:-0} -eq 0 ]; then
  echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════════════${RESET}"
  echo -e "${BOLD}${GREEN}  ✓ ALL TESTS PASSED${RESET}"
  echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════════════${RESET}"
  exit 0
else
  echo -e "${BOLD}${RED}═══════════════════════════════════════════════════════════════════${RESET}"
  echo -e "${BOLD}${RED}  ✗ SOME TESTS FAILED${RESET}"
  echo -e "${BOLD}${RED}═══════════════════════════════════════════════════════════════════${RESET}"
  exit 1
fi
