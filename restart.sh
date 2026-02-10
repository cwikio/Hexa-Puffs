#!/bin/bash

# Restart the entire Annabelle MCP Stack
#
# 1. Kill all Annabelle processes (PID file + port cleanup)
# 2. Rebuild all packages
# 3. Start everything fresh

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
RESET='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$HOME/.annabelle/annabelle.pids"

echo -e "${BOLD}${CYAN}=== Restarting Annabelle MCP Stack ===${RESET}\n"

# ─── Step 1: Kill all Annabelle processes ─────────────────────────────────────
echo -e "${BOLD}Step 1: Killing Annabelle processes${RESET}"
KILLED=0

# 1a. Kill saved PIDs from last run (graceful SIGTERM)
if [ -f "$PID_FILE" ]; then
  while read -r pid; do
    [ -z "$pid" ] && continue
    if kill "$pid" 2>/dev/null; then
      ((KILLED++))
    fi
  done < "$PID_FILE"
  rm -f "$PID_FILE"
fi

# 1b. Wait for graceful shutdown
[ $KILLED -gt 0 ] && sleep 2

# 1c. Force-kill by known infrastructure ports (catches orphans and children)
for port in 8010 8006 3000 8288 8289; do
  lsof -ti:$port | xargs kill -9 2>/dev/null
done

# 1d. Force-kill discovered HTTP MCP ports
DISCOVERY=$(MCPS_ROOT="$SCRIPT_DIR" node "$SCRIPT_DIR/Shared/dist/Discovery/cli.js" 2>/dev/null)
if [ -n "$DISCOVERY" ]; then
  while IFS='|' read -r name transport port dir sensitive; do
    if [ "$transport" = "http" ] && [ -n "$port" ]; then
      lsof -ti:$port | xargs kill -9 2>/dev/null
    fi
  done <<< "$DISCOVERY"
fi

sleep 1
echo -e "  ${GREEN}✓${RESET} All Annabelle processes stopped"

# ─── Step 2: Rebuild all packages ────────────────────────────────────────────
echo -e "\n${BOLD}Step 2: Rebuilding all packages${RESET}"
if ! "$SCRIPT_DIR/rebuild.sh"; then
  echo -e "\n${RED}${BOLD}Rebuild failed — aborting restart${RESET}"
  exit 1
fi

# ─── Step 3: Start everything ────────────────────────────────────────────────
echo -e "\n${BOLD}Step 3: Starting all services${RESET}"
exec "$SCRIPT_DIR/start-all.sh"
