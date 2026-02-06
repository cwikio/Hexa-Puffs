#!/bin/bash
# For Claude Desktop integration
# Assumes Ollama is already running with guardian model

set -a
[ -f .env ] && source .env
set +a

exec node dist/index.js
