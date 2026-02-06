#!/bin/bash
set -e

# Guardian Model Setup Script
# Downloads the Granite Guardian model and loads it into Ollama

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MODELS_DIR="$PROJECT_DIR/models"

MODEL_FILE="granite-guardian-3.3-8b.i1-Q4_K_M.gguf"
MODEL_URL="https://huggingface.co/mradermacher/granite-guardian-3.3-8b-i1-GGUF/resolve/main/$MODEL_FILE"

echo "=== Guardian Model Setup ==="
echo ""

# Check if Ollama is installed
if ! command -v ollama &> /dev/null; then
    echo "Error: Ollama is not installed."
    echo "Install it from: https://ollama.ai"
    exit 1
fi

# Check if model file exists
if [ -f "$MODELS_DIR/$MODEL_FILE" ]; then
    echo "Model file already exists: $MODEL_FILE"
else
    echo "Downloading $MODEL_FILE (~5GB)..."
    echo "This may take a while..."
    echo ""

    cd "$MODELS_DIR"
    curl -L -o "$MODEL_FILE" "$MODEL_URL" --progress-bar

    echo ""
    echo "Download complete!"
fi

# Create model in Ollama
echo ""
echo "Loading model into Ollama..."
cd "$MODELS_DIR"
ollama create guardian -f Modelfile

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Test with: ollama run guardian \"Test message\""
echo ""
