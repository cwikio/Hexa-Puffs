Analyze this conversation and extract NEW facts about the user that are not already known.
{{USER_IDENTITY}}{{KNOWN_FACTS}}
Conversation:
{{CONVERSATION}}

Extract facts in these categories:
- preference: What the user likes, dislikes, or prefers
- background: Information about who the user is (location, job, age, etc.)
- pattern: Behavioral patterns you observe
- project: Current work or projects mentioned
- contact: People mentioned by name (with any context like role, email, etc.)
- decision: Choices the user made

Rules:
- Only extract CLEAR, EXPLICIT facts stated or strongly implied in the conversation
- Facts must be standalone (understandable without the conversation)
- Skip generic statements that aren't user-specific
- Skip facts that overlap with the already known facts listed above
- Maximum 5 facts per extraction
- Confidence: 0.9+ for explicitly stated facts, 0.7-0.9 for strongly implied
- Temporal facts (meetings, appointments, schedules) should use LOW confidence (0.5-0.6) — they expire quickly
- If a new fact contradicts a known fact, extract the correction with HIGH confidence (0.9+)
- Prefer extracting durable contact details (email, phone, role, company) over transient schedule data

Return ONLY valid JSON in this exact format:
{
  "facts": [
    {"fact": "...", "category": "...", "confidence": 0.9}
  ]
}

If no NEW facts can be extracted, return: {"facts": []}