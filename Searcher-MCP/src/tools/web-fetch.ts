/**
 * web_fetch tool - Fetch a URL and extract its content as clean markdown
 * Uses Mozilla Readability for article extraction + Turndown for HTML→markdown
 */

import { z } from "zod";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import type { StandardResponse } from "@mcp/shared/Types/StandardResponse.js";
// Read directly from env to avoid getConfig() throwing when BRAVE_API_KEY is missing
// (e.g. in unit tests that only test web_fetch)
const WEB_FETCH_MAX_LENGTH = parseInt(process.env.WEB_FETCH_MAX_LENGTH || "20000", 10);

const USER_AGENT =
  "Mozilla/5.0 (compatible; Annabelle/1.0; +https://github.com/annabelle)";

export const webFetchSchema = z.object({
  url: z.string().url().describe("The URL to fetch and extract content from"),
  maxLength: z.coerce
    .number()
    .min(1000)
    .max(100000)
    .default(WEB_FETCH_MAX_LENGTH)
    .describe(
      "Maximum characters of extracted content to return (default: from WEB_FETCH_MAX_LENGTH env, 20000)"
    ),
  includeLinks: z
    .boolean()
    .default(true)
    .describe("Preserve hyperlinks in markdown output (default: true)"),
  timeout: z.coerce
    .number()
    .min(1000)
    .max(30000)
    .default(10000)
    .describe("Fetch timeout in milliseconds (default: 10000)"),
});

export type WebFetchInput = z.infer<typeof webFetchSchema>;

export interface WebFetchData {
  url: string;
  title: string;
  content: string;
  contentLength: number;
  truncated: boolean;
}

export type WebFetchToolResult = StandardResponse<WebFetchData>;

export async function handleWebFetch(
  input: WebFetchInput
): Promise<WebFetchData> {
  const response = await fetch(input.url, {
    signal: AbortSignal.timeout(input.timeout),
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText} fetching ${input.url}`
    );
  }

  const contentType = response.headers.get("content-type") || "";
  if (
    !contentType.includes("text/html") &&
    !contentType.includes("text/plain")
  ) {
    throw new Error(
      `Unsupported content type: ${contentType}. Only text/html and text/plain are supported.`
    );
  }

  const html = await response.text();
  if (!html.trim()) {
    throw new Error(`Empty response body from ${input.url}`);
  }

  // Parse HTML into a DOM using linkedom
  const { document } = parseHTML(html);

  // Set up Turndown for HTML→markdown conversion
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });

  if (!input.includeLinks) {
    turndown.addRule("stripLinks", {
      filter: "a",
      replacement: (content) => content,
    });
  }

  // Try Readability extraction first (article content only)
  let title = document.title || input.url;
  let markdown: string;

  const reader = new Readability(document);
  const article = reader.parse();

  if (article) {
    title = article.title || title;
    markdown = turndown.turndown(article.content);
  } else {
    // Fallback: strip scripts/styles and convert full body
    for (const el of document.querySelectorAll(
      "script, style, nav, footer, header"
    )) {
      el.remove();
    }
    markdown = turndown.turndown(document.body?.innerHTML || html);
  }

  // Truncate if needed (OpenClaw pattern)
  const contentLength = markdown.length;
  let truncated = false;

  if (markdown.length > input.maxLength) {
    markdown = markdown.slice(0, input.maxLength) + "\n\n[...TRUNCATED]";
    truncated = true;
  }

  return {
    url: input.url,
    title,
    content: markdown,
    contentLength,
    truncated,
  };
}
