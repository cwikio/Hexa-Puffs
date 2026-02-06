#!/bin/bash
set -e

# Guardian MCP Server - Single Command Startup
# Ensures Ollama is running, model is loaded, and starts the MCP server

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Starting Guardian MCP Server ==="
echo ""

# 1. Check if Ollama is installed
if ! command -v ollama &> /dev/null; then
    echo "Error: Ollama is not installed."
    echo "Install it from: https://ollama.ai"
    exit 1
fi

# 2. Check/start Ollama
if ! pgrep -x "ollama" > /dev/null && ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "Starting Ollama..."
    ollama serve > /dev/null 2>&1 &
    sleep 3

    # Wait for Ollama to be ready
    for i in {1..10}; do
        if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
            break
        fi
        echo "Waiting for Ollama to start..."
        sleep 1
    done
fi

# 3. Check if model exists
if ! ollama list 2>/dev/null | grep -q "guardian"; then
    echo "Guardian model not found."

    # Check if GGUF file exists
    if [ -f "models/granite-guardian-3.3-8b.i1-Q4_K_M.gguf" ]; then
        echo "Loading model from Modelfile..."
        cd models && ollama create guardian -f Modelfile && cd ..
    else
        echo ""
        echo "Model file not found. Please run:"
        echo "  ./scripts/setup-model.sh"
        echo ""
        exit 1
    fi
fi

echo "Ollama: running"
echo "Model: guardian"
echo ""

# 4. Build if needed
if [ ! -d "dist" ] || [ "src/index.ts" -nt "dist/index.js" ]; then
    echo "Building TypeScript..."
    npm run build
fi

# 5. Start MCP server
echo "Starting Guardian MCP server..."
echo ""
npm start
