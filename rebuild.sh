#!/bin/bash

# Rebuild all packages in the Annabelle MCP monorepo
#
# Shared is built first (dependency of all other packages),
# then all remaining packages are built in parallel.

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
RESET='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$HOME/.annabelle/logs"
mkdir -p "$LOG_DIR"

FAILED=()
SUCCEEDED=()

# ─── Discover packages with a "build" script ─────────────────────────────────
discover_buildable() {
  for dir in "$SCRIPT_DIR"/*/; do
    [ ! -f "$dir/package.json" ] && continue
    # Check if package.json has a "build" script (grep avoids ESM require() issues)
    if grep -q '"build"\s*:' "$dir/package.json" 2>/dev/null; then
      basename "$dir"
    fi
  done
}

build_package() {
  local pkg="$1"
  local pkg_dir="$SCRIPT_DIR/$pkg"
  local log_file="$LOG_DIR/build-${pkg}.log"

  if (cd "$pkg_dir" && npm run build > "$log_file" 2>&1); then
    echo -e "  ${GREEN}✓${RESET} $pkg"
    return 0
  else
    echo -e "  ${RED}✗${RESET} $pkg  ${YELLOW}(see $log_file)${RESET}"
    return 1
  fi
}

echo -e "${BOLD}${CYAN}=== Rebuilding Annabelle MCP Stack ===${RESET}\n"

ALL_PACKAGES=$(discover_buildable)

if [ -z "$ALL_PACKAGES" ]; then
  echo -e "${RED}No buildable packages found!${RESET}"
  exit 1
fi

# ─── Phase 1: Build Shared first ─────────────────────────────────────────────
echo -e "${BOLD}Phase 1: Building Shared (dependency)${RESET}"

if echo "$ALL_PACKAGES" | grep -q "^Shared$"; then
  if build_package "Shared"; then
    SUCCEEDED+=("Shared")
  else
    FAILED+=("Shared")
    echo -e "\n${RED}${BOLD}Shared failed — aborting (other packages depend on it)${RESET}"
    exit 1
  fi
else
  echo -e "  ${YELLOW}Shared not found, skipping${RESET}"
fi

# ─── Phase 2: Build everything else in parallel ──────────────────────────────
REMAINING=$(echo "$ALL_PACKAGES" | grep -v "^Shared$")

if [ -n "$REMAINING" ]; then
  echo -e "\n${BOLD}Phase 2: Building remaining packages in parallel${RESET}"

  PIDS=()
  PKG_NAMES=()

  for pkg in $REMAINING; do
    build_package "$pkg" &
    PIDS+=($!)
    PKG_NAMES+=("$pkg")
  done

  # Wait for each and track results
  for i in "${!PIDS[@]}"; do
    if wait "${PIDS[$i]}"; then
      SUCCEEDED+=("${PKG_NAMES[$i]}")
    else
      FAILED+=("${PKG_NAMES[$i]}")
    fi
  done
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}${CYAN}=== Build Summary ===${RESET}"
echo -e "  ${GREEN}Succeeded: ${#SUCCEEDED[@]}${RESET}  —  ${SUCCEEDED[*]}"

if [ ${#FAILED[@]} -gt 0 ]; then
  echo -e "  ${RED}Failed:    ${#FAILED[@]}${RESET}  —  ${FAILED[*]}"
  echo -e "\n  Build logs: $LOG_DIR/build-*.log"
  exit 1
else
  echo -e "\n${GREEN}${BOLD}All ${#SUCCEEDED[@]} packages built successfully!${RESET}"
fi
