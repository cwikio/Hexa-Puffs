---
name: requirements-gathering
description: >
  Structured requirements gathering through guided dialogue. Walk stakeholders
  through a multi-turn conversation to extract functional requirements,
  non-functional requirements, constraints, user stories, and acceptance
  criteria. Delivers a structured requirements document. Activate when a user
  says "requirements gathering", "scope a feature", "what should I build",
  "project requirements", "feature spec", "user stories", "acceptance criteria",
  "help me define requirements", "spec out this project", or wants to move
  from idea to structured specification.
---

# Requirements Gathering Guide

This skill guides a structured conversation to extract software requirements from stakeholders and produce a comprehensive requirements document. The value is in the questions asked and how answers shape the output -- not in a fixed template.

## Conversation Purpose

**Goals:**
1. Understand the project context, motivation, and stakeholders
2. Extract functional requirements with user flows and edge cases
3. Surface non-functional requirements (performance, security, scalability, accessibility)
4. Identify constraints that bound the solution space
5. Deliver a structured requirements document ready for development planning

**Typical conversation length:** 12-20 exchanges (questions + answers), across 5 phases.

**Minimum viable conversation:** If the user is short on time, these 3 questions yield a useful (if incomplete) document:
1. What are you building and who is it for?
2. What are the 3-5 most important things it must do?
3. What are your hard constraints (timeline, budget, technology)?

Mark any gaps in the output as "[NEEDS INPUT]" and list them in Open Questions.

## Conversation Flow

```
Phase 1: Context & Motivation          (2-3 questions)
    |
Phase 2: Functional Requirements       (3-6 questions, branches by project type)
    |         |           |           |
    |     New Feature  Enhancement  Migration/Integration
    |         |           |           |
    |         v           v           v
    |     (branch-specific questions)
    |
Phase 3: Non-Functional Requirements   (2-4 questions)
    |
Phase 4: Constraints & Dependencies    (2-3 questions)
    |
Phase 5: Synthesis & Refinement        (generate doc, iterate)
```

**IMPORTANT:** Do NOT ask all questions at once. Reveal questions progressively -- each phase's questions depend on previous answers.

## Phase 1: Context & Motivation

**Goal:** Understand what is being built, for whom, and why now.

**Questions to ask** (ask 2-3 at a time, not all at once):

1. **What are you building? Give me the elevator pitch.**
   - Why this matters: Determines the project type, which drives Phase 2 branching.
   - Follow-up if vague: "Can you describe what a user would see or do when using this?"

2. **Who are the target users? What problem does this solve for them?**
   - Why this matters: Shapes user stories and acceptance criteria.
   - Follow-up if unclear: "Is this for internal teams, external customers, or both?"

3. **Why now? What's driving this work?**
   - Why this matters: Reveals urgency, competitive pressure, or compliance drivers that affect prioritization.
   - If answer is "tech debt" or "migration" -> note for Phase 2 branching to Migration path.
   - If answer is "new product" or "MVP" -> note for Phase 2 branching to New Feature path.

**Phase 1 complete when:** You know the project type (new feature, enhancement, migration, or integration), the target users, and the business motivation.

## Phase 2: Functional Requirements

**Goal:** Extract what the system must do, expressed as user flows, capabilities, and edge cases.

Before asking Phase 2 questions, classify the project type from Phase 1 answers and route accordingly.

### Branch A: New Feature or New Product

Ask these questions:

1. **Walk me through the primary user flow. What does the user do step by step?**
   - Why: This becomes the core user story. Probe for the "happy path" first.
   - Follow-up: "What happens after they complete that? Where do they end up?"

2. **What are the key screens, pages, or interfaces?**
   - Why: Grounds abstract features in concrete UI/API surfaces.
   - If API/backend project: "What are the key endpoints or operations?"

3. **What are the 3-5 features that MUST be in the first release?**
   - Why: Forces prioritization. Prevents scope creep into the requirements doc itself.
   - Follow-up: "What would you cut if you had half the time?"

4. **What happens when things go wrong? Think about error cases, empty states, edge cases.**
   - Why: Edge cases are the #1 source of missed requirements.
   - Offer examples: "For instance: what if a user submits invalid data? What if they lose connectivity? What if they try to access something they don't have permission for?"

5. **Are there any integrations with external systems (APIs, databases, third-party services)?**
   - Why: External dependencies create coupling and risk.

