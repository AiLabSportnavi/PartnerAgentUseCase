/**
 * Embedding utilities for partner data.
 * Uses OpenRouter embedding models — same key as the LLM calls.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { embed } from "ai";

// Lazy-initialized — env vars may not be loaded at import time
let _embeddingModel: ReturnType<ReturnType<typeof createOpenAI>["embedding"]> | null = null;

function getEmbeddingModel() {
  if (!_embeddingModel) {
    const openrouter = createOpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });
    _embeddingModel = openrouter.embedding("openai/text-embedding-3-large");
  }
  return _embeddingModel;
}

export interface PartnerForEmbedding {
  _id: string;
  externalId: number;
  name: string;
  city: string;
  category: string;
  sporttypes: string[];
  description: string;
  courses?: { name: string; sporttypes: string[] }[];
}

/**
 * Build a composite text string that captures all searchable facets of a partner.
 * This is what gets embedded — semantic search matches against this text.
 */
export function buildCompositeText(partner: PartnerForEmbedding): string {
  const courseNames = (partner.courses || [])
    .map((c) => c.name)
    .filter(Boolean)
    .join(", ");

  const parts = [
    partner.name,
    partner.city,
    partner.category,
    partner.sporttypes.join(", "),
    partner.description,
  ];

  if (courseNames) {
    parts.push(`Kurse: ${courseNames}`);
  }

  return parts.filter(Boolean).join(" | ");
}

/**
 * Embed a single text string. Used for user queries at search time.
 */
export async function embedSingle(text: string): Promise<number[]> {
  const result = await embed({ model: getEmbeddingModel(), value: text });
  return result.embedding;
}

/**
 * Embed multiple texts in parallel. Used during sync for batch partner embedding.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const model = getEmbeddingModel();
  const results = await Promise.all(
    texts.map((text) => embed({ model, value: text })),
  );
  return results.map((r) => r.embedding);
}
