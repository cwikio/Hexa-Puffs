#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, existsSync } from "fs";

// Load environment variables
dotenv.config();

// Configuration
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:3000";
const HEXA_PUFFS_TOKEN = process.env.HEXA_PUFFS_TOKEN; // Optional, strict auth if set

// Constants
const NOTIFICATIONS_URI = "hexa-puffs://notifications";
const LOGS_URI = "hexa-puffs://logs";

/**
 * Validates connection to Orchestrator
 */
async function checkConnection(): Promise<boolean> {
  try {
    await axios.get(`${ORCHESTRATOR_URL}/health`);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Determine Hexa Puffs token (env var or .hexa-puffs/token file)
 */
function getAuthToken(): string | undefined {
  if (HEXA_PUFFS_TOKEN) return HEXA_PUFFS_TOKEN;
  
  // Try to read from default location
  try {
    const homedir = process.env.HOME || process.env.USERPROFILE;
    if (homedir) {
        const tokenPath = join(homedir, '.hexa-puffs', 'hexa-puffs.token');
        if (existsSync(tokenPath)) {
            return readFileSync(tokenPath, 'utf8').trim();
        }
    }
  } catch {
    // Ignore error
  }
  return undefined;
}

const authToken = getAuthToken();

// Create server instance
const server = new Server(
  {
    name: "hexa-puffs-connector",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Tools Handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "chat",
        description: "Send a message to Hexa Puffs and wait for her response. Use this to ask questions, assign tasks, or get status updates.",
        inputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "The message to send to Hexa Puffs",
            },
          },
          required: ["message"],
        },
      },
      {
        name: "check_status",
        description: "Check the current status of the Hexa Puffs system (agents, jobs, health).",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
         name: "check_notifications",
         description: "Check for recent async notifications from Hexa Puffs (e.g. job completions).",
         inputSchema: {
             type: "object",
             properties: {}
         }
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // 1. Check Status Tool
  if (name === "check_status") {
    try {
      const response = await axios.get(`${ORCHESTRATOR_URL}/status`, {
          headers: authToken ? { 'X-Hexa-Puffs-Token': authToken } : {}
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error connecting to Hexa Puffs Orchestrator at ${ORCHESTRATOR_URL}: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  // 2. Chat Tool
  if (name === "chat") {
    const message = (args as any).message;
    if (!message) {
      throw new Error("Message is required");
    }

    try {
      // POST to /chat endpoint (to be implemented in Orchestrator)
      const response = await axios.post(`${ORCHESTRATOR_URL}/chat`, {
        message: message,
        sender: "claude-user" 
      }, {
        headers: authToken ? { 'X-Hexa-Puffs-Token': authToken } : {},
        timeout: 60000 // 60s timeout for Hexa Puffs to think
      });

      return {
        content: [
          {
            type: "text",
            text: response.data.reply || "No response received.",
          },
        ],
      };
    } catch (error: any) {
        if (error.code === 'ECONNABORTED') {
            return {
                content: [{ type: "text", text: "Hexa Puffs is taking longer than 60s to reply. She is still working. Check notifications later." }]
            };
        }
      return {
        content: [
          {
            type: "text",
            text: `Error talking to Hexa Puffs: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
  
  // 3. Notifications Tool
  if (name === "check_notifications") {
      // For now, return a placeholder until we implement the notifications buffer
      return {
          content: [{ type: "text", text: "No new notifications." }]
      };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Resource Handler
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: NOTIFICATIONS_URI,
        name: "Hexa Puffs Notifications",
        mimeType: "text/plain",
        description: "Log of recent asynchronous events from Hexa Puffs",
      },
       {
        uri: LOGS_URI,
        name: "Hexa Puffs Logs",
        mimeType: "text/plain",
        description: "Real-time system logs",
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri === NOTIFICATIONS_URI) {
        return {
            contents: [{
                uri: NOTIFICATIONS_URI,
                mimeType: "text/plain",
                text: "No notifications (Not implemented yet)."
            }]
        };
    }
    
    throw new Error("Resource not found");
});

// Start server
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Note: We don't log to console here because it breaks stdio transport
}

run().catch((error) => {
  console.error("Fatal error running Hexa Puffs Connector:", error);
  process.exit(1);
});
