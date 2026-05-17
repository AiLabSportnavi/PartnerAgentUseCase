import { query, action } from "./_generated/server";
import { v } from "convex/values";

// Search partners by name (full-text search), optionally filter by city/category
export const searchPartners = query({
  args: {
    query: v.optional(v.string()),
    city: v.optional(v.string()),
    category: v.optional(v.string()),
    sporttype: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;

    // If we have a text query, use full-text search
    if (args.query) {
      let searchQuery = ctx.db
        .query("partners")
        .withSearchIndex("search_name", (q) => {
          let sq = q.search("name", args.query!);
          if (args.city) sq = sq.eq("city", args.city);
          if (args.category) sq = sq.eq("category", args.category);
          return sq;
        });

      const results = await searchQuery.take(limit);

      // If sporttype filter, apply post-search
      if (args.sporttype) {
        return results
          .filter((p) =>
            p.sporttypes.some(
              (s) => s.toLowerCase() === args.sporttype!.toLowerCase()
            )
          )
          .map(compactPartner);
      }

      return results.map(compactPartner);
    }

    // No text query — use index filters
    if (args.city) {
      // Over-fetch enough to survive post-filtering by category/sporttype
      const fetchLimit = args.category || args.sporttype ? 500 : limit;
      let results = await ctx.db
        .query("partners")
        .withIndex("by_city", (q) => q.eq("city", args.city!))
        .take(fetchLimit);

      if (args.category) {
        results = results.filter((p) => p.category === args.category);
      }
      if (args.sporttype) {
        results = results.filter((p) =>
          p.sporttypes.some(
            (s) => s.toLowerCase() === args.sporttype!.toLowerCase()
          )
        );
      }

      return results.slice(0, limit).map(compactPartner);
    }

    if (args.category) {
      let results = await ctx.db
        .query("partners")
        .withIndex("by_category", (q) => q.eq("category", args.category!))
        .take(limit * 2);

      if (args.sporttype) {
        results = results.filter((p) =>
          p.sporttypes.some(
            (s) => s.toLowerCase() === args.sporttype!.toLowerCase()
          )
        );
      }

      return results.slice(0, limit).map(compactPartner);
    }

    // Fallback: just return some partners
    const results = await ctx.db.query("partners").take(limit);
    return results.map(compactPartner);
  },
});

// Get full partner details by ID
export const getPartnerDetails = query({
  args: {
    partnerId: v.id("partners"),
  },
  handler: async (ctx, { partnerId }) => {
    const partner = await ctx.db.get(partnerId);
    if (!partner) return null;

    return {
      id: partner._id,
      name: partner.name,
      city: partner.city,
      address: partner.address,
      category: partner.category,
      sporttypes: partner.sporttypes,
      description: partner.description,
      phone: partner.phone,
      homepage: partner.homepage,
      email: partner.email,
      isUnstaffed: partner.isUnstaffed,
      courses: partner.courses,
    };
  },
});

// Get aggregated metadata (cities, categories, sporttypes with counts)
export const getMetadata = query({
  args: {},
  handler: async (ctx) => {
    const cities = await ctx.db
      .query("metadata")
      .withIndex("by_key", (q) => q.eq("key", "cities"))
      .unique();

    const categories = await ctx.db
      .query("metadata")
      .withIndex("by_key", (q) => q.eq("key", "categories"))
      .unique();

    const sporttypes = await ctx.db
      .query("metadata")
      .withIndex("by_key", (q) => q.eq("key", "sporttypes"))
      .unique();

    return {
      cities: cities?.data || [],
      categories: categories?.data || [],
      sporttypes: sporttypes?.data || [],
    };
  },
});

// Get partners by city with full category/sport breakdown
export const getCityOverview = query({
  args: {
    city: v.string(),
  },
  handler: async (ctx, { city }) => {
    const partners = await ctx.db
      .query("partners")
      .withIndex("by_city", (q) => q.eq("city", city))
      .collect();

    if (partners.length === 0) return null;

    // Build breakdown
    const categories: Record<string, number> = {};
    const sporttypes: Record<string, number> = {};

    for (const p of partners) {
      categories[p.category] = (categories[p.category] || 0) + 1;
      for (const s of p.sporttypes) {
        sporttypes[s] = (sporttypes[s] || 0) + 1;
      }
    }

    return {
      city,
      totalPartners: partners.length,
      categories: Object.entries(categories)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count })),
      sporttypes: Object.entries(sporttypes)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count })),
      samplePartners: partners.slice(0, 5).map(compactPartner),
    };
  },
});

