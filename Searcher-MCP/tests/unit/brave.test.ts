import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/utils/config.js', () => ({
  getConfig: () => ({
    braveApiKey: 'test-brave-key',
    braveRateLimitMs: 0, // No delay in tests
  }),
}));

import { webSearch, newsSearch, imageSearch } from '../../src/services/brave.js';

describe('brave API client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockJsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      headers: { 'content-type': 'application/json' },
    });
  }

  describe('webSearch', () => {
    it('builds correct URL with query params', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        mockJsonResponse({ query: { original: 'test' }, web: { results: [] } }),
      );

      await webSearch({ query: 'test query', count: 5 });

      const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(calledUrl).toContain('/web/search');
      expect(calledUrl).toContain('q=test+query');
      expect(calledUrl).toContain('count=5');
    });

    it('sends X-Subscription-Token header', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        mockJsonResponse({ query: { original: 'test' }, web: { results: [] } }),
      );

      await webSearch({ query: 'test' });

      const options = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      const headers = options.headers as Record<string, string>;
      expect(headers['X-Subscription-Token']).toBe('test-brave-key');
    });

    it('maps freshness param to Brave format', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        mockJsonResponse({ query: { original: 'test' }, web: { results: [] } }),
      );

      await webSearch({ query: 'test', freshness: 'week' });

      const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(calledUrl).toContain('freshness=pw');
    });

    it('omits undefined params from URL', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        mockJsonResponse({ query: { original: 'test' }, web: { results: [] } }),
      );

      await webSearch({ query: 'test' }); // no freshness, no count

      const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(calledUrl).not.toContain('freshness=');
    });
  });

  describe('newsSearch', () => {
    it('calls /news/search endpoint', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        mockJsonResponse({ query: { original: 'test' }, results: [] }),
      );

      await newsSearch({ query: 'breaking news' });

      const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(calledUrl).toContain('/news/search');
    });
  });

  describe('imageSearch', () => {
    it('calls /images/search endpoint', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        mockJsonResponse({ query: { original: 'test' }, results: [] }),
      );

      await imageSearch({ query: 'cats' });

      const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(calledUrl).toContain('/images/search');
    });
  });

  describe('error handling', () => {
    it('throws on non-2xx response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response('Rate limit exceeded', { status: 429, statusText: 'Too Many Requests' }),
      );

      await expect(webSearch({ query: 'test' })).rejects.toThrow(/429/);
    });

    it('includes error body in thrown message', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response('{"error": "invalid key"}', { status: 401, statusText: 'Unauthorized' }),
      );

      await expect(webSearch({ query: 'test' })).rejects.toThrow(/invalid key/);
    });
  });

  describe('rate limiting', () => {
    it('calls fetch after rate limit wait', async () => {
      const body = { query: { original: 'test' }, web: { results: [] } };
      vi.mocked(fetch)
        .mockResolvedValueOnce(mockJsonResponse(body))
        .mockResolvedValueOnce(mockJsonResponse(body));

      await webSearch({ query: 'first' });
      await webSearch({ query: 'second' });

      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });
});
