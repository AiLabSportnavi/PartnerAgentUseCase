import { createWorkflow } from "@mastra/core/workflows";
import { WorkflowInputSchema, WorkflowOutputSchema } from "./schemas";
import { enhanceStep } from "./steps/enhanceStep";
import { searchStep } from "./steps/searchStep";
import { rerankStep } from "./steps/rerankStep";
import { respondStep } from "./steps/respondStep";

/**
 * Partner Search Workflow v3 — RAG Pipeline
 *
 * 4-step pipeline with memory feedback:
 *   1. Enhance  — Rewrites query using session context, classifies intent
 *   2. Search   — Hybrid BM25+vector search with self-correction cascade
 *   3. Rerank   — LLM scores candidates by relevance (skips if ≤5)
 *   4. Respond  — LLM formats answer, returns memory payload for next turn
 */
export const partnerWorkflow = createWorkflow({
  id: "partner-search-workflow",
  inputSchema: WorkflowInputSchema,
  outputSchema: WorkflowOutputSchema,
})
  .then(enhanceStep)
  .then(searchStep)
  .then(rerankStep)
  .then(respondStep)
  .commit();