### Branch B: Enhancement to Existing System

Ask these questions:

1. **What does the current system do today? What specifically needs to change?**
   - Why: Establishes the baseline to define delta requirements.

2. **What's broken or missing? Is this fixing a problem or adding capability?**
   - Why: "Fix" vs "add" changes the scope and testing strategy.
   - Follow-up: "Can you show me the current behavior and describe the desired behavior?"

3. **What existing functionality must NOT break?**
   - Why: Regression boundaries are implicit requirements. Making them explicit prevents surprises.

4. **Are there existing users who will be affected by this change? How many?**
   - Why: Affects rollout strategy, migration needs, and backward compatibility requirements.

### Branch C: Migration or Integration

Ask these questions:

1. **What is the source system and what is the target system?**
   - Why: Defines the transformation surface.

2. **What data or functionality needs to move? What can be left behind?**
   - Why: Scopes the migration. "Everything" is never true -- force specifics.

3. **Is there a cutover strategy? Big bang or gradual?**
   - Why: Shapes the technical approach and risk profile.

4. **What is the rollback plan if the migration fails?**
   - Why: Migrations without rollback plans are requirements gaps.

5. **What downstream systems depend on the current system?**
   - Why: Surfaces hidden coupling that can derail timelines.

### For All Branches

After branch-specific questions, always ask:

- **Is there anything I haven't asked about that you know is important?**
  - Why: Stakeholders often hold critical context they assume is obvious.

**Phase 2 complete when:** You have at least 3 concrete user flows or capabilities described, with their primary success and failure paths.

## Phase 3: Non-Functional Requirements

**Goal:** Surface quality attributes that constrain HOW the system works, not WHAT it does.

**Questions** (adapt based on project type -- skip irrelevant ones):

1. **What are the performance expectations?**
   - Offer concrete anchors: "For example: page load under 2 seconds? API response under 200ms? Support 100 concurrent users or 10,000?"
   - If user says "it should be fast": "Fast means different things -- can you give me a number for response time or throughput?"

2. **What are the security requirements?**
   - Offer examples by domain: "For example: authentication method, data encryption, compliance requirements (GDPR, HIPAA, SOC2), role-based access control?"
   - If user says "standard security": "Let me suggest a baseline: HTTPS, hashed passwords, input validation, RBAC. Does that cover it, or is there more?"

3. **How should this scale? What's the expected growth trajectory?**
   - Why: Affects architecture choices today.
   - Follow-up: "What's the user count at launch vs. 12 months out?"

4. **Are there accessibility requirements?**
   - Why: Often forgotten until too late. Worth surfacing early.
   - Offer default: "WCAG 2.1 AA is the standard baseline for web applications. Should we target that?"

5. **What about observability? How will you know if something is broken in production?**
   - Why: Monitoring and alerting are requirements, not afterthoughts.
   - If user says "I don't know": "I'll include standard recommendations for logging, error tracking, and uptime monitoring."

**Phase 3 complete when:** You have explicit or defaulted values for performance, security, scalability, and at least one of accessibility/observability.

## Phase 4: Constraints & Dependencies

**Goal:** Identify boundaries that limit the solution space.

**Questions:**

1. **What's the timeline? Any hard deadlines?**
   - Why: Shapes what can realistically be built. MVP vs full-featured.
   - Follow-up: "Is that deadline movable, or is it tied to an event/contract/launch?"

2. **What's the team composition? Who's building this?**
   - Why: Team size and skill set constrain technology choices and parallelization.
   - Follow-up: "What technologies is the team most experienced with?"

3. **Are there technology constraints? Anything mandated or prohibited?**
   - Why: "Must use Java" or "cannot use cloud services" are hard constraints.
   - If user has no preference: Reference `tech-stack-preferences.md` for alignment with existing stack.

4. **Budget constraints?**
   - Why: Affects build-vs-buy decisions and infrastructure choices.
   - If user says "I don't know": "No worries -- I'll note it as flexible and won't recommend anything expensive without flagging it."

5. **Are there any external dependencies or blockers?**
   - Why: Dependencies on other teams, approvals, or third-party contracts can dominate timelines.
   - Follow-up: "Who or what could delay this project?"

**Phase 4 complete when:** You know the timeline, team, technology constraints, and major external dependencies.

