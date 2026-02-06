/**
 * web_search tool - Search the web using Brave Search
 */

import { z } from "zod";
import type { StandardResponse } from "@mcp/shared/Types/StandardResponse.js";
import { webSearch } from "../services/brave.js";

const VALID_FRESHNESS = new Set([
  "24h", "day", "today", "1d",
  "week", "7d",
  "month", "30d",
  "year", "1y", "365d",
]);

// Normalize common freshness values to Brave API format
const normalizeFreshness = (
  value: string | undefined
): "24h" | "week" | "month" | "year" | undefined => {
  if (!value) return undefined;
  const normalized = value.toLowerCase().trim();
  const mapping: Record<string, "24h" | "week" | "month" | "year"> = {
    "24h": "24h",
    day: "24h",
    today: "24h",
    "1d": "24h",
    week: "week",
    "7d": "week",
    month: "month",
    "30d": "month",
    year: "year",
    "1y": "year",
    "365d": "year",
  };
  return mapping[normalized];
};

export const webSearchSchema = z.object({
  query: z.string().describe("Search query"),
  count: z
    .coerce.number()
    .min(1)
    .max(20)
    .default(10)
    .describe("Number of results (1-20)"),
  freshness: z
    .string()
    .optional()
    .refine((v) => !v || VALID_FRESHNESS.has(v.toLowerCase().trim()), {
      message: "Invalid freshness value. Valid values: 24h, day, week, month, year",
    })
    .transform(normalizeFreshness)
    .describe("Filter results by recency (24h, day, week, month, year)"),
  safesearch: z
    .enum(["off", "moderate", "strict"])
    .default("moderate")
    .describe("Safe search level"),
});

export type WebSearchInput = z.infer<typeof webSearchSchema>;

export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
  age?: string;
  extra_snippets?: string[];
}

export interface InfoboxResult {
  title: string;
  description: string;
  long_desc?: string;
  attributes?: Array<{ label: string; value: string }>;
}

export interface WebSearchData {
  results: WebSearchResult[];
  total_count: number;
  query: string;
  infobox?: InfoboxResult[];
}

export type WebSearchToolResult = StandardResponse<WebSearchData>;

export async function handleWebSearch(
  input: WebSearchInput
): Promise<WebSearchData> {
  const response = await webSearch({
    query: input.query,
    count: input.count,
    freshness: input.freshness,
    safesearch: input.safesearch,
  });

  const results: WebSearchResult[] = (response.web?.results || []).map(
    (result) => {
      const item: WebSearchResult = {
        title: result.title,
        url: result.url,
        description: result.description,
        age: result.age || result.page_age,
      };
      if (result.extra_snippets?.length) {
        item.extra_snippets = result.extra_snippets;
      }
      return item;
    }
  );

  const data: WebSearchData = {
    results,
    total_count: results.length,
    query: response.query.original,
  };

  if (response.infobox?.results?.length) {
    data.infobox = response.infobox.results.map((box) => {
      const item: InfoboxResult = {
        title: box.title,
        description: box.description,
      };
      if (box.long_desc) item.long_desc = box.long_desc;
      if (box.attributes?.length) item.attributes = box.attributes;
      return item;
    });
  }

  return data;
}
