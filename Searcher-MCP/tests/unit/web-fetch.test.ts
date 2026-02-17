/**
 * Unit tests for web_fetch tool
 * Mocks global.fetch to test handler logic in isolation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { webFetchSchema, handleWebFetch } from "../../src/tools/web-fetch.js";

// Helper to create a mock Response
function mockResponse(
  body: string,
  init: { status?: number; statusText?: string; headers?: Record<string, string> } = {}
): Response {
  const { status = 200, statusText = "OK", headers = {} } = init;
  const defaultHeaders: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
    ...headers,
  };
  return new Response(body, {
    status,
    statusText,
    headers: defaultHeaders,
  });
}

const SAMPLE_HTML = `<!DOCTYPE html>
<html><head><title>Test Article</title></head>
<body>
  <nav><a href="/">Home</a></nav>
  <article>
    <h1>Main Heading</h1>
    <p>This is the article content with a <a href="https://example.com">link</a>.</p>
    <ul><li>Item one</li><li>Item two</li></ul>
  </article>
  <footer>Copyright 2024</footer>
  <script>alert("bad")</script>
  <style>.hidden { display: none; }</style>
</body></html>`;

const MINIMAL_HTML = `<!DOCTYPE html>
<html><head><title>Minimal</title></head>
<body><p>Hello world</p></body></html>`;

const NO_TITLE_HTML = `<!DOCTYPE html>
<html><head></head>
<body><p>No title here</p></body></html>`;

// HTML with enough content for Readability to parse as an article
const LONG_ARTICLE_HTML = `<!DOCTYPE html>
<html><head><title>Long Article</title></head>
<body>
  <article>
    <h1>Long Article Title</h1>
    ${"<p>This is a paragraph of content that makes the article long enough for Readability to parse it properly. It contains multiple sentences and enough text to be considered a real article.</p>\n".repeat(10)}
  </article>
  <nav><ul><li>Nav 1</li><li>Nav 2</li></ul></nav>
  <footer><p>Footer content that should be stripped</p></footer>
</body></html>`;

describe("web_fetch - Schema Validation", () => {
  it("should accept a valid URL", () => {
    const result = webFetchSchema.safeParse({ url: "https://example.com" });
    expect(result.success).toBe(true);
  });

  it("should reject missing URL", () => {
    const result = webFetchSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should reject invalid URL", () => {
    const result = webFetchSchema.safeParse({ url: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("should reject null URL", () => {
    const result = webFetchSchema.safeParse({ url: null });
    expect(result.success).toBe(false);
  });

  it("should accept maxLength within bounds", () => {
    const result = webFetchSchema.safeParse({ url: "https://example.com", maxLength: 5000 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.maxLength).toBe(5000);
  });

  it("should reject maxLength below 1000", () => {
    const result = webFetchSchema.safeParse({ url: "https://example.com", maxLength: 500 });
    expect(result.success).toBe(false);
  });

  it("should reject maxLength above 100000", () => {
    const result = webFetchSchema.safeParse({ url: "https://example.com", maxLength: 200000 });
    expect(result.success).toBe(false);
  });

  it("should use default maxLength when omitted", () => {
    const result = webFetchSchema.safeParse({ url: "https://example.com" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.maxLength).toBe(20000);
  });

  it("should accept timeout within bounds", () => {
    const result = webFetchSchema.safeParse({ url: "https://example.com", timeout: 5000 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.timeout).toBe(5000);
  });

  it("should reject timeout below 1000", () => {
    const result = webFetchSchema.safeParse({ url: "https://example.com", timeout: 100 });
    expect(result.success).toBe(false);
  });

  it("should accept includeLinks: false", () => {
    const result = webFetchSchema.safeParse({ url: "https://example.com", includeLinks: false });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.includeLinks).toBe(false);
  });
});

describe("web_fetch - Readability Extraction + Markdown Conversion", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should extract article content and convert to markdown", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(LONG_ARTICLE_HTML));
    const input = webFetchSchema.parse({ url: "https://example.com/article" });
    const result = await handleWebFetch(input);

    expect(result.content).toContain("Long Article Title");
    expect(result.content).toContain("paragraph of content");
    expect(result.url).toBe("https://example.com/article");
  });

  it("should extract title from HTML", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(LONG_ARTICLE_HTML));
    const input = webFetchSchema.parse({ url: "https://example.com" });
    const result = await handleWebFetch(input);

    // Readability may normalize the title (e.g. strip trailing words)
    expect(result.title).toContain("Long Article");
  });

  it("should fall back to URL as title when no <title> tag", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(NO_TITLE_HTML));
    const input = webFetchSchema.parse({ url: "https://example.com/no-title" });
    const result = await handleWebFetch(input);

    // Title should be the URL or empty, not undefined
    expect(result.title).toBeTruthy();
  });

  it("should fall back to full-page conversion when Readability returns null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(MINIMAL_HTML));
    const input = webFetchSchema.parse({ url: "https://example.com/minimal" });
    const result = await handleWebFetch(input);

    expect(result.content).toContain("Hello world");
    expect(result.title).toBe("Minimal");
  });

  it("should preserve links when includeLinks is true", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(SAMPLE_HTML));
    const input = webFetchSchema.parse({ url: "https://example.com", includeLinks: true });
    const result = await handleWebFetch(input);

    expect(result.content).toContain("https://example.com");
  });

  it("should strip links when includeLinks is false", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(SAMPLE_HTML));
    const input = webFetchSchema.parse({ url: "https://example.com", includeLinks: false });
    const result = await handleWebFetch(input);

    // Should contain the link text but not in markdown link format
    expect(result.content).not.toMatch(/\[link\]\(https:\/\/example\.com\)/);
  });

  it("should convert headings, paragraphs, and lists to markdown", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(SAMPLE_HTML));
    const input = webFetchSchema.parse({ url: "https://example.com" });
    const result = await handleWebFetch(input);

    // Should contain markdown content (not raw HTML)
    expect(result.content).not.toContain("<article>");
    expect(result.content).not.toContain("<script>");
    expect(result.content).not.toContain("<style>");
  });
});

describe("web_fetch - Content Truncation", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return full content when under maxLength", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(MINIMAL_HTML));
    const input = webFetchSchema.parse({ url: "https://example.com", maxLength: 50000 });
    const result = await handleWebFetch(input);

    expect(result.truncated).toBe(false);
    expect(result.content).not.toContain("[...TRUNCATED]");
  });

  it("should truncate and set truncated flag when over maxLength", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(LONG_ARTICLE_HTML));
    const input = webFetchSchema.parse({ url: "https://example.com", maxLength: 1000 });
    const result = await handleWebFetch(input);

    expect(result.truncated).toBe(true);
    expect(result.content).toContain("[...TRUNCATED]");
  });

  it("should report original contentLength before truncation", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(LONG_ARTICLE_HTML));
    const input = webFetchSchema.parse({ url: "https://example.com", maxLength: 1000 });
    const result = await handleWebFetch(input);

    expect(result.contentLength).toBeGreaterThan(1000);
  });
});

describe("web_fetch - Error Handling", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should throw for non-2xx HTTP status", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse("Not Found", { status: 404, statusText: "Not Found" })
    );
    const input = webFetchSchema.parse({ url: "https://example.com/missing" });

    await expect(handleWebFetch(input)).rejects.toThrow(/HTTP 404/);
  });

  it("should throw for non-HTML content type", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse("binary data", { headers: { "content-type": "application/pdf" } })
    );
    const input = webFetchSchema.parse({ url: "https://example.com/file.pdf" });

    await expect(handleWebFetch(input)).rejects.toThrow(/Unsupported content type/);
  });

  it("should throw on fetch timeout", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new DOMException("The operation was aborted", "AbortError"));
    const input = webFetchSchema.parse({ url: "https://example.com", timeout: 1000 });

    await expect(handleWebFetch(input)).rejects.toThrow();
  });

  it("should throw on network failure", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("fetch failed"));
    const input = webFetchSchema.parse({ url: "https://example.com" });

    await expect(handleWebFetch(input)).rejects.toThrow();
  });

  it("should throw for empty response body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse("   "));
    const input = webFetchSchema.parse({ url: "https://example.com" });

    await expect(handleWebFetch(input)).rejects.toThrow(/Empty response body/);
  });
});

describe("web_fetch - Request Behavior", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should send a User-Agent header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(MINIMAL_HTML));
    const input = webFetchSchema.parse({ url: "https://example.com" });
    await handleWebFetch(input);

    expect(fetch).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        headers: expect.objectContaining({ "User-Agent": expect.any(String) }),
      })
    );
  });

  it("should follow redirects", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(MINIMAL_HTML));
    const input = webFetchSchema.parse({ url: "https://example.com" });
    await handleWebFetch(input);

    expect(fetch).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ redirect: "follow" })
    );
  });
});
