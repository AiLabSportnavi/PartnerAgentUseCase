import { createStep } from "@mastra/core/workflows";
import { RerankOutputSchema, WorkflowOutputSchema } from "../schemas";
import type { RerankOutput, RankedPartner } from "../schemas";
import { postProcess } from "../../guardrails";

/**
 * Step 4: RESPOND — LLM generates a grounded answer.
 *
 * Receives reranked partners as clean formatted text (not raw JSON).
 * Includes relevance reasoning from the reranker.
 * Returns the response + a memory payload for the feedback loop.
 */

function buildResponseContext(input: RerankOutput): string {
  const parts: string[] = [];
  const enhance = input.enhanceOutput;

  parts.push(`[Language: ${enhance.language}]`);
  parts.push(`[Intent: ${enhance.intent} | Confidence: ${enhance.confidence}]`);

  if (enhance.is_frustrated) {
    parts.push(
      "[User is frustrated — be empathetic, show data immediately, don't ask questions]",
    );
  }

  // Self-correction context
  if (input.selfCorrected && input.correctionStrategy) {
    if (input.correctionStrategy.startsWith("neighboring_cities:")) {
      const cities = input.correctionStrategy.replace("neighboring_cities:", "");
      parts.push(
        `[Nothing found in original city. Found results in nearby cities (${cities}). Say "In {Stadt} direkt haben wir nichts gefunden, aber ganz in der Nähe:" with city names prominent.]`,
      );
    } else if (input.correctionStrategy === "dropped_sporttype") {
      parts.push("[Broadened search by removing specific sport type. Explain what was searched.]");
    } else if (input.correctionStrategy === "city_overview_fallback") {
      parts.push("[Sport not available in city. Showing what IS available instead.]");
    } else if (input.correctionStrategy === "full_metadata_fallback") {
      parts.push("[No results for query. Showing full network overview as alternative.]");
    }
  }

  parts.push("");

  // ── Format data for the LLM ──

  // Reranked partners grouped by CRAG tier
  if (input.rankedPartners.length > 0) {
    parts.push("## Search Results");
    parts.push(`Query: "${enhance.enhancedQuery}"`);

    const perfect = input.rankedPartners.filter((p) => p.tier === "perfect");
    const good = input.rankedPartners.filter((p) => p.tier === "good");
    const weak = input.rankedPartners.filter((p) => p.tier === "weak");

    if (perfect.length > 0) {
      parts.push(`\n### Top Recommendations (${perfect.length})`);
      parts.push("Present these prominently — they are the best matches.");
      perfect.forEach((p, i) => {
        parts.push(`${i + 1}. **${p.name}** (Score: ${p.relevanceScore}/10)`);
        parts.push(`   Address: ${p.address}`);
        parts.push(`   Category: ${p.category} | Sports: ${p.sporttypes.join(", ")}`);
        if (p.courseNames.length > 0) parts.push(`   Courses: ${p.courseNames.join(", ")}`);
        parts.push(`   Why: ${p.relevanceReason}`);
        parts.push("");
      });
    }

    if (good.length > 0) {
      parts.push(`\n### Also Relevant (${good.length})`);
      parts.push("These are solid matches. List them after the top recommendations.");
      good.forEach((p, i) => {
        parts.push(`${i + 1}. **${p.name}** — ${p.address} (${p.category})`);
        if (p.relevanceReason) parts.push(`   Why: ${p.relevanceReason}`);
        parts.push("");
      });
    }

    if (weak.length > 0) {
      parts.push(`\n### Other Options (${weak.length})`);
      parts.push("Mention these briefly as alternatives, or skip if there are enough top results.");
      weak.forEach((p) => {
        parts.push(`- ${p.name} — ${p.city} (${p.category})`);
      });
      parts.push("");
    }
  }

  // Metadata result
  if (input.metadataResult) {
    parts.push("## Network Overview Data");
    parts.push(JSON.stringify(input.metadataResult, null, 2));
  }

  // City overview result
  if (input.cityOverviewResult) {
    parts.push("## City Overview Data");
    parts.push(JSON.stringify(input.cityOverviewResult, null, 2));
  }

  // Partner detail result
  if (input.partnerDetailResult) {
    parts.push("## Partner Details");
    parts.push(JSON.stringify(input.partnerDetailResult, null, 2));
  }

  return parts.join("\n");
}

export const respondStep = createStep({
  id: "respond",
  inputSchema: RerankOutputSchema,
  outputSchema: WorkflowOutputSchema,
  execute: async ({ inputData, mastra, getInitData }) => {
    const input: RerankOutput = inputData;
    const enhance = input.enhanceOutput;

    // Static responses bypass the LLM entirely
    if (enhance.skipSearch && enhance.staticResponse) {
      return {
        text: enhance.staticResponse,
        intent: enhance.intent,
        confidence: enhance.confidence,
        selfCorrected: false,
      };
    }

    // Build clean context for the response agent
    const context = buildResponseContext(input);

    const prompt =
      input.rankedPartners.length > 0 ||
      input.metadataResult ||
      input.cityOverviewResult ||
      input.partnerDetailResult
        ? `${context}\n\n---\n\nUser message: "${enhance.userMessage}"\n\nRespond naturally based on the data above. Lead with the answer, use bulleted lists for partners.`
        : `${context}\n\n---\n\nUser message: "${enhance.userMessage}"\n\nRespond with a brief, friendly reply.`;

    const responseAgent = mastra.getAgent("responseAgent");
    const result = await responseAgent.generate(prompt);
    const rawText = result.text || "";

    // Post-process guard: catch system leaks
    const guard = postProcess(rawText);

    // Build memory payload for the feedback loop
    const retrievedPartners = input.rankedPartners.map((p) => ({
      id: p.id,
      name: p.name,
      city: p.city,
    }));

    return {
      text: guard.finalResponse,
      intent: enhance.intent,
      confidence: enhance.confidence,
      selfCorrected: input.selfCorrected,
      memoryPayload: {
        enhancedQuery: enhance.enhancedQuery,
        retrievedPartners,
        response: guard.finalResponse,
      },
    };
  },
});
