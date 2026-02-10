#!/usr/bin/env bash
#
# Version bump helper for Annabelle MCP ecosystem.
#
# Usage:
#   ./version.sh system <patch|minor|major>     Bump the root VERSION file
#   ./version.sh <package-dir> <patch|minor|major>  Bump a package's package.json version
#   ./version.sh show                            Show all current versions
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION_FILE="$SCRIPT_DIR/VERSION"

bump_semver() {
  local current="$1" level="$2"
  IFS='.' read -r major minor patch <<< "$current"
  case "$level" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "$major.$((minor + 1)).0" ;;
    patch) echo "$major.$minor.$((patch + 1))" ;;
    *) echo "Unknown level: $level (use patch, minor, or major)" >&2; exit 1 ;;
  esac
}

cmd_show() {
  echo "System: $(cat "$VERSION_FILE")"
  echo ""
  for pkg in "$SCRIPT_DIR"/*/package.json; do
    dir="$(dirname "$pkg")"
    name="$(basename "$dir")"
    ver="$(node -p "require('$pkg').version")"
    printf "  %-20s %s\n" "$name" "$ver"
  done
}

cmd_system() {
  local level="${1:?Usage: ./version.sh system <patch|minor|major>}"
  local current
  current="$(cat "$VERSION_FILE" | tr -d '[:space:]')"
  local next
  next="$(bump_semver "$current" "$level")"
  echo "$next" > "$VERSION_FILE"
  echo "System version: $current -> $next"
}

cmd_package() {
  local pkg_dir="$1" level="$2"
  local pkg_json="$SCRIPT_DIR/$pkg_dir/package.json"
  if [ ! -f "$pkg_json" ]; then
    echo "No package.json found at $pkg_json" >&2
    exit 1
  fi
  local current
  current="$(node -p "require('$pkg_json').version")"
  local next
  next="$(bump_semver "$current" "$level")"
  # Use node to update version in-place (preserves formatting)
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('$pkg_json', 'utf-8'));
    pkg.version = '$next';
    fs.writeFileSync('$pkg_json', JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "$pkg_dir: $current -> $next"
}

case "${1:-}" in
  show)
    cmd_show
    ;;
  system)
    cmd_system "${2:-}"
    ;;
  ""|--help|-h)
    echo "Usage:"
    echo "  ./version.sh show                           Show all versions"
    echo "  ./version.sh system <patch|minor|major>     Bump system version"
    echo "  ./version.sh <package> <patch|minor|major>  Bump package version"
    ;;
  *)
    cmd_package "$1" "${2:?Usage: ./version.sh <package> <patch|minor|major>}"
    ;;
esac
