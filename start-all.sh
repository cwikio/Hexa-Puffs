#!/bin/bash

# Launch script for Annabelle MCP Stack
#
# Architecture:
#   Telegram MCP (HTTP on 8002) <-- Direct connection from Thinker
#   Searcher MCP (HTTP on 8007) <-- Independent service
#   Gmail MCP    (HTTP on 8008) <-- Independent service (email + polling)
#   Orchestrator (HTTP on 8010) <--(stdio)--> Memory, Filer, Guardian, 1Password
#                               <--(http)--> Searcher (8007), Gmail (8008)
#                               <--(spawn)--> Thinker agent(s) from agents.json
#
# Orchestrator spawns Thinker agent(s) via AgentManager (multi-agent mode).
# Cost controls are enabled by default in agents.json.
# Telegram MCP runs separately in HTTP mode for direct Thinker connection.
# Orchestrator spawns other MCPs via stdio.

BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

echo -e "${BOLD}${BLUE}=== Launching Annabelle MCP Stack ===${RESET}\n"

# Kill any existing instances
echo -e "${YELLOW}Cleaning up existing processes...${RESET}"
# Kill by port to ensure all instances are stopped
lsof -ti:8010 | xargs kill -9 2>/dev/null  # Orchestrator HTTP
lsof -ti:8006 | xargs kill -9 2>/dev/null  # Thinker
lsof -ti:3000 | xargs kill -9 2>/dev/null  # Orchestrator's Inngest HTTP server
lsof -ti:8288 | xargs kill -9 2>/dev/null  # Inngest Dev Server
lsof -ti:8289 | xargs kill -9 2>/dev/null  # Orchestrator standalone Inngest (from npm run dev:full)
# Legacy ports (in case old processes are running)
lsof -ti:8000 | xargs kill -9 2>/dev/null
lsof -ti:8002 | xargs kill -9 2>/dev/null
lsof -ti:8004 | xargs kill -9 2>/dev/null
lsof -ti:8005 | xargs kill -9 2>/dev/null
lsof -ti:8007 | xargs kill -9 2>/dev/null  # Searcher
lsof -ti:8008 | xargs kill -9 2>/dev/null  # Gmail
sleep 2

# Create log directory
mkdir -p ~/.annabelle/logs

# Start Inngest Dev Server
echo -e "${BOLD}Starting Inngest Dev Server (port 8288)...${RESET}"
cd "/Users/tomasz/Coding/AI Assistants/MCPs/Orchestrator"
npx inngest-cli@latest dev --no-discovery > ~/.annabelle/logs/inngest.log 2>&1 &
INNGEST_PID=$!
echo -e "${GREEN}✓ Inngest Dev Server started (PID: $INNGEST_PID)${RESET}"

# Wait for Inngest to be ready
sleep 3

