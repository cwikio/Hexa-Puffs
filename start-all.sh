#!/bin/bash

# Launch script for Annabelle MCP Stack
#
# MCPs are auto-discovered from package.json "annabelle" manifests.
# All MCPs are stdio-only, spawned by Orchestrator at startup.
#
# Orchestrator spawns Thinker agent(s) via AgentManager (multi-agent mode).
# Cost controls are enabled by default in agents.json.

BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ─── MCP Auto-Discovery ──────────────────────────────────────────────────────
# Uses the shared discovery module from @mcp/shared.
# Output: one line per MCP — name|transport|port|dir|sensitive
discover_mcps() {
  MCPS_ROOT="$SCRIPT_DIR" node "$SCRIPT_DIR/Shared/dist/Discovery/cli.js"
}

echo -e "${BOLD}${BLUE}=== Launching Annabelle MCP Stack ===${RESET}\n"

# ─── Discovery ────────────────────────────────────────────────────────────────
echo -e "${BOLD}${CYAN}=== MCP Discovery ===${RESET}"
DISCOVERY=$(discover_mcps)

if [ -z "$DISCOVERY" ]; then
  echo -e "${RED}No MCPs discovered! Check package.json annabelle manifests.${RESET}"
  exit 1
fi

# All MCPs are stdio — spawned by Orchestrator
STDIO_MCPS=""

while IFS='|' read -r name transport port dir sensitive; do
  # Check if disabled via env var (e.g. TELEGRAM_MCP_ENABLED=false)
  upper_name=$(echo "$name" | tr '[:lower:]' '[:upper:]')
  env_var="${upper_name}_MCP_ENABLED"
  enabled=$(eval echo "\$$env_var")
  if [ "$enabled" = "false" ]; then
    echo -e "  ${YELLOW}${name}$(printf '%*s' $((16 - ${#name})))DISABLED (${env_var}=false)${RESET}"
    continue
  fi

  echo -e "  ${BLUE}${name}$(printf '%*s' $((16 - ${#name})))stdio$(printf '%*s' 9)← spawned by Orchestrator${RESET}"
  STDIO_MCPS="${STDIO_MCPS}${name}|${dir}\n"
done <<< "$DISCOVERY"

STDIO_COUNT=$(echo -e "$STDIO_MCPS" | grep -c '|' 2>/dev/null || echo 0)
echo -e "${BOLD}${CYAN}Found ${STDIO_COUNT} MCP(s) (all stdio, spawned by Orchestrator)${RESET}\n"

# ─── Cleanup ──────────────────────────────────────────────────────────────────
echo -e "${YELLOW}Cleaning up existing processes...${RESET}"
# Fixed infrastructure ports
lsof -ti:8010 | xargs kill -9 2>/dev/null  # Orchestrator
lsof -ti:8006 | xargs kill -9 2>/dev/null  # Thinker
lsof -ti:3000 | xargs kill -9 2>/dev/null  # Orchestrator's Inngest HTTP server
lsof -ti:8288 | xargs kill -9 2>/dev/null  # Inngest Dev Server
lsof -ti:8289 | xargs kill -9 2>/dev/null  # Orchestrator standalone Inngest
sleep 2

# Create log directory and initialize PID tracking
mkdir -p ~/.annabelle/logs

# Seed external MCPs config if it doesn't exist (lives in project root)
EXTERNAL_MCPS="$SCRIPT_DIR/external-mcps.json"
if [ ! -f "$EXTERNAL_MCPS" ]; then
  echo '{}' > "$EXTERNAL_MCPS"
  echo -e "${GREEN}✓ Created empty external MCPs config at $EXTERNAL_MCPS${RESET}"
fi
PID_FILE="$HOME/.annabelle/annabelle.pids"
: > "$PID_FILE"

# ─── Auth Token ──────────────────────────────────────────────────────────────
ANNABELLE_TOKEN=$(openssl rand -hex 32)
echo "$ANNABELLE_TOKEN" > "$HOME/.annabelle/annabelle.token"
chmod 600 "$HOME/.annabelle/annabelle.token"
export ANNABELLE_TOKEN
echo -e "${GREEN}✓ Auth token generated and saved to ~/.annabelle/annabelle.token${RESET}"

# ─── Persona & Skills Initialization ──────────────────────────────────────────
echo -e "${BOLD}${CYAN}=== Initializing Persona & Skills ===${RESET}"