## Stack Adaptation

When generating the requirements document, reference `tech-stack-preferences.md` to align recommendations with the user's existing technology stack. Specifically:

- **Technology suggestions** in the output should prefer tools already in the stack
- **Architecture patterns** should align with existing conventions (e.g., Server Actions vs REST)
- **Testing strategies** should reference the user's testing framework preferences
- **Infrastructure assumptions** should match the user's deployment and hosting setup
- **Security recommendations** should build on existing auth and security patterns

If `tech-stack-preferences.md` is not available or empty, ask the user about their technology preferences during Phase 4 and note them as constraints.

## Pre-Synthesis Check

Before generating the output, verify you have answers for:

**Phase gate -- ALL of these must be known or explicitly marked as "[NEEDS INPUT]":**
- [ ] Project type and elevator pitch
- [ ] Target users and their problem
- [ ] Business motivation and urgency
- [ ] At least 3 functional requirements with success/failure paths
- [ ] Performance expectations (explicit or defaulted)
- [ ] Security requirements (explicit or defaulted)
- [ ] Timeline and team composition
- [ ] Technology constraints

If any item is missing, go back and ask. Do NOT generate output with silent gaps.

**Exception:** If the user explicitly says "just give me what you have," mark gaps as "[NEEDS INPUT]" in the output and list them prominently in Open Questions.

## Synthesis Rules

**CRITICAL:** The output must demonstrably use information from the conversation. Generic requirements after a detailed intake is the primary failure mode of this skill.

### Personalization Mapping

| Gathered Information | How It Affects Output |
|---------------------|----------------------|
| Project type | Determines document structure and emphasis |
| Target users | Drives user story personas and acceptance criteria language |
| Business motivation | Shapes the Summary and prioritization of requirements |
| User flows | Become specific User Stories with acceptance criteria |
| Edge cases discussed | Become explicit acceptance criteria (negative cases) |
| Performance numbers | Become measurable NFRs with specific thresholds |
| Security requirements | Get dedicated section with compliance checklist |
| Timeline | Affects Recommended Next Steps (phasing, MVP scope) |
| Team constraints | Shapes technology and architecture recommendations |
| Technology constraints | Filters all technical suggestions |
| Budget | Affects build-vs-buy recommendations |
| External dependencies | Appear in Constraints and Risk sections |

### Output Template

Before generating, summarize what you gathered and ask: "Did I miss anything or get anything wrong?"

Then generate:

```markdown
# Requirements Document: [Project Name]

**Date:** [date]
**Status:** Draft
**Stakeholder(s):** [who provided input]

## 1. Summary

[2-4 sentences synthesizing what is being built, for whom, and why.
This must reference specific details from the conversation, not generic descriptions.]

## 2. User Stories

[Derived from Phase 2 functional requirements. Use the format:]

### US-[N]: [Story Title]
**As a** [persona from Phase 1],
**I want to** [capability from Phase 2],
**So that** [business value from Phase 1].

**Acceptance Criteria:**
- [ ] [Specific, testable criterion derived from the conversation]
- [ ] [Include both positive and negative cases]
- [ ] [Reference edge cases discussed in Phase 2]

[Repeat for each user flow identified. Aim for 3-8 user stories.]

## 3. Functional Requirements

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-1 | [Specific requirement] | Must Have / Should Have / Nice to Have | [Which part of conversation] |

[Include requirements that don't fit neatly into user stories:
data requirements, integration points, admin capabilities, reporting.]

## 4. Non-Functional Requirements

| Category | Requirement | Target | Rationale |
|----------|-------------|--------|-----------|
| Performance | [Specific metric] | [Threshold from Phase 3] | [Why this number] |
| Security | [Specific control] | [Standard/compliance] | [Requirement source] |
| Scalability | [Growth expectation] | [Numbers from Phase 3] | [Growth trajectory] |
| Accessibility | [Standard] | [Level] | [Requirement or default] |
| Observability | [What to monitor] | [SLA/target] | [Why it matters] |

## 5. Constraints

| Constraint | Type | Impact | Flexibility |
|-----------|------|--------|-------------|
| [Timeline] | Schedule | [How it limits scope] | Hard / Soft |
| [Budget] | Financial | [What it rules out] | Hard / Soft |
| [Team size] | Resource | [What can be parallelized] | Hard / Soft |
| [Technology] | Technical | [What it mandates/prohibits] | Hard / Soft |

## 6. Dependencies & Risks

| Dependency/Risk | Type | Owner | Mitigation |
|----------------|------|-------|------------|
| [External system] | Dependency | [Team/person] | [Fallback plan] |
| [Identified risk] | Risk | [Owner] | [Mitigation strategy] |

## 7. Open Questions

[List anything marked as "[NEEDS INPUT]" or areas where the stakeholder
was uncertain. These are action items for follow-up.]

- [ ] [Question that still needs an answer]
- [ ] [Decision that needs to be made]

## 8. Recommended Next Steps

[Prioritized, actionable steps based on the full conversation context:]

1. [Immediate action — e.g., "Resolve open questions in Section 7"]
2. [Design phase — e.g., "Create wireframes for the 3 core user flows"]
3. [Technical — e.g., "Spike on [integration] to validate feasibility"]
4. [Planning — e.g., "Break User Stories into sprint-sized tasks"]
```

