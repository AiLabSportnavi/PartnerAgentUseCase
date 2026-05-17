"use node";

// Node.js types for process.env
declare const process: { env: Record<string, string | undefined> };

/**
 * Embedding action — calls OpenRouter to generate vector embeddings.
 *
 * This file uses "use node" because it makes external HTTP calls to OpenRouter.
 * It can ONLY export actions, NOT queries or mutations.
 *
 * Called by syncPartners after upserting partner data. Only embeds partners
 * whose content has changed (detected by contentHash in sync.ts).
 */

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

/**
 * Embed a batch of partners via OpenRouter and write the vectors back to Convex.
 *
 * Input: array of { id: partnerId, searchText: "the text to embed" }
 * Output: { embedded: number } — how many were successfully embedded
 *
 * Uses OpenRouter's OpenAI-compatible endpoint with text-embedding-3-small.
 * Embedding model produces 1536-dimension float vectors.
 */
export const embedPartnerBatch = internalAction({
  args: {
    partners: v.array(
      v.object({
        id: v.string(),
        searchText: v.string(),
      }),
    ),
  },
  handler: async (ctx, { partners }) => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENROUTER_API_KEY not set. Run: npx convex env set OPENROUTER_API_KEY <key>",
      );
    }

    // Call OpenRouter embedding API (OpenAI-compatible format)
    // Sends all texts in one batch request for efficiency
    const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/text-embedding-3-small",
        input: partners.map((p) => p.searchText),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenRouter embedding API error ${response.status}: ${errorText}`,
      );
    }

    const result = await response.json();
    const embeddings: { embedding: number[]; index: number }[] =
      result.data || [];

    // Build updates: match each embedding back to its partner by index
    const updates: { id: any; embedding: number[] }[] = [];
    for (const item of embeddings) {
      if (item.index < partners.length && item.embedding) {
        updates.push({
          id: partners[item.index].id,
          embedding: item.embedding,
        });
      }
    }

    // Write embeddings back to Convex in batches of 50
    // (mutations have transaction limits on document writes)
    const WRITE_BATCH = 50;
    let totalWritten = 0;

    for (let i = 0; i < updates.length; i += WRITE_BATCH) {
      const batch = updates.slice(i, i + WRITE_BATCH);
      const { written } = await ctx.runMutation(
        internal.sync.writeEmbeddingBatch,
        { updates: batch as any },
      );
      totalWritten += written;
    }

    return { embedded: totalWritten };
  },
});
