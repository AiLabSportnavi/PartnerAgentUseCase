# A Workflow for Testing Any Agent in Mastra Studio

This is a reusable playbook — drop in any agent, follow the phases. It combines the tutorial pattern with what the Mastra docs say about observability (tracing + logging + metrics) and evals (scorers + sampling + Studio).

---

## Phase 1 — Foundation (one-time per project)

### Step 1. Install the packages

```bash
npm install @mastra/observability @mastra/evals @mastra/libsql @mastra/duckdb
```

`@mastra/observability` gives you traces, log forwarding, and metrics. `@mastra/evals` gives you scorers. DuckDB is needed if you want metrics aggregation (LibSQL alone handles traces and logs).

### Step 2. Configure storage

If you only need traces/logs, LibSQL is enough. If you want metrics dashboards too, use a **composite store** that routes the `observability` domain to DuckDB:

```ts
storage: new MastraCompositeStore({
  id: 'composite-storage',
  default: new LibSQLStore({ id: 'mastra-storage', url: 'file:./mastra.db' }),
  domains: {
    observability: await new DuckDBStore().getStore('observability'),
  },
}),
```

### Step 3. Configure observability on the Mastra instance

```ts
observability: new Observability({
  configs: {
    default: {
      serviceName: 'my-service',
      exporters: [
        new MastraStorageExporter(),    // local Studio
        new MastraPlatformExporter(),   // hosted Studio (if token set)
      ],
      spanOutputProcessors: [
        new SensitiveDataFilter(),      // redact secrets before they hit storage
      ],
    },
  },
}),
```

You now have all three signals: **tracing** (every span), **logging** (auto-correlated to traces), **metrics** (duration, tokens, cost — derived from spans).

---

## Phase 2 — Wire the agent for testing

### Step 4. Decide what "good" means for this agent

Before writing any scorer, write down the failure modes you care about. Common categories from the docs:

- **Textual** — answer relevancy, faithfulness, hallucination, completeness, tool trajectory
- **Classification** — does it pick the right category / route?
- **Prompt engineering** — does a new prompt actually beat the old one?

Each failure mode becomes a scorer.

### Step 5. Pick built-in or custom scorers

- **Built-in** (fast path) — import from `@mastra/evals/scorers/prebuilt`. Use for generic concerns like answer relevancy, toxicity, faithfulness.
- **Custom** (the tutorial path) — use `createScorer` with `preprocess` → `analyze` → `generateScore` → `generateReason` when the criterion is domain-specific (e.g. "is this action item grounded in the transcript").

### Step 6. Attach scorers to the agent with a sampling rate

```ts
export const myAgent = new Agent({
  // ...
  scorers: {
    relevancy: {
      scorer: createAnswerRelevancyScorer({ model: 'openai/gpt-5-mini' }),
      sampling: { type: 'ratio', rate: 1 },     // dev: score everything
    },
    domainCheck: {
      scorer: myCustomScorer,
      sampling: { type: 'ratio', rate: 0.25 },  // prod: sample 25%
    },
  },
})
```

Sampling rule of thumb: **`rate: 1` while iterating**, drop to `0.1–0.25` in production. Scorers run asynchronously, so they don't slow the agent down.

### Step 7. Register scorers on the Mastra instance

This is the step most people skip — and it's what unlocks **scoring historical traces** from inside Studio:

```ts
export const mastra = new Mastra({
  // ...storage, observability above...
  scorers: {
    relevancy: relevancyScorer,
    domainCheck: myCustomScorer,
  },
})
```

---

## Phase 3 — Baseline run and inspection in Studio

### Step 8. Run the agent in Studio with a representative input

Use a real or fixture input that exercises the behavior you want to test (in the tutorial: a meeting transcript).

### Step 9. Walk the trace, top to bottom

Open **Observability → Traces** and click the run. Check, in this order:

1. **Agent span** — input, final output, instructions, tools available.
2. **LLM call spans** — model, latency, token counts. Watch for slow or repeated calls.
3. **Tool spans** — exact inputs and outputs. This is where most "why did it do that?" answers live.
4. **Memory / workspace spans** — what context did it actually retrieve?

### Step 10. Open the score for that run

Go to **Observability → Scores → [your scorer]**, click the run. You get:

- The numeric score (mean of per-item scores for custom scorers)
- The judge's reason
- The exact prompt the judge saw
- A button to **save the result as a dataset item** for future experiments

### Step 11. (Optional) Score historical traces

In Studio's Observability section you can run any registered scorer against any past trace or span. Useful for backfilling evaluations after writing a new scorer, or for grading a production failure you only noticed later.

---

## Phase 4 — Iterate (the flywheel)

### Step 12. Diagnose from the score's reason

The judge's justification tells you whether the failure is in the **prompt** (vague rules), the **tools** (wrong inputs/outputs), the **model** (capability gap), or the **scorer itself** (criteria too strict/loose).

### Step 13. Make one change at a time

- Tighten the prompt (the tutorial's v1 → v2 fix).
- Swap or add a tool.
- Change the model.
- Adjust the scorer rubric.

Single-variable changes keep the eval signal interpretable.

### Step 14. Re-run and compare in the **Evaluate tab**

On any agent, the Evaluate tab lets you attach/detach scorers, manage datasets, and run experiments. Experiment results show per-item scores with **pass/fail status and version tags** — so you can prove v2 beats v1 instead of guessing.

### Step 15. Build a dataset, then a CI check

- Every notable production failure → save the trace as a dataset item (Step 10).
- Every fix → add the corrected behavior to the dataset.
- Wire scorers into CI (`@mastra/evals` supports this) so regressions fail the build before they ship.

---

## Quick-reference checklist

| Phase | Step | Done when… |
|---|---|---|
| Foundation | Storage + observability configured | Traces appear in Studio |
| Foundation | `SensitiveDataFilter` added | Secrets redacted in spans |
| Wire-up | Scorers attached to agent | Scores appear after each run |
| Wire-up | Scorers registered on Mastra instance | You can score historical traces from Studio |
| Baseline | Trace walked, score read | You know *why* the run scored what it did |
| Iterate | Failure saved to dataset | Same input is now part of your eval set |
| Iterate | Experiment run in Evaluate tab | v2 has measurably higher score than v1 |
| Iterate | Scorers in CI | A bad PR fails before merge |

---

Want me to turn this into a markdown file you can drop in your repo, or generate a starter `scorer.ts` template you can adapt for any agent? 