# Check Inngest health
INNGEST_HEALTH=$(curl -s http://localhost:8288 2>/dev/null)
if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Inngest Dev Server is healthy${RESET}"
  echo -e "  ${BLUE}Dashboard: http://localhost:8288${RESET}"
else
  echo -e "${YELLOW}⚠ Inngest Dev Server not responding (may still be starting)${RESET}"
fi

# Start Telegram MCP in HTTP mode (for direct Thinker connection)
echo -e "\n${BOLD}Starting Telegram MCP (HTTP on port 8002)...${RESET}"
cd "/Users/tomasz/Coding/AI Assistants/MCPs/Telegram-MCP"
TRANSPORT=http PORT=8002 npm start > ~/.annabelle/logs/telegram.log 2>&1 &
TELEGRAM_PID=$!
echo -e "${GREEN}✓ Telegram MCP started (PID: $TELEGRAM_PID)${RESET}"

# Wait for Telegram MCP to initialize
sleep 5

# Check Telegram MCP health
TELEGRAM_HEALTH=$(curl -s http://localhost:8002/health 2>/dev/null)
if echo "$TELEGRAM_HEALTH" | grep -q "ok"; then
  echo -e "${GREEN}✓ Telegram MCP is healthy${RESET}"
else
  echo -e "${YELLOW}⚠ Telegram MCP not responding (may still be starting)${RESET}"
  echo -e "  ${YELLOW}Check logs: tail -f ~/.annabelle/logs/telegram.log${RESET}"
fi

# Start Searcher MCP in HTTP mode
echo -e "\n${BOLD}Starting Searcher MCP (HTTP on port 8007)...${RESET}"
cd "/Users/tomasz/Coding/AI Assistants/MCPs/Searcher-MCP"
TRANSPORT=http PORT=8007 npm start > ~/.annabelle/logs/searcher.log 2>&1 &
SEARCHER_PID=$!
echo -e "${GREEN}✓ Searcher MCP started (PID: $SEARCHER_PID)${RESET}"

# Wait for Searcher MCP to initialize
sleep 3

# Check Searcher MCP health
SEARCHER_HEALTH=$(curl -s http://localhost:8007/health 2>/dev/null)
if echo "$SEARCHER_HEALTH" | grep -q "ok"; then
  echo -e "${GREEN}✓ Searcher MCP is healthy${RESET}"
else
  echo -e "${YELLOW}⚠ Searcher MCP not responding (may still be starting)${RESET}"
  echo -e "  ${YELLOW}Check logs: tail -f ~/.annabelle/logs/searcher.log${RESET}"
fi

# Start Gmail MCP in HTTP mode
echo -e "\n${BOLD}Starting Gmail MCP (HTTP on port 8008)...${RESET}"
cd "/Users/tomasz/Coding/AI Assistants/MCPs/Gmail-MCP"
TRANSPORT=http PORT=8008 npm start > ~/.annabelle/logs/gmail.log 2>&1 &
GMAIL_PID=$!
echo -e "${GREEN}✓ Gmail MCP started (PID: $GMAIL_PID)${RESET}"

# Wait for Gmail MCP to initialize
sleep 3

# Check Gmail MCP health
GMAIL_HEALTH=$(curl -s http://localhost:8008/health 2>/dev/null)
if echo "$GMAIL_HEALTH" | grep -q "ok"; then
  echo -e "${GREEN}✓ Gmail MCP is healthy${RESET}"
else
  echo -e "${YELLOW}⚠ Gmail MCP not responding (may still be starting)${RESET}"
  echo -e "  ${YELLOW}Check logs: tail -f ~/.annabelle/logs/gmail.log${RESET}"
fi

# Ensure Ollama is running with Guardian model (required for Guardian MCP spawned by Orchestrator)
echo -e "\n${BOLD}Checking Ollama + Guardian model...${RESET}"
if ! command -v ollama &> /dev/null; then
  echo -e "${YELLOW}⚠ Ollama not installed — Guardian scanning will be unavailable${RESET}"
elif ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
  echo -e "${BLUE}Starting Ollama...${RESET}"
  ollama serve > ~/.annabelle/logs/ollama.log 2>&1 &
  OLLAMA_PID=$!
  for i in {1..10}; do
    if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Ollama started (PID: $OLLAMA_PID)${RESET}"
  else
    echo -e "${YELLOW}⚠ Ollama failed to start — Guardian scanning will be unavailable${RESET}"
  fi
else
  echo -e "${GREEN}✓ Ollama already running${RESET}"
fi

# Check if Guardian model is loaded
if command -v ollama &> /dev/null && curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
  if ollama list 2>/dev/null | grep -q "guardian"; then
    echo -e "${GREEN}✓ Guardian model loaded${RESET}"
  else
    GUARDIAN_GGUF="/Users/tomasz/Coding/AI Assistants/MCPs/Guardian/models/granite-guardian-3.3-8b.i1-Q4_K_M.gguf"
    if [ -f "$GUARDIAN_GGUF" ]; then
      echo -e "${BLUE}Loading Guardian model into Ollama...${RESET}"
      cd "/Users/tomasz/Coding/AI Assistants/MCPs/Guardian/models" && ollama create guardian -f Modelfile > /dev/null 2>&1
      if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Guardian model loaded${RESET}"
      else
        echo -e "${YELLOW}⚠ Failed to load Guardian model${RESET}"
      fi
    else
      echo -e "${YELLOW}⚠ Guardian model GGUF not found — run Guardian/scripts/setup-model.sh first${RESET}"
    fi
  fi
fi

# Start Orchestrator MCP (HTTP mode with stdio connections to downstream MCPs)
# Orchestrator spawns Thinker agent(s) via AgentManager using agents.json config
AGENTS_JSON="/Users/tomasz/Coding/AI Assistants/MCPs/agents.json"
echo -e "\n${BOLD}Starting Orchestrator MCP (HTTP on port 8010)...${RESET}"
echo -e "  ${BLUE}Orchestrator will spawn downstream MCPs (Memory, Filer, Guardian, 1Password) via stdio${RESET}"
echo -e "  ${BLUE}Orchestrator connects to Searcher MCP (8007) and Gmail MCP (8008) via HTTP${RESET}"
echo -e "  ${BLUE}Orchestrator spawns Thinker agent(s) from ${AGENTS_JSON}${RESET}"
cd "/Users/tomasz/Coding/AI Assistants/MCPs/Orchestrator"
TRANSPORT=http PORT=8010 MCP_CONNECTION_MODE=stdio \
  AGENTS_CONFIG_PATH="$AGENTS_JSON" \
  ORCHESTRATOR_URL=http://localhost:8010 \
  TELEGRAM_DIRECT_URL=http://localhost:8002 \
  npm start > ~/.annabelle/logs/orchestrator.log 2>&1 &
ORCHESTRATOR_PID=$!
echo -e "${GREEN}✓ Orchestrator started (PID: $ORCHESTRATOR_PID)${RESET}"

# Wait for Orchestrator, downstream MCPs, and Thinker agent(s) to initialize
echo -e "\n${YELLOW}Waiting for Orchestrator, downstream MCPs, and Thinker agent(s) to initialize...${RESET}"
sleep 10

# Check Orchestrator health
ORCHESTRATOR_HEALTH=$(curl -s http://localhost:8010/health 2>/dev/null)
if echo "$ORCHESTRATOR_HEALTH" | grep -q "ok"; then
  echo -e "${GREEN}✓ Orchestrator is healthy${RESET}"

  # Check tool count
  TOOLS_RESPONSE=$(curl -s http://localhost:8010/tools/list 2>/dev/null)
  TOOL_COUNT=$(echo "$TOOLS_RESPONSE" | grep -o '"name"' | wc -l | tr -d ' ')
  echo -e "  ${BLUE}Discovered $TOOL_COUNT tools from downstream MCPs${RESET}"
else
  echo -e "${RED}✗ Orchestrator health check failed${RESET}"
  echo -e "  ${YELLOW}Check logs: tail -f ~/.annabelle/logs/orchestrator.log${RESET}"
fi

# Register app with Inngest Dev Server
echo -e "\n${BOLD}Registering app with Inngest...${RESET}"
REGISTER_RESULT=$(curl -s http://localhost:8288/v0/gql -X POST -H "Content-Type: application/json" -d '{"query":"mutation { createApp(input: { url: \"http://localhost:3000/api/inngest\" }) { name functionCount } }"}' 2>/dev/null)
if echo "$REGISTER_RESULT" | grep -q "functionCount"; then
  FUNC_COUNT=$(echo "$REGISTER_RESULT" | grep -o '"functionCount":[0-9]*' | grep -o '[0-9]*')
  echo -e "${GREEN}✓ App registered with Inngest ($FUNC_COUNT functions)${RESET}"
else
  echo -e "${YELLOW}⚠ Auto-registration failed - sync manually at http://localhost:8288${RESET}"
fi

# Check Thinker agent (spawned by Orchestrator's AgentManager from agents.json)
echo -e "\n${BOLD}Checking Thinker agent (spawned by Orchestrator)...${RESET}"
THINKER_HEALTH=$(curl -s http://localhost:8006/health 2>/dev/null)
if echo "$THINKER_HEALTH" | grep -q "ok"; then
  echo -e "${GREEN}✓ Thinker agent is healthy${RESET}"
  LLM_PROVIDER=$(echo "$THINKER_HEALTH" | grep -o '"llmProvider":"[^"]*"' | cut -d'"' -f4)
  echo -e "  ${BLUE}LLM Provider: $LLM_PROVIDER${RESET}"
  # Check cost controls
  COST_STATUS=$(curl -s http://localhost:8006/cost-status 2>/dev/null)
  if echo "$COST_STATUS" | grep -q '"enabled":true'; then
    echo -e "  ${BLUE}Cost controls: enabled${RESET}"
  else
    echo -e "  ${YELLOW}Cost controls: disabled${RESET}"
  fi
else
  echo -e "${YELLOW}⚠ Thinker agent not responding (may still be starting)${RESET}"
  echo -e "  ${YELLOW}Check logs: tail -f ~/.annabelle/logs/orchestrator.log${RESET}"
fi

echo -e "\n${BOLD}${GREEN}=== All services launched ===${RESET}"
echo -e "\n${BOLD}Architecture:${RESET}"
echo -e "  Telegram MCP (8002) - Direct HTTP for Thinker"
echo -e "  Searcher MCP (8007) - Independent HTTP service"
echo -e "  Gmail MCP    (8008) - Independent HTTP service (email + polling)"
echo -e "  Orchestrator (8010) spawns via stdio:"
echo -e "    └── Memory MCP (Memorizer)"
echo -e "    └── Filer MCP"
echo -e "    └── Guardian MCP (scanning disabled by default — edit guardian-config.ts to enable)"
echo -e "    └── 1Password MCP"
echo -e "  Orchestrator (8010) spawns Thinker agent(s) from agents.json:"
echo -e "    └── Thinker :8006 (annabelle) — cost controls enabled"
echo -e "  Orchestrator (8010) connects via HTTP:"
echo -e "    └── Searcher MCP (8007)"
echo -e "    └── Gmail MCP (8008)"

echo -e "\n${BOLD}Service URLs:${RESET}"
echo -e "  Telegram:     http://localhost:8002"
echo -e "  Searcher:     http://localhost:8007"
echo -e "  Gmail:        http://localhost:8008"
echo -e "  Orchestrator: http://localhost:8010"
echo -e "  Thinker:      http://localhost:8006"
echo -e "  Inngest:      http://localhost:8288"

echo -e "\n${BOLD}Log files:${RESET}"
echo -e "  Telegram:     ~/.annabelle/logs/telegram.log"
echo -e "  Searcher:     ~/.annabelle/logs/searcher.log"
echo -e "  Gmail:        ~/.annabelle/logs/gmail.log"
echo -e "  Orchestrator: ~/.annabelle/logs/orchestrator.log"
echo -e "  Thinker:      ~/.annabelle/logs/thinker.log"
echo -e "  Inngest:      ~/.annabelle/logs/inngest.log"

echo -e "\n${BOLD}Process IDs:${RESET}"
echo -e "  Telegram:     $TELEGRAM_PID"
echo -e "  Searcher:     $SEARCHER_PID"
echo -e "  Gmail:        $GMAIL_PID"
echo -e "  Orchestrator: $ORCHESTRATOR_PID (Thinker agent(s) are child processes)"
echo -e "  Inngest:      $INNGEST_PID"

echo -e "\n${YELLOW}Tip: Use 'tail -f ~/.annabelle/logs/*.log' to monitor all services${RESET}"
echo -e "${YELLOW}Tip: Use 'pkill -f \"node dist\"' to stop all services${RESET}\n"