// Get a batch of partners needing embedding (lightweight — only returns IDs + searchText)
export const getPartnersForSync = query({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Use pagination to avoid reading too many bytes at once
    const result = await ctx.db
      .query("partners")
      .paginate({ numItems: 50, cursor: args.cursor ?? null });

    const needing = result.page
      .filter((p) => p.searchText && (!p.embedding || p.embedding.length === 0))
      .map((p) => ({ _id: p._id, searchText: p.searchText! }));

    return {
      partners: needing,
      nextCursor: result.isDone ? null : result.continueCursor,
    };
  },
});

/**
 * Hybrid search: combines BM25 keyword matching + vector cosine similarity.
 *
 * How it works:
 * 1. BM25 PATH — full-text search on searchText (name + description + courses)
 *    Finds exact keyword matches: "FITOMAT", "Schwimmbad", "Yoga-Haus"
 *
 * 2. SEMANTIC PATH — cosine similarity on stored embeddings
 *    Finds meaning matches: "Rückenschmerzen" → physio, yoga, massage partners
 *
 * 3. MERGE — Reciprocal Rank Fusion (RRF) combines both ranked lists
 *    A partner ranked high in both lists gets boosted to #1
 *
 * queryVector must be pre-computed by the caller (Convex queries can't make API calls)
 */
export const hybridSearch = query({
  args: {
    queryText: v.string(),
    queryVector: v.array(v.number()),
    city: v.optional(v.string()),
    category: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 10;

    // ── BM25 PATH: keyword search on searchText ──
    const bm25Results = await ctx.db
      .query("partners")
      .withSearchIndex("search_text", (q) => {
        let sq = q.search("searchText", args.queryText);
        if (args.city) sq = sq.eq("city", args.city);
        if (args.category) sq = sq.eq("category", args.category);
        return sq;
      })
      .take(20);

    // ── SEMANTIC PATH: vector cosine similarity ──
    // Fetch candidate partners (filtered by metadata)
    let candidates;
    if (args.city) {
      candidates = await ctx.db
        .query("partners")
        .withIndex("by_city", (q) => q.eq("city", args.city!))
        .take(500);
    } else {
      candidates = await ctx.db.query("partners").take(2000);
    }

    // Apply category filter if provided
    if (args.category) {
      candidates = candidates.filter((p) => p.category === args.category);
    }

    // Rank by cosine similarity (only partners with embeddings)
    const semanticScored = candidates
      .filter((p) => p.embedding && p.embedding.length > 0)
      .map((p) => ({
        partner: p,
        score: cosineSimilarity(args.queryVector, p.embedding!),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    // ── MERGE: Reciprocal Rank Fusion ──
    const K = 60; // standard RRF constant
    const rrfScores = new Map<string, { partner: any; score: number }>();

    // Add BM25 results with RRF scores
    bm25Results.forEach((p, rank) => {
      const id = p._id.toString();
      const existing = rrfScores.get(id);
      const rrfScore = 1 / (K + rank);
      rrfScores.set(id, {
        partner: p,
        score: (existing?.score || 0) + rrfScore,
      });
    });

    // Add semantic results with RRF scores
    semanticScored.forEach(({ partner: p }, rank) => {
      const id = p._id.toString();
      const existing = rrfScores.get(id);
      const rrfScore = 1 / (K + rank);
      rrfScores.set(id, {
        partner: existing?.partner || p,
        score: (existing?.score || 0) + rrfScore,
      });
    });

    // Sort by combined RRF score and return top results
    const merged = Array.from(rrfScores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ partner }) => richPartner(partner));

    return { partners: merged };
  },
});

/**
 * Cosine similarity between two vectors.
 * Returns a value between -1 and 1 (higher = more similar).
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// Compact representation for search results (keeps tool responses small)
function compactPartner(p: any) {
  return {
    id: p._id,
    name: p.name,
    city: p.city,
    category: p.category,
    sporttypes: p.sporttypes,
    address: p.address,
  };
}

// Rich representation with description + courses (for LLM reranking)
function richPartner(p: any) {
  return {
    id: p._id,
    name: p.name,
    city: p.city,
    address: p.address,
    category: p.category,
    sporttypes: p.sporttypes,
    description: (p.description || "").slice(0, 300),
    courseNames: (p.courses || []).map((c: any) => c.name).filter(Boolean),
  };
}
