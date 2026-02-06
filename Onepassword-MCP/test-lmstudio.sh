#!/bin/bash

curl -X POST http://localhost:1234/api/v1/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "zai-org/glm-4.6v-flash",
    "input": "List my vaults",
    "integrations": [
      {
        "type": "ephemeral_mcp",
        "server_label": "1password",
        "server_url": "http://localhost:3000/sse"
      }
    ],
    "context_length": 8000
  }'
