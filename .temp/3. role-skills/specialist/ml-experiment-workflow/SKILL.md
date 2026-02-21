---
name: ml-experiment-workflow
description: >
  Coordinate ML and AI experiment lifecycles: hypothesis definition, data
  preparation, model training/evaluation, prompt engineering, and deployment.
  Activate when asked about ML experiments, model evaluation, prompt
  engineering workflow, LLM integration, RAG pipeline setup, embedding
  generation, A/B testing AI features, or AI agent development. Also use
  when asked to "run an experiment", "evaluate this model", "set up RAG",
  "test prompts", or "deploy an AI feature".
---

## Overview

This skill orchestrates the lifecycle of ML/AI experiments from hypothesis to deployment. It is adapted for applied AI — integrating LLMs, building RAG pipelines, evaluating prompts, and deploying AI features — not training foundation models.

This skill operates in 3 modes:

| Mode | When to Use | Output |
|------|------------|--------|
| **Design** | Planning a new experiment or AI feature | Experiment plan with hypothesis, metrics, and success criteria |
| **Execute** | Running the experiment (data prep, implementation, evaluation) | Working implementation with evaluation results |
| **Evaluate** | Analyzing results and deciding next steps | Decision: ship, iterate, or abandon |

## Core Principles

1. **Hypothesis first.** Every experiment starts with a testable hypothesis: "If we [change], then [metric] will [improve/change] because [reason]." Without this, you are exploring, not experimenting.

2. **Measure before building.** Define success metrics and establish a baseline BEFORE implementing. If you cannot measure it, you cannot evaluate it.

3. **One variable at a time.** Change one thing per experiment. If you change the model AND the prompt AND the retrieval strategy simultaneously, you cannot attribute improvement to any specific change.

4. **Phase gates.** Never proceed to the next phase without verifying the current phase's output. A flawed dataset produces meaningless evaluation results regardless of model quality.

## Building Blocks

### Data Preparer

**Purpose:** Prepare, clean, and validate datasets for training or evaluation.
**Input:** Raw data sources (documents, databases, APIs).
**Output:** Cleaned dataset with validation report.

Use for: RAG document ingestion, evaluation dataset creation, training data preparation.

### Evaluator

**Purpose:** Run systematic evaluation against defined metrics.
**Input:** Model/system output + ground truth or evaluation criteria.
**Output:** Quantitative scores and qualitative analysis.

Use for: Prompt comparison, RAG retrieval quality, model output quality assessment.

### Deployer

**Purpose:** Ship the experiment result to production with monitoring.
**Input:** Validated model/prompt/pipeline configuration.
**Output:** Deployed feature with metrics tracking.

Use for: Feature flag rollout, A/B testing, gradual deployment.

## Mode: Design

### Phase 1: Define the Experiment

1.1. **State the hypothesis**

```markdown
## Experiment: [Name]

**Hypothesis:** If we [specific change], then [metric] will [expected outcome]
because [reasoning].

**Example:**
If we switch from semantic search to hybrid search (semantic + keyword) for the
RAG pipeline, then answer relevance will improve by 15%+ because many user
queries contain exact terminology that semantic similarity misses.
```

1.2. **Define metrics**

| Metric | Measurement Method | Baseline | Target |
|--------|-------------------|----------|--------|
| Primary metric | How to measure it | Current value | Success threshold |
| Secondary metric | How to measure it | Current value | Acceptable range |
| Guardrail metric | How to measure it | Current value | Must not degrade |

1.3. **Define the evaluation dataset**

- Minimum 50 test cases for quantitative evaluation
- Include edge cases: empty input, very long input, ambiguous queries, adversarial input
- Split: 80% evaluation, 20% holdout (for final validation)

**Phase gate — before proceeding to Execute, verify:**
- [ ] Hypothesis is testable and specific
- [ ] Metrics are defined with baseline and target values
- [ ] Evaluation dataset exists or plan to create it is documented
- [ ] Success criteria are unambiguous

## Mode: Execute

### Phase 2: Implement

2.1. **Set up the experiment workspace**

```
experiments/
├── [experiment-name]/
│   ├── README.md           ← Hypothesis, metrics, results
│   ├── data/               ← Evaluation dataset
│   ├── src/                ← Implementation code
│   ├── results/            ← Evaluation outputs
│   └── config.json         ← Model/prompt/pipeline configuration
```

2.2. **Implement the change**

For each experiment type:

**Prompt engineering:**

```typescript
// Store prompts as versioned configurations
const promptVersions = {
  v1: {
    system: "You are a helpful assistant...",
    template: "Given the context: {context}\n\nAnswer: {question}",
  },
  v2: {
    system: "You are a precise assistant that cites sources...",
    template: "Context:\n{context}\n\nQuestion: {question}\n\nAnswer with citations:",
  },
}
```

**RAG pipeline:**

```typescript
// Using LlamaIndex for document ingestion and retrieval
import { VectorStoreIndex, SimpleDirectoryReader } from 'llamaindex'

// 1. Load documents
const documents = await new SimpleDirectoryReader().loadData('data/')

// 2. Create index with embeddings
const index = await VectorStoreIndex.fromDocuments(documents)

// 3. Query
const queryEngine = index.asQueryEngine()
const response = await queryEngine.query('user question')
```

**LLM integration:**

```typescript
// Using Vercel AI SDK with Groq
import { generateText } from 'ai'
import { groq } from '@ai-sdk/groq'

const result = await generateText({
  model: groq('llama-3.3-70b-versatile'),
  system: promptVersions.v2.system,
  prompt: formattedPrompt,
  temperature: 0.3, // Lower for consistency in evaluation
})
```

2.3. **Run evaluation**

