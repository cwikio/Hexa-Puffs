#!/bin/bash

echo "========================================="
echo "1Password MCP Server Diagnostic"
echo "========================================="
echo ""

# Check Docker
echo "[1] Docker Desktop..."
if docker info > /dev/null 2>&1; then
  echo "    ✅ Docker is running"
else
  echo "    ❌ Docker is not running - start Docker Desktop"
  exit 1
fi

# Check MCP container
echo ""
echo "[2] MCP Container..."
CONTAINER=$(docker ps --filter "ancestor=onepassword-mcp" --format "{{.Names}}" | head -1)
if [ -n "$CONTAINER" ]; then
  echo "    ✅ Container running: $CONTAINER"
else
  echo "    ❌ No onepassword-mcp container running"
  echo "    → Start it from Docker Desktop or run:"
  echo "      docker run -d --name op-mcp --env-file /Users/tomasz/Coding/MCPs/OnePassword4Agents/.env -e TRANSPORT=http -p 3000:3000 onepassword-mcp"
  exit 1
fi

# Check MCP health endpoint
echo ""
echo "[3] MCP Health Endpoint..."
HEALTH=$(curl -s http://localhost:3000/health 2>/dev/null)
if echo "$HEALTH" | grep -q "healthy"; then
  echo "    ✅ Health check passed: $HEALTH"
else
  echo "    ❌ Health check failed"
  echo "    → Container might be misconfigured. Check logs:"
  echo "      docker logs $CONTAINER"
  exit 1
fi

# Check LM Studio
echo ""
echo "[4] LM Studio..."
LMSTUDIO=$(curl -s http://localhost:1234/v1/models 2>/dev/null)
if echo "$LMSTUDIO" | grep -q "data"; then
  echo "    ✅ LM Studio is running"
  MODEL=$(echo "$LMSTUDIO" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "    → Loaded model: $MODEL"
else
  echo "    ❌ LM Studio not running or no model loaded"
  echo "    → Open LM Studio and load a model"
  exit 1
fi

# Test MCP tools/list directly
echo ""
echo "[5] Testing MCP Server (tools/list)..."
TOOLS_RESPONSE=$(curl -s -X POST http://localhost:3000/sse \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' 2>/dev/null)

if echo "$TOOLS_RESPONSE" | grep -q "list_vaults"; then
  echo "    ✅ MCP tools available"
else
  echo "    ⚠️  Could not verify MCP tools (SSE transport may need different handling)"
fi

# Test 1Password CLI directly in container
echo ""
echo "[6] Testing 1Password CLI in container..."
VAULTS=$(docker exec "$CONTAINER" op vault list --format=json 2>/dev/null)
if echo "$VAULTS" | grep -q "id"; then
  echo "    ✅ 1Password CLI working"
  echo "    → Available vaults:"
  echo "$VAULTS" | grep -o '"name":"[^"]*"' | cut -d'"' -f4 | while read vault; do
    echo "       - $vault"
  done
else
  ERROR=$(docker exec "$CONTAINER" op vault list 2>&1)
  echo "    ❌ 1Password CLI failed"
  echo "    → Error: $ERROR"
  echo "    → Check your OP_SERVICE_ACCOUNT_TOKEN in .env"
  exit 1
fi

echo ""
echo "========================================="
echo "Summary"
echo "========================================="
echo "✅ All systems operational"
echo ""
echo "The issue is likely LM Studio's MCP client connecting to SSE."
echo "Try using Claude Desktop instead - it has native MCP support."
echo ""
echo "Or test directly with:"
echo "  docker exec $CONTAINER op vault list"
echo "  docker exec $CONTAINER op item list --vault=<vault-name>"
