import { describe, it, expect, vi } from 'vitest';
import { extractFactsFromConversation } from '../../src/agent/fact-extractor.js';
import type { LanguageModelV1 } from 'ai';

/**
 * Create a mock LanguageModelV1 that returns the given text.
 * Mimics the shape expected by generateText().
 */
function createMockModel(responseText: string): LanguageModelV1 {
  return {
    specificationVersion: 'v1',
    provider: 'test',
    modelId: 'test-model',
    defaultObjectGenerationMode: undefined,
    supportsImageUrls: false,
    doGenerate: vi.fn().mockResolvedValue({
      text: responseText,
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 10 },
      rawCall: { rawPrompt: '', rawSettings: {} },
    }),
    doStream: vi.fn(),
  } satisfies LanguageModelV1;
}

const sampleMessages = [
  { role: 'user', content: 'Can you send an email to my colleague Jan at jan@example.com?' },
  { role: 'assistant', content: 'Done — I sent the email to Jan.' },
  { role: 'user', content: 'Thanks! I prefer emails in Polish when writing to Jan.' },
  { role: 'assistant', content: 'Noted, I will write to Jan in Polish next time.' },
];

describe('extractFactsFromConversation', () => {
  it('should extract facts from a valid LLM response', async () => {
    const model = createMockModel(JSON.stringify({
      facts: [
        { fact: 'Jan is a colleague with email jan@example.com', category: 'contact', confidence: 0.95 },
        { fact: 'Prefers emails to Jan in Polish', category: 'preference', confidence: 0.9 },
      ],
    }));

    const result = await extractFactsFromConversation(model, sampleMessages, []);

    expect(result).toHaveLength(2);
    expect(result[0].fact).toBe('Jan is a colleague with email jan@example.com');
    expect(result[0].category).toBe('contact');
    expect(result[0].confidence).toBe(0.95);
    expect(result[1].category).toBe('preference');
  });

  it('should filter facts below confidence threshold', async () => {
    const model = createMockModel(JSON.stringify({
      facts: [
        { fact: 'High confidence fact', category: 'background', confidence: 0.9 },
        { fact: 'Low confidence fact', category: 'pattern', confidence: 0.5 },
      ],
    }));

    const result = await extractFactsFromConversation(model, sampleMessages, [], 0.7);

    expect(result).toHaveLength(1);
    expect(result[0].fact).toBe('High confidence fact');
  });

  it('should return empty array when no facts extracted', async () => {
    const model = createMockModel(JSON.stringify({ facts: [] }));

    const result = await extractFactsFromConversation(model, sampleMessages, []);

    expect(result).toHaveLength(0);
  });

  it('should return empty array for too few messages', async () => {
    const model = createMockModel(JSON.stringify({
      facts: [{ fact: 'Should not appear', category: 'background', confidence: 0.9 }],
    }));

    // Only 2 messages (1 exchange) — below the 4-message minimum
    const shortConvo = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
    ];

    const result = await extractFactsFromConversation(model, shortConvo, []);

    expect(result).toHaveLength(0);
    // Model should not have been called
    expect(model.doGenerate).not.toHaveBeenCalled();
  });

  it('should handle LLM response wrapped in markdown code fences', async () => {
    const model = createMockModel('```json\n{"facts": [{"fact": "Lives in Krakow", "category": "background", "confidence": 0.9}]}\n```');

    const result = await extractFactsFromConversation(model, sampleMessages, []);

    expect(result).toHaveLength(1);
    expect(result[0].fact).toBe('Lives in Krakow');
  });

  it('should return empty array on invalid JSON response', async () => {
    const model = createMockModel('I could not extract any facts from this conversation.');

    const result = await extractFactsFromConversation(model, sampleMessages, []);

    expect(result).toHaveLength(0);
  });

  it('should return empty array on malformed JSON', async () => {
    const model = createMockModel('{"facts": [{"fact": "missing fields"}]}');

    const result = await extractFactsFromConversation(model, sampleMessages, []);

    expect(result).toHaveLength(0);
  });

  it('should limit to 5 facts maximum', async () => {
    const model = createMockModel(JSON.stringify({
      facts: Array.from({ length: 8 }, (_, i) => ({
        fact: `Fact number ${i + 1}`,
        category: 'background',
        confidence: 0.9,
      })),
    }));

    const result = await extractFactsFromConversation(model, sampleMessages, []);

    expect(result).toHaveLength(5);
  });

  it('should gracefully handle model errors', async () => {
    const model = createMockModel('');
    vi.mocked(model.doGenerate).mockRejectedValue(new Error('API rate limit'));

    const result = await extractFactsFromConversation(model, sampleMessages, []);

    expect(result).toHaveLength(0);
  });

  it('should pass known facts to the prompt for dedup context', async () => {
    const model = createMockModel(JSON.stringify({ facts: [] }));

    const knownFacts = [
      'Jan is a colleague (contact)',
      'Prefers dark mode (preference)',
    ];

    await extractFactsFromConversation(model, sampleMessages, knownFacts);

    // Verify the prompt contains known facts
    const callArgs = vi.mocked(model.doGenerate).mock.calls[0][0];
    const promptContent = JSON.stringify(callArgs.prompt);
    expect(promptContent).toContain('Jan is a colleague');
    expect(promptContent).toContain('Prefers dark mode');
    expect(promptContent).toContain('DO NOT extract these again');
  });

  it('should include conversation content in the prompt', async () => {
    const model = createMockModel(JSON.stringify({ facts: [] }));

    await extractFactsFromConversation(model, sampleMessages, []);

    const callArgs = vi.mocked(model.doGenerate).mock.calls[0][0];
    const promptContent = JSON.stringify(callArgs.prompt);
    expect(promptContent).toContain('jan@example.com');
    expect(promptContent).toContain('Polish');
  });

  it('should reject facts with invalid categories', async () => {
    const model = createMockModel(JSON.stringify({
      facts: [
        { fact: 'Valid fact', category: 'background', confidence: 0.9 },
        { fact: 'Invalid category', category: 'invalid_category', confidence: 0.9 },
      ],
    }));

    // zod validation will reject the invalid category, causing the whole parse to fail
    const result = await extractFactsFromConversation(model, sampleMessages, []);

    // The entire response fails validation since one fact has invalid category
    expect(result).toHaveLength(0);
  });
});
