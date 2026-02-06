#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCPS_DIR="$(dirname "$SCRIPT_DIR")"

exec "$MCPS_DIR/start-all.sh"
