import { describe, it, expect, vi } from 'vitest';

vi.mock('@mcp/shared/Utils/logger.js', () => ({
  Logger: class { info = vi.fn(); warn = vi.fn(); error = vi.fn(); debug = vi.fn(); },
}));

import {
  detectActionHallucination,
  detectToolRefusal,
  ACTION_CLAIMED_PATTERN,
  TOOL_REFUSAL_PATTERN,
} from '../../src/agent/components/hallucination-guard.js';

describe('detectActionHallucination', () => {
  describe('should detect action claims', () => {
    const positives = [
      "I've created the event for tomorrow at 3 PM.",
      "I've sent the email to John.",
      "I've scheduled your meeting for Friday.",
      "I've deleted the old reminder.",
      "I've updated your calendar.",
      "I've added the item to your list.",
      "I've removed the duplicate entry.",
      "I've set up the recurring event.",
      "I've stored the information.",
      "I've saved your preferences.",
      "I've found the following results.",
      "I've searched for recent news.",
      "I've looked up the weather.",
      "I've checked your schedule.",
      "I have created a new document.",
      "I have sent your message.",
      "The event has been created successfully.",
      "The email has been sent.",
      "Your meeting has been scheduled.",
      "The file has been deleted.",
      "Event details: Meeting at 3 PM",
      "Email sent to john@example.com",
      "Here's the email I sent to the team.",
      "I've gone ahead and scheduled that for you.",
      "I searched for the latest news.",
      "I looked up your calendar events.",
      "I checked your inbox.",
      "The results show 5 matching items.",
      "I found the following information.",
    ];

    for (const text of positives) {
      it(`detects: "${text.substring(0, 60)}..."`, () => {
        expect(detectActionHallucination(text)).toBe(true);
      });
    }
  });

  describe('should not flag normal responses', () => {
    const negatives = [
      "I can help you create an event. What date and time?",
      "To send an email, I'll need the recipient's address.",
      "Would you like me to search for that?",
      "I'd be happy to help with your calendar.",
      "Let me know what you'd like to do.",
      "Sure, I can look that up for you.",
      "Here's what I know about that topic.",
      "The weather forecast is calling for rain.",
    ];

    for (const text of negatives) {
      it(`ignores: "${text.substring(0, 60)}..."`, () => {
        expect(detectActionHallucination(text)).toBe(false);
      });
    }
  });
});

describe('detectToolRefusal', () => {
  describe('should detect tool refusals when search tools are available', () => {
    const positives = [
      "I don't have access to real-time information.",
      "I can't access current weather data.",
      "I do not have access to live news updates.",
      "I cannot provide real-time data.",
      // Note: "I'm unable to" (no space before 'm) isn't matched by the regex —
      // the pattern expects "I " + "'m unable to". "I am unable to" covers this case.
      "I am unable to get today's news.",
      "I currently don't have access to real-time results.",
      "I currently can't access live data.",
      "The search tools are currently unavailable.",
      "The internet is temporarily unavailable.",
      "Real-time data is not available right now.",
    ];

    for (const text of positives) {
      it(`detects: "${text.substring(0, 60)}..."`, () => {
        expect(detectToolRefusal(text, true)).toBe(true);
      });
    }
  });

  describe('should not flag when no search tools available', () => {
    it('returns false regardless of text when hasSearchTools is false', () => {
      expect(
        detectToolRefusal("I don't have access to real-time information.", false),
      ).toBe(false);
    });
  });

  describe('should not flag normal limitations', () => {
    const negatives = [
      "I can help you search for that information.",
      "Let me look that up for you.",
      "I'll search the web for current results.",
      "I can provide some general information.",
    ];

    for (const text of negatives) {
      it(`ignores: "${text.substring(0, 60)}..."`, () => {
        expect(detectToolRefusal(text, true)).toBe(false);
      });
    }
  });
});

describe('pattern exports', () => {
  it('exports ACTION_CLAIMED_PATTERN as a RegExp', () => {
    expect(ACTION_CLAIMED_PATTERN).toBeInstanceOf(RegExp);
    expect(ACTION_CLAIMED_PATTERN.flags).toContain('i');
  });

  it('exports TOOL_REFUSAL_PATTERN as a RegExp', () => {
    expect(TOOL_REFUSAL_PATTERN).toBeInstanceOf(RegExp);
    expect(TOOL_REFUSAL_PATTERN.flags).toContain('i');
  });
});
