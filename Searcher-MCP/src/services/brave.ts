/**
 * Brave Search API client
 */

import { getConfig } from "../utils/config.js";

const BRAVE_API_BASE = "https://api.search.brave.com/res/v1";

let lastRequestTime = 0;

async function waitForRateLimit(): Promise<void> {
  const rateLimitMs = getConfig().braveRateLimitMs;
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < rateLimitMs) {
    await new Promise(r => setTimeout(r, rateLimitMs - elapsed));
  }
  lastRequestTime = Date.now();
}

export interface BraveWebResult {
  title: string;
  url: string;
  description: string;
  age?: string;
  page_age?: string;
  language?: string;
  family_friendly?: boolean;
  extra_snippets?: string[];
}

export interface BraveInfoboxResult {
  title: string;
  description: string;
  long_desc?: string;
  attributes?: Array<{ label: string; value: string }>;
  website?: { url: string };
  images?: Array<{ src: string }>;
}

export interface BraveNewsResult {
  title: string;
  url: string;
  description: string;
  age: string;
  meta_url: {
    scheme: string;
    netloc: string;
    hostname: string;
    favicon?: string;
    path?: string;
  };
  thumbnail?: {
    src: string;
  };
  breaking?: boolean;
}

export interface BraveWebSearchResponse {
  query: {
    original: string;
  };
  web?: {
    results: BraveWebResult[];
  };
  news?: {
    results: BraveNewsResult[];
  };
  infobox?: {
    results: BraveInfoboxResult[];
  };
}

export interface BraveNewsSearchResponse {
  query: {
    original: string;
  };
  results: BraveNewsResult[];
}

type FreshnessParam = "pd" | "pw" | "pm" | "py";

function mapFreshness(
  freshness: "24h" | "week" | "month" | "year" | undefined
): FreshnessParam | undefined {
  if (!freshness) return undefined;
  const mapping: Record<string, FreshnessParam> = {
    "24h": "pd",
    week: "pw",
    month: "pm",
    year: "py",
  };
  return mapping[freshness];
}

export interface WebSearchParams {
  query: string;
  count?: number;
  offset?: number;
  freshness?: "24h" | "week" | "month" | "year";
  safesearch?: "off" | "moderate" | "strict";
}

export interface NewsSearchParams {
  query: string;
  count?: number;
  offset?: number;
  freshness?: "24h" | "week" | "month";
}

async function braveRequest<T>(
  endpoint: string,
  params: Record<string, string | number | undefined>
): Promise<T> {
  const config = getConfig();

  // Build query string, filtering out undefined values
  const queryParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      queryParams.set(key, String(value));
    }
  }

  const url = `${BRAVE_API_BASE}${endpoint}?${queryParams.toString()}`;

  await waitForRateLimit();

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": config.braveApiKey,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Brave API error: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  return response.json() as Promise<T>;
}

export async function webSearch(
  params: WebSearchParams
): Promise<BraveWebSearchResponse> {
  return braveRequest<BraveWebSearchResponse>("/web/search", {
    q: params.query,
    count: params.count,
    offset: params.offset,
    freshness: mapFreshness(params.freshness),
    safesearch: params.safesearch,
    extra_snippets: 1,
  });
}

export async function newsSearch(
  params: NewsSearchParams
): Promise<BraveNewsSearchResponse> {
  return braveRequest<BraveNewsSearchResponse>("/news/search", {
    q: params.query,
    count: params.count,
    offset: params.offset,
    freshness: mapFreshness(params.freshness),
  });
}

export interface BraveImageResult {
  title: string;
  url: string;
  properties: {
    url: string;
  };
  thumbnail: {
    src: string;
  };
  source: string;
}

export interface BraveImageSearchResponse {
  query: {
    original: string;
  };
  results: BraveImageResult[];
}

export interface ImageSearchParams {
  query: string;
  count?: number;
  safesearch?: "off" | "moderate" | "strict";
}

export async function imageSearch(
  params: ImageSearchParams
): Promise<BraveImageSearchResponse> {
  return braveRequest<BraveImageSearchResponse>("/images/search", {
    q: params.query,
    count: params.count,
    safesearch: params.safesearch,
  });
}