## Conversation Principles

1. **Ask 2-3 questions at a time, maximum.** This is a conversation, not a form. Never dump all questions in a single message.

2. **Acknowledge before asking.** Briefly reflect what you learned before moving to the next question: "Got it -- a multi-tenant SaaS for property managers. That tells me we need to think about data isolation. Let me ask about the core workflows."

3. **Adapt questions based on answers.** If an early answer eliminates a topic, skip those questions. If an answer opens a new area, explore it.

4. **Offer examples when questions are abstract.** Instead of "What are your performance requirements?", try "What are your performance requirements? For example, page load under 2 seconds, or handling 1,000 concurrent users?"

5. **Summarize before synthesizing.** Before generating the document, recap what you gathered and ask "Did I miss anything or get anything wrong?"

6. **Never fabricate requirements.** If the user did not provide a detail, say "You didn't mention [X] -- would you like me to assume a reasonable default, or do you have a preference?"

7. **Respect "I don't know."** Offer reasonable defaults: "No worries -- I'll assume standard REST API patterns unless you prefer otherwise. We can revisit this."

8. **Use the user's language.** If they say "dashboard," don't rewrite it as "analytics visualization surface." Mirror their terminology in the requirements document.

9. **Distinguish must-have from nice-to-have.** When a user lists many features, ask: "If you had to ship with only 3 of these, which 3?" This forces prioritization.

10. **Keep the conversation moving.** If a question isn't yielding useful information after one follow-up, note the gap and move on. You can always return to it.

## Recovery Patterns

| Situation | Recovery |
|-----------|----------|
| **Vague answers** ("it should be good") | Offer specific options: "When you say 'good performance', do you mean <2s page loads, <500ms API responses, or something else?" |
| **Scope creep** (user keeps adding features) | "Those are great ideas. Let me capture them, but let's also flag: which of these are must-haves for the first release vs. future iterations?" |
| **Contradictions** ("it must be real-time" + "batch processing is fine") | "I noticed these might pull in different directions. Help me understand: is real-time needed for [specific flow], while batch is fine for [other flow]?" |
| **Skipping ahead** ("just give me the doc") | "I want to make sure the document is actually useful. Two more quick questions about [topic] will make a big difference in the output quality." |
| **User doesn't know the answer** | "That's fine -- I'll flag it as an open question in the document so your team can decide later. For now, I'll assume [reasonable default]." |
| **Stakeholder disagrees with themselves** | "Earlier you mentioned [X], but now it sounds like [Y]. Which one should I go with, or has your thinking evolved?" |
| **Too many stakeholders in the room** | "I'm hearing a few different perspectives on [topic]. Let me capture all of them and flag it as a decision point in the document." |
| **User provides a wall of text** | Parse it, extract the requirements, summarize back: "Let me make sure I got this right: [summary]. Anything I missed?" |

## Phase 5: Refinement

After delivering the requirements document:

1. Ask: "Does this capture what you need? Anything to add, change, or remove?"
2. If refinement requested -> modify specific sections, don't regenerate the entire document
3. If major changes -> revisit the relevant conversation phase, gather new information, and update the affected sections
4. If the user wants to add more user stories -> slot them into the existing structure with consistent numbering
5. When the user is satisfied, remind them: "This is a living document. Update it as requirements evolve. The Open Questions section is your immediate follow-up checklist."
