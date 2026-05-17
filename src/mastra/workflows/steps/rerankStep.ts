import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { SearchOutputSchema, RerankOutputSchema } from "../schemas";
import type { SearchOutput, RankedPartner } from "../schemas";
import { buildRerankUserPrompt } from "../rerankPrompt";

/**
 * Step 3: RERANK — LLM scores each candidate for relevance.
 *
 * Takes the 30-50 candidates from hybrid search and has Gemini Flash
 * score each one 0-10 with a one-line reason. Keeps top 5-10.
 *
 * OPTIMIZATION: Skips reranking for:
 * - Non-search intents (skipSearch=true)
 * - Small result sets (≤5 candidates — already good from RRF)
 * - Metadata/overview/detail results (pass through directly)
 */

const RerankResponseSchema = z.array(
  z.object({
    index: z.number(),
    score: z.number(),
    reason: z.string(),
  }),
);

export const rerankStep = createStep({
  id: "rerank",
  inputSchema: SearchOutputSchema,
  outputSchema: RerankOutputSchema,
  execute: async ({ inputData, mastra }) => {
    const search: SearchOutput = inputData;
    const enhance = search.enhanceOutput;

    // Base passthrough (for non-search results)
    const base = {
      enhanceOutput: enhance,
      rankedPartners: [] as RankedPartner[],
      searchStrategy: search.searchStrategy,
      selfCorrected: search.selfCorrected,
      correctionStrategy: search.correctionStrategy,
      metadataResult: search.metadataResult,
      cityOverviewResult: search.cityOverviewResult,
      partnerDetailResult: search.partnerDetailResult,
    };

    // Skip reranking for non-search intents
    if (enhance.skipSearch) {
      return base;
    }

    // Skip if no candidates (metadata/overview/detail results pass through)
    if (search.candidates.length === 0) {
      return base;
    }

    // Confidence-based routing:
    // - High confidence + small set → skip rerank (fast path)
    // - High confidence + larger set → still skip (RRF already good)
    // - Medium/low → always rerank for quality
    const skipRerank =
      search.candidates.length <= 5 ||
      (enhance.confidence === "high" && search.candidates.length <= 10);

    if (skipRerank) {
      return {
        ...base,
        rankedPartners: search.candidates.map((c) => ({
          ...c,
          relevanceScore: 10,
          relevanceReason: "direct match",
          tier: "perfect" as const,
        })),
      };
    }

    // ── LLM Reranking ──
    const rerankAgent = mastra.getAgent("rerankAgent");
    const prompt = buildRerankUserPrompt(
      enhance.enhancedQuery,
      enhance.intent,
      enhance.slots.city,
      enhance.slots.category,
      search.candidates,
    );

    try {
      const result = await rerankAgent.generate(prompt, {
        structuredOutput: { schema: RerankResponseSchema },
      });

      const scores = result.object as z.infer<typeof RerankResponseSchema>;

      // Map scores back to partner objects with CRAG tier classification
      const ranked: RankedPartner[] = scores
        .filter((s) => s.score >= 3 && s.index >= 1 && s.index <= search.candidates.length)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map((s) => {
          const candidate = search.candidates[s.index - 1];
          // CRAG: classify into tiers
          const tier =
            s.score >= 8
              ? ("perfect" as const)
              : s.score >= 5
                ? ("good" as const)
                : ("weak" as const);
          return {
            ...candidate,
            relevanceScore: s.score,
            relevanceReason: s.reason,
            tier,
          };
        });

      return { ...base, rankedPartners: ranked };
    } catch {
      // If reranking fails, return all candidates with default scores
      return {
        ...base,
        rankedPartners: search.candidates.slice(0, 10).map((c) => ({
          ...c,
          relevanceScore: 7,
          relevanceReason: "ranked by hybrid search",
          tier: "good" as const,
        })),
      };
    }
  },
});
