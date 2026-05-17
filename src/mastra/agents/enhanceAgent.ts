import { Agent } from "@mastra/core/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ENHANCE_SYSTEM_PROMPT } from "../workflows/enhancePrompt";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

/**
 * Query Enhancement Agent — replaces the old router agent.
 *
 * Does intent classification + slot extraction + query rewriting in one call.
 * No tools, no memory (session context is passed via the prompt).
 * Returns structured JSON via Gemini Flash structured output.
 */
export const enhanceAgent = new Agent({
  id: "enhanceAgent",
  name: "Query Enhancement Engine",
  instructions: ENHANCE_SYSTEM_PROMPT,
  model: openrouter("google/gemini-2.0-flash-001"),
});
