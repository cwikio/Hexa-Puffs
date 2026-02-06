#!/bin/bash

# Launch script for Telegram, Guardian, and OnePassword MCPs
# Currently only Telegram is active (Guardian and OnePassword are commented out)

BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

echo -e "${BOLD}${BLUE}=== Launching Additional MCP Services ===${RESET}\n"

# Kill any existing instances
echo -e "${YELLOW}Cleaning up existing processes...${RESET}"
# Kill by port to ensure all instances are stopped
lsof -ti:8001 | xargs kill -9 2>/dev/null  # Telegram
lsof -ti:8002 | xargs kill -9 2>/dev/null  # Guardian
lsof -ti:8000 | xargs kill -9 2>/dev/null  # OnePassword
sleep 2

# Create log directory
mkdir -p ~/.annabelle/logs

# Start Telegram MCP
echo -e "${BOLD}Starting Telegram MCP (port 8001)...${RESET}"
cd "/Users/tomasz/Coding/AI Assistants/MCPs/Telegram"
# Source the .env file and start with HTTP transport on port 8001
(set -a; source .env; set +a; TRANSPORT=http PORT=8001 npm start) > ~/.annabelle/logs/telegram.log 2>&1 &
TELEGRAM_PID=$!
echo -e "${GREEN}✓ Telegram started (PID: $TELEGRAM_PID)${RESET}"

# Start Guardian MCP (commented out for now)
# echo -e "${BOLD}Starting Guardian MCP (port 8002)...${RESET}"
# cd "/Users/tomasz/Coding/AI Assistants/MCPs/Guardian"
# TRANSPORT=http PORT=8002 npm start > ~/.annabelle/logs/guardian.log 2>&1 &
# GUARDIAN_PID=$!
# echo -e "${GREEN}✓ Guardian started (PID: $GUARDIAN_PID)${RESET}"

# Start OnePassword MCP (commented out for now)
# echo -e "${BOLD}Starting OnePassword MCP (port 8000)...${RESET}"
# cd "/Users/tomasz/Coding/AI Assistants/MCPs/Onepassword"
# TRANSPORT=http PORT=8000 npm start > ~/.annabelle/logs/onepassword.log 2>&1 &
# ONEPASSWORD_PID=$!
# echo -e "${GREEN}✓ OnePassword started (PID: $ONEPASSWORD_PID)${RESET}"

# Wait for services to be ready
echo -e "\n${YELLOW}Waiting for services to start...${RESET}"
sleep 5

# Check health of services
echo -e "\n${BOLD}Checking service health:${RESET}"

TELEGRAM_HEALTH=$(curl -s http://localhost:8001/health)
if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Telegram is healthy: $TELEGRAM_HEALTH${RESET}"
else
  echo -e "${RED}✗ Telegram health check failed${RESET}"
fi

# GUARDIAN_HEALTH=$(curl -s http://localhost:8002/health)
# if [ $? -eq 0 ]; then
#   echo -e "${GREEN}✓ Guardian is healthy: $GUARDIAN_HEALTH${RESET}"
# else
#   echo -e "${RED}✗ Guardian health check failed${RESET}"
# fi

# ONEPASSWORD_HEALTH=$(curl -s http://localhost:8000/health)
# if [ $? -eq 0 ]; then
#   echo -e "${GREEN}✓ OnePassword is healthy: $ONEPASSWORD_HEALTH${RESET}"
# else
#   echo -e "${RED}✗ OnePassword health check failed${RESET}"
# fi

echo -e "\n${BOLD}${GREEN}=== Services launched ===${RESET}"
echo -e "\n${BOLD}Active Services:${RESET}"
echo -e "  Telegram:     http://localhost:8001"
# echo -e "  Guardian:     http://localhost:8002"
# echo -e "  OnePassword:  http://localhost:8000"

echo -e "\n${BOLD}Log files:${RESET}"
echo -e "  Telegram:     ~/.annabelle/logs/telegram.log"
# echo -e "  Guardian:     ~/.annabelle/logs/guardian.log"
# echo -e "  OnePassword:  ~/.annabelle/logs/onepassword.log"

echo -e "\n${BOLD}Process IDs:${RESET}"
echo -e "  Telegram:     $TELEGRAM_PID"
# echo -e "  Guardian:     $GUARDIAN_PID"
# echo -e "  OnePassword:  $ONEPASSWORD_PID"

echo -e "\n${YELLOW}Tip: Use 'tail -f ~/.annabelle/logs/telegram.log' to monitor Telegram${RESET}"
echo -e "${YELLOW}Tip: Use 'pkill -f \"node dist/index.js\"' to stop all services${RESET}\n"
