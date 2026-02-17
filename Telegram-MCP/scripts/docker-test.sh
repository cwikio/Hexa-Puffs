#!/bin/bash
echo "Testing Docker container..."

# Send initialize and get_me request
(
echo '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
sleep 1
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_me","arguments":{}}}'
sleep 30
) | docker run -i --rm --env-file .env telegram-mcp
