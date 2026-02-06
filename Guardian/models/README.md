# Guardian Model Setup

This folder contains the model configuration for the Guardian MCP server.

## Default Model

The default model is **Granite Guardian 3.3-8B** (Q4_K_M quantization), designed specifically for detecting prompt injections and harmful content.

## Setup Instructions

### 1. Download the Model

```bash
# Run the setup script (downloads ~5GB)
./scripts/setup-model.sh
```

Or manually download from HuggingFace:
```bash
cd models
curl -L -o granite-guardian-3.3-8b.i1-Q4_K_M.gguf \
  "https://huggingface.co/mradermacher/granite-guardian-3.3-8b-i1-GGUF/resolve/main/granite-guardian-3.3-8b.i1-Q4_K_M.gguf"
```

### 2. Load the Model into Ollama

```bash
ollama create guardian -f models/Modelfile
```

### 3. Verify

```bash
ollama run guardian "Hello, how are you?"
```

## Swapping to a Different Model

1. Download your new GGUF file to this `models/` folder

2. Edit `Modelfile` and change the `FROM` line:
   ```
   FROM ./your-new-model.gguf
   ```

3. Recreate the model in Ollama:
   ```bash
   ollama create guardian -f models/Modelfile
   ```

## Alternative Models

Other models that work well for prompt injection detection:

| Model | Size | Notes |
|-------|------|-------|
| granite-guardian-3.3-8b | ~5GB | Default, IBM's purpose-built guardian |
| llama-guard-3-8b | ~5GB | Meta's safety classifier |
| granite-guardian-3.3-2b | ~1.5GB | Smaller, faster, less accurate |

## Troubleshooting

**Model not found:**
```bash
ollama list  # Check if 'guardian' is listed
ollama create guardian -f models/Modelfile  # Recreate it
```

**Slow inference:**
- Ensure Ollama is using GPU: `ollama ps` should show Metal/CUDA
- Try a smaller quantization (Q3_K_M) or smaller model (2B)
