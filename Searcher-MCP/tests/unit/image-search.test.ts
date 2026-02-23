import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockImageSearch = vi.fn();

vi.mock('../../src/services/brave.js', () => ({
  imageSearch: (...args: unknown[]) => mockImageSearch(...args),
}));

import { imageSearchSchema, handleImageSearch } from '../../src/tools/image-search.js';

describe('image-search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('imageSearchSchema', () => {
    it('accepts valid input', () => {
      const result = imageSearchSchema.safeParse({ query: 'cats' });
      expect(result.success).toBe(true);
    });

    it('defaults count to 5 and safesearch to "strict"', () => {
      const result = imageSearchSchema.safeParse({ query: 'cats' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.count).toBe(5);
        expect(result.data.safesearch).toBe('strict');
      }
    });

    it('clamps count below 1 to 1', () => {
      const result = imageSearchSchema.safeParse({ query: 'cats', count: -5 });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.count).toBe(1);
    });

    it('clamps count above 20 to 20', () => {
      const result = imageSearchSchema.safeParse({ query: 'cats', count: 50 });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.count).toBe(20);
    });

    it('only allows "off" or "strict" for safesearch', () => {
      const moderate = imageSearchSchema.safeParse({ query: 'cats', safesearch: 'moderate' });
      expect(moderate.success).toBe(false);

      const off = imageSearchSchema.safeParse({ query: 'cats', safesearch: 'off' });
      expect(off.success).toBe(true);

      const strict = imageSearchSchema.safeParse({ query: 'cats', safesearch: 'strict' });
      expect(strict.success).toBe(true);
    });
  });

  describe('handleImageSearch', () => {
    it('maps Brave results to ImageSearchResult format', async () => {
      mockImageSearch.mockResolvedValueOnce({
        query: { original: 'cats' },
        results: [
          {
            title: 'Cute Cat',
            url: 'https://example.com/cats',
            properties: { url: 'https://img.example.com/cat.jpg' },
            thumbnail: { src: 'https://img.example.com/cat_thumb.jpg' },
            source: 'example.com',
          },
        ],
      });

      const input = imageSearchSchema.parse({ query: 'cats' });
      const data = await handleImageSearch(input);

      expect(data.results).toHaveLength(1);
      expect(data.results[0].title).toBe('Cute Cat');
      expect(data.results[0].source_url).toBe('https://example.com/cats');
      expect(data.results[0].image_url).toBe('https://img.example.com/cat.jpg');
      expect(data.results[0].thumbnail_url).toBe('https://img.example.com/cat_thumb.jpg');
      expect(data.results[0].source).toBe('example.com');
      expect(data.total_count).toBe(1);
      expect(data.query).toBe('cats');
    });

    it('handles empty results', async () => {
      mockImageSearch.mockResolvedValueOnce({
        query: { original: 'obscure' },
        results: [],
      });

      const input = imageSearchSchema.parse({ query: 'obscure' });
      const data = await handleImageSearch(input);

      expect(data.results).toEqual([]);
      expect(data.total_count).toBe(0);
    });
  });
});
