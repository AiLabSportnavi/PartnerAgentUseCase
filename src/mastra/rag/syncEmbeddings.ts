/**
 * Embedding sync — paginated fetch + embed + write back.
 *
 * Run: npx tsx src/mastra/rag/syncEmbeddings.ts
 * Or: npm run sync:vectors
 */

import { embedBatch } from "./embedPartners";

const CONVEX_SITE_URL =
  process.env.CONVEX_SITE_URL || "http://127.0.0.1:3211";
// Smaller batches for text-embedding-3-large (3072 dims = ~24KB per vector)
const EMBED_BATCH = 10;

async function convexFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${CONVEX_SITE_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    throw new Error(`Convex HTTP error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export async function syncPartnerEmbeddings(): Promise<{
  embedded: number;
}> {
  let totalEmbedded = 0;
  let cursor: string | null = null;
  let pagesScanned = 0;

  // Paginate through all partners, embed those missing vectors
  while (true) {
    const result: {
      partners: { _id: string; searchText: string }[];
      nextCursor: string | null;
    } = await convexFetch("/api/partners-for-sync", {
      method: "POST",
      body: JSON.stringify(cursor ? { cursor } : {}),
    });

    pagesScanned++;
    const partners = result.partners;

    if (partners.length > 0) {
      // Embed in sub-batches
      for (let i = 0; i < partners.length; i += EMBED_BATCH) {
        const batch = partners.slice(i, i + EMBED_BATCH);
        const texts = batch.map((p) => p.searchText);
        const embeddings = await embedBatch(texts);

        const updates = batch.map((p, idx) => ({
          id: p._id,
          embedding: embeddings[idx],
        }));

        await convexFetch("/api/write-embeddings", {
          method: "POST",
          body: JSON.stringify({ updates }),
        });

        totalEmbedded += batch.length;
        console.log(`  Embedded ${totalEmbedded}... (page ${pagesScanned})`);
      }
    }

    // If no more pages, we're done
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }

  console.log(
    totalEmbedded === 0
      ? "All partners already have embeddings."
      : `Done! ${totalEmbedded} partners embedded with text-embedding-3-large.`,
  );
  return { embedded: totalEmbedded };
}

// CLI entry point
const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith("syncEmbeddings.ts") ||
    process.argv[1].endsWith("syncEmbeddings.js"));

if (isMainModule) {
  const dotenv = await import("dotenv");
  dotenv.config({ path: ".env.local" });
  dotenv.config();

  syncPartnerEmbeddings()
    .then((result) => {
      console.log(`Result: ${JSON.stringify(result)}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Sync failed:", err);
      process.exit(1);
    });
}