AGENTS_DIR="$HOME/.annabelle/agents"
SKILLS_DIR="$HOME/.annabelle/skills"
mkdir -p "$AGENTS_DIR" "$SKILLS_DIR"

# Git-init agents dir for passive change tracking of persona edits
if [ ! -d "$AGENTS_DIR/.git" ]; then
  git -C "$AGENTS_DIR" init -q
  echo -e "  ${GREEN}✓ Initialized git in $AGENTS_DIR for change tracking${RESET}"
fi

# Copy default persona if not already present (never overwrites user edits)
ANNABELLE_PERSONA_DIR="$AGENTS_DIR/annabelle"
ANNABELLE_PERSONA_FILE="$ANNABELLE_PERSONA_DIR/instructions.md"
DEFAULT_PERSONA_SRC="$SCRIPT_DIR/Thinker/defaults/personas/annabelle/instructions.md"
if [ ! -f "$ANNABELLE_PERSONA_FILE" ]; then
  if [ -f "$DEFAULT_PERSONA_SRC" ]; then
    mkdir -p "$ANNABELLE_PERSONA_DIR"
    cp "$DEFAULT_PERSONA_SRC" "$ANNABELLE_PERSONA_FILE"
    echo -e "  ${GREEN}✓ Copied default Annabelle persona to $ANNABELLE_PERSONA_FILE${RESET}"
    git -C "$AGENTS_DIR" add -A && git -C "$AGENTS_DIR" commit -q -m "Initial default persona"
    echo -e "  ${GREEN}✓ Committed initial persona to git${RESET}"
  else
    echo -e "  ${YELLOW}⚠ Default persona source not found at $DEFAULT_PERSONA_SRC${RESET}"
  fi
else
  echo -e "  ${BLUE}✓ Annabelle persona already exists${RESET}"
fi

echo -e "  ${BLUE}✓ Skills directory ready at $SKILLS_DIR${RESET}"
echo ""

# ─── Documentation Sync ─────────────────────────────────────────────────────
echo -e "${BOLD}${CYAN}=== Syncing Documentation ===${RESET}"

DOCS_DIR="$HOME/.annabelle/documentation"
DOC_SRC="$SCRIPT_DIR/.documentation"
mkdir -p "$DOCS_DIR"

