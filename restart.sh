#!/bin/bash

# Restart the entire Annabelle MCP Stack
#
# 1. Kill all running node processes
# 2. Rebuild all packages
# 3. Start everything fresh

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo -e "${BOLD}${CYAN}=== Restarting Annabelle MCP Stack ===${RESET}\n"

# ─── Step 1: Kill all running node processes ─────────────────────────────────
echo -e "${BOLD}Step 1: Killing running processes${RESET}"
pkill -f "node dist" 2>/dev/null && \
  echo -e "  ${GREEN}✓${RESET} Killed node processes" || \
  echo -e "  ${GREEN}✓${RESET} No running processes found"
sleep 1

# ─── Step 2: Rebuild all packages ────────────────────────────────────────────
echo -e "\n${BOLD}Step 2: Rebuilding all packages${RESET}"
if ! "$SCRIPT_DIR/rebuild.sh"; then
  echo -e "\n${RED}${BOLD}Rebuild failed — aborting restart${RESET}"
  exit 1
fi

# ─── Step 3: Start everything ────────────────────────────────────────────────
echo -e "\n${BOLD}Step 3: Starting all services${RESET}"
exec "$SCRIPT_DIR/start-all.sh"
