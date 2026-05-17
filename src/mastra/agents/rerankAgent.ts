import { Agent } from "@mastra/core/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { RERANK_SYSTEM_PROMPT } from "../workflows/rerankPrompt";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

/**
 * LLM Reranker Agent — scores candidate partners by relevance.
 * No tools, no memory. Returns structured JSON scores.
 */
export const rerankAgent = new Agent({
  id: "rerankAgent",
  name: "Partner Relevance Reranker",
  instructions: RERANK_SYSTEM_PROMPT,
  model: openrouter("google/gemini-2.0-flash-001"),
});
