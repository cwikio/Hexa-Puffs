/**
 * MCP Client helper for integration tests
 * Connects to Guardian MCP server via stdio transport (spawns child process)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const GUARDIAN_ROOT = resolve(__dirname, "../..");

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";

export interface ScanContentInput {
  content: string | Record<string, unknown> | unknown[];
  source?: string;
  context?: string;
}

export interface ThreatInfo {
  path: string;
  type: string;
  snippet: string;
}

export interface ScanContentResult {
  safe: boolean;
  confidence: number;
  threats: ThreatInfo[];
  explanation: string;
  scan_id: string;
}

export interface GetScanLogInput {
  scan_id?: string;
  limit?: number;
  threats_only?: boolean;
}

export interface ScanLogEntry {
  scan_id: string;
  timestamp: string;
  source: string;
  safe: boolean;
  threats: string[];
  content_hash: string;
}

export interface GetScanLogResult {
  scans: ScanLogEntry[];
  total: number;
}

interface StandardResponse<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

let client: Client | null = null;
let transport: StdioClientTransport | null = null;

/**
 * Connect to Guardian MCP server via stdio (spawns a child process)
 */
export async function connect(): Promise<Client> {
  if (client) return client;

  // Filter env vars, force stdio transport
  const envVars: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "TRANSPORT") {
      envVars[key] = value;
    }
  }

  transport = new StdioClientTransport({
    command: "node",
    args: [resolve(GUARDIAN_ROOT, "dist/index.js")],
    cwd: GUARDIAN_ROOT,
    env: {
      ...envVars,
      TRANSPORT: "stdio",
    },
  });

  client = new Client(
    { name: "guardian-test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  return client;
}

/**
 * Disconnect from Guardian MCP server
 */
export async function disconnect(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
  if (transport) {
    await transport.close();
    transport = null;
  }
}

/**
 * Check Ollama health directly (no HTTP endpoint in stdio mode)
 */
export async function checkHealth(): Promise<{
  status: string;
  ollama: string;
  model: string;
}> {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!response.ok) {
      return { status: "degraded", ollama: "disconnected", model: "unknown" };
    }

    const data = (await response.json()) as {
      models: Array<{ name: string }>;
    };
    const hasGuardian = data.models.some((m) => m.name.startsWith("guardian"));

    return {
      status: hasGuardian ? "healthy" : "degraded",
      ollama: "connected",
      model: hasGuardian ? "guardian" : "missing",
    };
  } catch {
    return { status: "degraded", ollama: "disconnected", model: "unknown" };
  }
}

/**
 * Parse MCP tool response, unwrapping StandardResponse
 */
function parseToolResponse<T>(result: {
  content: Array<{ type: string; text?: string }>;
}): T {
  const textContent = result.content.find((c) => c.type === "text");
  if (
    !textContent ||
    textContent.type !== "text" ||
    !("text" in textContent)
  ) {
    throw new Error("No text content in response");
  }

  const parsed = JSON.parse(
    (textContent as { type: "text"; text: string }).text
  ) as StandardResponse<T>;
  if (!parsed.success) {
    throw new Error(parsed.error || "Tool returned error");
  }
  return parsed.data as T;
}

/**
 * Call scan_content tool
 */
export async function scanContent(
  input: ScanContentInput
): Promise<ScanContentResult> {
  const c = await connect();
  const result = await c.callTool({
    name: "scan_content",
    arguments: input,
  });

  return parseToolResponse<ScanContentResult>(result);
}

/**
 * Call get_scan_log tool
 */
export async function getScanLog(
  input: GetScanLogInput = {}
): Promise<GetScanLogResult> {
  const c = await connect();
  const result = await c.callTool({
    name: "get_scan_log",
    arguments: input,
  });

  return parseToolResponse<GetScanLogResult>(result);
}

/**
 * Log helper with timestamps
 */
export function log(message: string): void {
  const timestamp = new Date().toISOString().split("T")[1].slice(0, 12);
  console.log(`[${timestamp}] ${message}`);
}
