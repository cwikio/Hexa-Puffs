#!/bin/bash

# Test All MCPs
# Runs tests for all MCP projects in the MCPs folder

set -e  # Exit on first error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCPS_DIR="$(dirname "$SCRIPT_DIR")"

echo "============================================"
echo "Running All MCP Tests"
echo "============================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

run_tests() {
    local project_name=$1
    local project_dir=$2

    if [ -d "$project_dir" ] && [ -f "$project_dir/package.json" ]; then
        echo -e "${YELLOW}━━━ Testing $project_name ━━━${NC}"
        cd "$project_dir"

        if npm test; then
            echo -e "${GREEN}✓ $project_name tests passed${NC}"
            echo ""
            return 0
        else
            echo -e "${RED}✗ $project_name tests failed${NC}"
            echo ""
            return 1
        fi
    else
        echo -e "${YELLOW}⚠ Skipping $project_name (not found or no package.json)${NC}"
        echo ""
        return 0
    fi
}

# Track failures
FAILURES=0

# Run Searcher tests
run_tests "Searcher" "$MCPS_DIR/Searcher" || ((FAILURES++))

# Run Orchestrator tests
run_tests "Orchestrator" "$MCPS_DIR/Orchestrator" || ((FAILURES++))

# Summary
echo "============================================"
if [ $FAILURES -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}$FAILURES project(s) had test failures${NC}"
    exit 1
fi