```typescript
// Evaluation loop
const results = []
for (const testCase of evaluationDataset) {
  const output = await runExperiment(testCase.input)
  const score = await evaluate(output, testCase.expected)
  results.push({ input: testCase.input, output, expected: testCase.expected, score })
}

// Compute aggregate metrics
const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length
console.log(`Average score: ${avgScore}`)
```

**Phase gate — before proceeding to Evaluate, verify:**
- [ ] Implementation is complete and runs without errors
- [ ] Evaluation ran on the full dataset (not a subset)
- [ ] Results are saved to the experiment workspace
- [ ] No data leakage between training/evaluation sets

## Mode: Evaluate

### Phase 3: Analyze and Decide

3.1. **Compare to baseline**

| Metric | Baseline | Experiment | Delta | Target Met? |
|--------|----------|-----------|-------|-------------|
| Primary metric | X | Y | +/- Z | Yes/No |
| Secondary metric | X | Y | +/- Z | Yes/No |
| Guardrail metric | X | Y | +/- Z | Not degraded? |

3.2. **Decision framework**

```
Primary metric meets target?
│
├─ YES → Guardrail metrics maintained?
│  ├─ YES → SHIP — Deploy to production with monitoring
│  └─ NO → ITERATE — Fix guardrail regression, re-evaluate
│
└─ NO → Significant improvement (> 5% above baseline)?
   ├─ YES → ITERATE — Refine approach, run next experiment
   └─ NO → ABANDON — Document learnings, try different approach
```

3.3. **Document results**

Update the experiment README with:
- Final metric values
- Decision (ship / iterate / abandon)
- Key learnings for future experiments
- If shipping: deployment plan and monitoring setup

### Phase 4: Deploy (if shipping)

4.1. Use PostHog feature flags for gradual rollout:
- 10% of users → monitor for 24 hours
- 50% → monitor for 48 hours
- 100% → full rollout

4.2. Monitor post-deployment:
- Track the same metrics used in evaluation
- Set up PostHog alerts for metric degradation
- Keep the old version available for instant rollback via feature flag

**Phase gate — before declaring the experiment complete:**
- [ ] Results documented in experiment README
- [ ] Decision made and recorded (ship/iterate/abandon)
- [ ] If shipping: feature flag configured, monitoring set up
- [ ] Learnings shared with team

## Experiment Types Quick Reference

| Type | Tools | Key Metric | Typical Approach |
|------|-------|-----------|-----------------|
| Prompt engineering | Vercel AI SDK, Groq | Output quality score | A/B test prompt versions |
| RAG quality | LlamaIndex, sqlite-vec | Retrieval relevance, answer accuracy | Vary chunking, embedding, retrieval |
| Model selection | Vercel AI SDK | Quality vs latency vs cost | Benchmark same prompts across models |
| Agent behavior | MCP, ReAct | Task completion rate | Test tool selection and reasoning |
| Feature A/B test | PostHog | User engagement metric | Feature flag with random split |

## Anti-Patterns

❌ **Anti-pattern: Vibes-Based Evaluation**
Problem: "The output looks better" is not a metric. Without quantitative evaluation, you cannot compare experiments, detect regressions, or justify decisions.
✅ Solution: Define numeric metrics before running the experiment. Use scoring rubrics for subjective quality. Compare against a baseline with statistical significance (minimum 50 test cases).

❌ **Anti-pattern: Evaluating on Training Data**
Problem: Testing the RAG pipeline on documents that were used to build the index. The system "remembers" the answers, producing artificially high scores that don't reflect real-world performance.
✅ Solution: Maintain a strict separation between data used for building (training/index) and data used for evaluation. The evaluation dataset should contain questions the system has not seen during setup.

❌ **Anti-pattern: Changing Everything at Once**
Problem: New model + new prompt + new retrieval strategy in one experiment. The result improves — but which change caused it? Next experiment removes the model change and performance drops. Was it the model or an interaction effect?
✅ Solution: One variable per experiment. Compare v1 prompt vs v2 prompt on the SAME model. Compare Model A vs Model B with the SAME prompt. Isolate variables to build understanding.

❌ **Anti-pattern: No Monitoring After Deployment**
Problem: The experiment succeeded in evaluation, so it ships to 100% of users immediately. Two weeks later, someone notices quality has degraded because the real-world input distribution is different from the evaluation dataset.
✅ Solution: Gradual rollout with monitoring. Use feature flags (PostHog) to ramp from 10% → 50% → 100%. Track the same metrics in production that you measured in evaluation. Set alerts for degradation.

## Stack Adaptation

Before running experiments, read `tech-stack-preferences.md` for the user's actual stack. Apply these substitutions:
- **LLM provider** → use Groq (llama-3.3-70b-versatile) and Anthropic (Claude) from preferences
- **AI SDK** → use Vercel AI SDK (`ai` package) with `@ai-sdk/groq` from preferences
- **Embeddings** → use sqlite-vec from preferences for local/agent projects
- **RAG** → use LlamaIndex (@llamaindex/core) from preferences
- **Vector store** → use sqlite-vec (agents) or pgvector (web) from preferences
- **Agent framework** → use MCP + Vercel AI SDK ReAct from preferences
- **Feature flags** → use PostHog from preferences for A/B testing and gradual rollout
- **Background jobs** → use Inngest from preferences for long-running training/evaluation tasks

## Integration with Other Skills

- **architecture-decisions** — When choosing between ML architectures (RAG vs fine-tuning, model selection, embedding strategies).
- **ci-cd-pipelines** — For automating experiment evaluation in CI and deploying ML features.
- **diagnostic-debugging** — When an ML pipeline produces unexpected results or errors.
- **infrastructure-ops** — For provisioning compute resources, managing model endpoints, and configuring vector databases.
- **test-strategy** — For designing evaluation datasets and quality assurance for AI features.
