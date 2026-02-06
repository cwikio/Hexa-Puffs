/**
 * MCP Client helper for integration tests
 * Connects to Guardian MCP server via HTTP/SSE
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const GUARDIAN_URL = process.env.GUARDIAN_URL || "http://localhost:8003";

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

let client: Client | null = null;
let transport: SSEClientTransport | null = null;

/**
 * Connect to Guardian MCP server
 */
export async function connect(): Promise<Client> {
  if (client) return client;

  transport = new SSEClientTransport(new URL(`${GUARDIAN_URL}/sse`));
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
    transport = null;
  }
}

/**
 * Check health endpoint
 */
export async function checkHealth(): Promise<{
  status: string;
  ollama: string;
  model: string;
}> {
  const response = await fetch(`${GUARDIAN_URL}/health`);
  return response.json();
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

  // MCP returns content array with text content
  const textContent = result.content.find((c) => c.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("No text content in response");
  }

  return JSON.parse(textContent.text) as ScanContentResult;
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

  const textContent = result.content.find((c) => c.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("No text content in response");
  }

  return JSON.parse(textContent.text) as GetScanLogResult;
}

/**
 * Log helper with timestamps
 */
export function log(message: string): void {
  const timestamp = new Date().toISOString().split("T")[1].slice(0, 12);
  console.log(`[${timestamp}] ${message}`);
}
