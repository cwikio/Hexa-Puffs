/**
 * Guardian Provider Selector
 *
 * Selects between Groq and Ollama based on environment configuration.
 * If GROQ_API_KEY is set, uses Groq. Otherwise falls back to Ollama.
 *
 * All selection is LAZY — env vars are read at first use, not at import time,
 * so that dotenv in index.ts has a chance to load Guardian/.env first.
 */

import type { GuardianScanResult } from "./ollama/client.js";

export type { GuardianScanResult };

export type ProviderName = "groq" | "ollama" | "safeguard";

interface ScanProvider {
  scanWithGuardian(
    content: string,
    context?: string
  ): Promise<GuardianScanResult>;
  healthCheck(): Promise<boolean>;
  verifyConnection(): Promise<void>;
  getModelName(): string;
  getHost(): string;
}

let _provider: ScanProvider | null = null;
let _providerName: ProviderName | null = null;

function resolveProviderName(): ProviderName {
  if (!_providerName) {
    if (!process.env.GROQ_API_KEY) {
      _providerName = "ollama";
    } else {
      const model = process.env.GROQ_MODEL || "";
      _providerName = model.includes("safeguard") ? "safeguard" : "groq";
    }
  }
  return _providerName;
}

async function loadProvider(): Promise<ScanProvider> {
  if (_provider) return _provider;

  const name = resolveProviderName();

  if (name === "safeguard") {
    const safeguard = await import("./groq/safeguard-client.js");
    _provider = {
      scanWithGuardian: safeguard.scanWithGuardian,
      healthCheck: safeguard.healthCheck,
      verifyConnection: safeguard.verifyConnection,
      getModelName: safeguard.getModelName,
      getHost: safeguard.getHost,
    };
  } else if (name === "groq") {
    const groq = await import("./groq/client.js");
    _provider = {
      scanWithGuardian: groq.scanWithGuardian,
      healthCheck: groq.healthCheck,
      verifyConnection: groq.verifyConnection,
      getModelName: groq.getModelName,
      getHost: groq.getHost,
    };
  } else {
    const ollama = await import("./ollama/client.js");
    _provider = {
      scanWithGuardian: ollama.scanWithGuardian,
      healthCheck: ollama.healthCheck,
      verifyConnection: ollama.verifyConnection,
      getModelName: ollama.getModelName,
      getHost: ollama.getOllamaHost,
    };
  }

  return _provider;
}

export async function scanWithGuardian(
  content: string,
  context?: string
): Promise<GuardianScanResult> {
  const p = await loadProvider();
  return p.scanWithGuardian(content, context);
}

export async function healthCheck(): Promise<boolean> {
  const p = await loadProvider();
  return p.healthCheck();
}

export async function verifyConnection(): Promise<void> {
  const p = await loadProvider();
  return p.verifyConnection();
}

export function getModelName(): string {
  if (_provider) return _provider.getModelName();
  return process.env.GROQ_MODEL || process.env.MODEL_NAME || "unknown";
}

export function getHost(): string {
  if (_provider) return _provider.getHost();
  return process.env.GROQ_BASE_URL || process.env.OLLAMA_HOST || "unknown";
}

export function getProviderName(): ProviderName {
  return resolveProviderName();
}