if [ -d "$DOC_SRC" ]; then
  cp "$DOC_SRC"/*.md "$DOCS_DIR/" 2>/dev/null
  DOC_COUNT=$(ls -1 "$DOCS_DIR"/*.md 2>/dev/null | wc -l | tr -d ' ')
  echo -e "  ${GREEN}✓ Synced $DOC_COUNT documentation files to $DOCS_DIR${RESET}"
else
  echo -e "  ${YELLOW}⚠ Documentation source not found at $DOC_SRC${RESET}"
fi

echo ""

# ─── Inngest Dev Server ──────────────────────────────────────────────────────
echo -e "${BOLD}Starting Inngest Dev Server (port 8288)...${RESET}"
cd "$SCRIPT_DIR/Orchestrator"
npx inngest-cli@latest dev --no-discovery >> ~/.annabelle/logs/inngest.log 2>&1 &
INNGEST_PID=$!
echo "$INNGEST_PID" >> "$PID_FILE"
echo -e "${GREEN}✓ Inngest Dev Server started (PID: $INNGEST_PID)${RESET}"

sleep 3

if ! kill -0 "$INNGEST_PID" 2>/dev/null; then
  echo -e "${YELLOW}⚠ Inngest Dev Server process died — check ~/.annabelle/logs/inngest.log${RESET}"
fi

INNGEST_HEALTH=$(curl -s http://localhost:8288 2>/dev/null)
if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Inngest Dev Server is healthy${RESET}"
  echo -e "  ${BLUE}Dashboard: http://localhost:8288${RESET}"
else
  echo -e "${YELLOW}⚠ Inngest Dev Server not responding (may still be starting)${RESET}"
fi

# ─── Ollama + Guardian model ─────────────────────────────────────────────────
echo -e "\n${BOLD}Checking Ollama + Guardian model...${RESET}"
if ! command -v ollama &> /dev/null; then
  echo -e "${YELLOW}⚠ Ollama not installed — Guardian scanning will be unavailable${RESET}"
elif ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
  echo -e "${BLUE}Starting Ollama...${RESET}"
  ollama serve >> ~/.annabelle/logs/ollama.log 2>&1 &
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

if command -v ollama &> /dev/null && curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
  if ollama list 2>/dev/null | grep -q "guardian"; then
    echo -e "${GREEN}✓ Guardian model loaded${RESET}"
  else
    GUARDIAN_GGUF="$SCRIPT_DIR/Guardian/models/granite-guardian-3.3-8b.i1-Q4_K_M.gguf"
    if [ -f "$GUARDIAN_GGUF" ]; then
      echo -e "${BLUE}Loading Guardian model into Ollama...${RESET}"
      cd "$SCRIPT_DIR/Guardian/models" && ollama create guardian -f Modelfile > /dev/null 2>&1
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

# ─── Orchestrator ─────────────────────────────────────────────────────────────
AGENTS_JSON="$SCRIPT_DIR/agents.json"
echo -e "\n${BOLD}Starting Orchestrator MCP (HTTP on port 8010)...${RESET}"
echo -e "  ${BLUE}Orchestrator auto-discovers MCPs from package.json manifests${RESET}"
echo -e "  ${BLUE}Orchestrator spawns Thinker agent(s) from ${AGENTS_JSON}${RESET}"
cd "$SCRIPT_DIR/Orchestrator"
TRANSPORT=http PORT=8010 MCP_CONNECTION_MODE=stdio \
  AGENTS_CONFIG_PATH="$AGENTS_JSON" \
  ORCHESTRATOR_URL=http://localhost:8010 \
  ANNABELLE_TOKEN="$ANNABELLE_TOKEN" \
  npm start >> ~/.annabelle/logs/orchestrator.log 2>&1 &
ORCHESTRATOR_PID=$!
echo "$ORCHESTRATOR_PID" >> "$PID_FILE"
echo -e "${GREEN}✓ Orchestrator started (PID: $ORCHESTRATOR_PID)${RESET}"

echo -e "\n${YELLOW}Waiting for Orchestrator, downstream MCPs, and Thinker agent(s) to initialize...${RESET}"
sleep 10

if ! kill -0 "$ORCHESTRATOR_PID" 2>/dev/null; then
  echo -e "${RED}${BOLD}✗ Orchestrator process died — aborting. Check ~/.annabelle/logs/orchestrator.log${RESET}"
  exit 1
fi

ORCHESTRATOR_HEALTH=$(curl -s http://localhost:8010/health 2>/dev/null)
if echo "$ORCHESTRATOR_HEALTH" | grep -q "ok"; then
  echo -e "${GREEN}✓ Orchestrator is healthy${RESET}"
  TOOLS_RESPONSE=$(curl -s -H "X-Annabelle-Token: $ANNABELLE_TOKEN" http://localhost:8010/tools/list 2>/dev/null)
  TOOL_COUNT=$(echo "$TOOLS_RESPONSE" | grep -o '"name"' | wc -l | tr -d ' ')
  echo -e "  ${BLUE}Discovered $TOOL_COUNT tools from downstream MCPs${RESET}"
else
  echo -e "${RED}✗ Orchestrator health check failed${RESET}"
  echo -e "  ${YELLOW}Check logs: tail -f ~/.annabelle/logs/orchestrator.log${RESET}"
fi

# ─── Seed Cron Skills (idempotent) ───────────────────────────────────────────
echo -e "\n${BOLD}Seeding cron skills...${RESET}"
SEED_SCRIPT="$SCRIPT_DIR/_scripts/seed-cron-skills.ts"
if [ -f "$SEED_SCRIPT" ]; then
  ORCHESTRATOR_URL=http://localhost:8010 npx tsx "$SEED_SCRIPT" >> ~/.annabelle/logs/seed-skills.log 2>&1 &
  SEED_PID=$!
  echo -e "${GREEN}✓ Skill seeding started in background (PID: $SEED_PID)${RESET}"
  echo -e "  ${BLUE}Check progress: cat ~/.annabelle/logs/seed-skills.log${RESET}"
else
  echo -e "${YELLOW}⚠ Seed script not found at $SEED_SCRIPT — skipping${RESET}"
fi

# ─── Inngest Registration ────────────────────────────────────────────────────
echo -e "\n${BOLD}Registering app with Inngest...${RESET}"
REGISTER_RESULT=$(curl -s http://localhost:8288/v0/gql -X POST -H "Content-Type: application/json" -d '{"query":"mutation { createApp(input: { url: \"http://localhost:3000/api/inngest\" }) { name functionCount } }"}' 2>/dev/null)
if echo "$REGISTER_RESULT" | grep -q "functionCount"; then
  FUNC_COUNT=$(echo "$REGISTER_RESULT" | grep -o '"functionCount":[0-9]*' | grep -o '[0-9]*')
  echo -e "${GREEN}✓ App registered with Inngest ($FUNC_COUNT functions)${RESET}"
else
  echo -e "${YELLOW}⚠ Auto-registration failed - sync manually at http://localhost:8288${RESET}"
fi

# ─── Thinker Agent ────────────────────────────────────────────────────────────
echo -e "\n${BOLD}Checking Thinker agent (spawned by Orchestrator)...${RESET}"
THINKER_HEALTH=$(curl -s http://localhost:8006/health 2>/dev/null)
if echo "$THINKER_HEALTH" | grep -q "ok"; then
  echo -e "${GREEN}✓ Thinker agent is healthy${RESET}"
  LLM_PROVIDER=$(echo "$THINKER_HEALTH" | grep -o '"llmProvider":"[^"]*"' | cut -d'"' -f4)
  echo -e "  ${BLUE}LLM Provider: $LLM_PROVIDER${RESET}"
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

# ─── System Snapshot ──────────────────────────────────────────────────────────
echo -e "\n${BOLD}Generating system snapshot...${RESET}"
SNAPSHOT_SCRIPT="$SCRIPT_DIR/_scripts/generate-system-snapshot.ts"
if [ -f "$SNAPSHOT_SCRIPT" ]; then
  ORCHESTRATOR_URL=http://localhost:8010 ANNABELLE_TOKEN="$ANNABELLE_TOKEN" \
    npx tsx "$SNAPSHOT_SCRIPT" >> ~/.annabelle/logs/snapshot.log 2>&1 &
  SNAPSHOT_PID=$!
  echo -e "${GREEN}✓ Snapshot generation started in background (PID: $SNAPSHOT_PID)${RESET}"
  echo -e "  ${BLUE}Output: ~/.annabelle/documentation/system-snapshot.md${RESET}"
else
  echo -e "${YELLOW}⚠ Snapshot script not found at $SNAPSHOT_SCRIPT — skipping${RESET}"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}${GREEN}=== All services launched ===${RESET}"

echo -e "\n${BOLD}Architecture:${RESET}"
echo -e "  Orchestrator (8010) spawns all MCPs via stdio:"
while IFS='|' read -r name dir; do
  [ -z "$name" ] && continue
  echo -e "    └── ${name} MCP"
done < <(echo -e "$STDIO_MCPS")
echo -e "  Orchestrator (8010) spawns Thinker agent(s) from agents.json:"
echo -e "    └── Thinker :8006 (annabelle) — cost controls enabled"

echo -e "\n${BOLD}Service URLs:${RESET}"
echo -e "  $(printf '%-18s' "Orchestrator:") http://localhost:8010"
echo -e "  $(printf '%-18s' "Thinker:") http://localhost:8006"
echo -e "  $(printf '%-18s' "Inngest:") http://localhost:8288"
while IFS='|' read -r name transport port dir sensitive; do
  [ -z "$name" ] && continue
  label="${name} MCP:"
  if [ "$transport" = "http" ] && [ -n "$port" ]; then
    echo -e "  $(printf '%-18s' "$label") http://localhost:${port}"
  else
    echo -e "  $(printf '%-18s' "$label") stdio (via Orchestrator :8010)"
  fi
done <<< "$DISCOVERY"

echo -e "\n${BOLD}Log files:${RESET}"
echo -e "  $(printf '%-14s' "Orchestrator:") ~/.annabelle/logs/orchestrator.log"
echo -e "  $(printf '%-14s' "Thinker:") (inside orchestrator.log — grep '[thinker:annabelle]')"
echo -e "  $(printf '%-14s' "Inngest:") ~/.annabelle/logs/inngest.log"

echo -e "\n${BOLD}Process IDs:${RESET}"
echo -e "  $(printf '%-14s' "Orchestrator:") $ORCHESTRATOR_PID (MCPs + Thinker agent(s) are child processes)"
echo -e "  $(printf '%-14s' "Inngest:") $INNGEST_PID"

echo -e "\n${YELLOW}Tip: Use 'tail -f ~/.annabelle/logs/*.log' to monitor all services${RESET}"
echo -e "${YELLOW}Tip: Use './restart.sh' to stop, rebuild, and restart all services${RESET}\n"
