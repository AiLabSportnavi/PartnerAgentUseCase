import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// Strip HTML tags to plain text
function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Normalize Unicode to NFC so umlauts match consistently in indexes
function normalizeStr(s: string): string {
  return s.normalize("NFC").trim();
}

/**
 * Build the combined text used for BM25 search AND as the source for embedding.
 * Contains: name + sporttypes + description + course names
 * Does NOT contain city/category — those are metadata filters, not semantic content.
 */
function buildSearchText(partner: {
  name: string;
  sporttypes: string[];
  description: string;
  courses: { name: string }[];
}): string {
  const courseNames = partner.courses
    .map((c) => c.name)
    .filter(Boolean)
    .join(", ");

  const parts = [
    partner.name,
    partner.sporttypes.join(", "),
    partner.description,
  ];

  if (courseNames) {
    parts.push(`Kurse: ${courseNames}`);
  }

  return parts.filter(Boolean).join(" | ");
}

/**
 * Compute a simple hash of the semantic content fields.
 * Used to detect when a partner's searchable content has changed,
 * so we only re-embed partners that actually need it.
 *
 * Hashed: name, description, category, sporttypes, course names
 * NOT hashed: phone, email, logo, address, lastSyncedAt (don't affect search)
 */
function computeContentHash(partner: {
  name: string;
  description: string;
  category: string;
  sporttypes: string[];
  courses: { name: string }[];
}): string {
  const input = [
    partner.name,
    partner.description,
    partner.category,
    [...partner.sporttypes].sort().join(","),
    partner.courses.map((c) => c.name).sort().join(","),
  ].join("|");

  // Simple djb2 hash — fast, deterministic, good enough for change detection
  // (Not cryptographic, but we only need "did it change?" not security)
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) & 0xffffffff;
  }
  return hash.toString(36);
}

// Transform raw API partner to our clean schema
function transformPartner(raw: any) {
  const name = normalizeStr(raw.name || raw.title || "");
  const city = normalizeStr(raw.city || "");
  const category = raw.category || "other";
  const sporttypes = raw.sporttypes || [];
  const description = normalizeStr(
    stripHtml(raw.description_html || raw.description),
  );
  const courses = (raw.courses || []).map((c: any) => ({
    name: c.name || "",
    sporttypes: c.sporttypes || [],
    usageLimits: c.usage_limits || c.nutzungslimits || undefined,
    courseFees: c.course_fees || c.gebuehren || undefined,
  }));

  const partner = {
    externalId: raw.id,
    name,
    city,
    address: normalizeStr(raw.address || raw.adresse || ""),
    category,
    sporttypes,
    description,
    phone: raw.phone || undefined,
    homepage: raw.homepage || undefined,
    email: raw.email || undefined,
    latitude: raw.latitude || undefined,
    longitude: raw.longitude || undefined,
    logoUrl: raw.logo_url || undefined,
    isUnstaffed: raw.is_unstaffed || false,
    courses,
    activeFrom: raw.active_from || undefined,
    activeUntil: raw.active_until || undefined,
    lastSyncedAt: Date.now(),
    // NEW: search & embedding fields
    searchText: buildSearchText({ name, sporttypes, description, courses }),
    contentHash: computeContentHash({
      name,
      description,
      category,
      sporttypes,
      courses,
    }),
  };

  return partner;
}

// Internal query: get existing external IDs (paginated)
export const getExternalIdsBatch = internalQuery({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { cursor }) => {
    const PAGE_SIZE = 500;
    const result = await ctx.db
      .query("partners")
      .paginate({ numItems: PAGE_SIZE, cursor: cursor ?? null });

    const ids = result.page.map((p) => ({
      externalId: p.externalId,
      id: p._id,
    }));

    return {
      ids,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

// Internal mutation: upsert a batch of partners
// Hash-based change detection: if contentHash hasn't changed, preserve existing embedding
export const upsertPartnerBatch = internalMutation({
  args: {
    partners: v.array(v.any()),
  },
  handler: async (ctx, { partners }) => {
    let added = 0;
    let updated = 0;

    for (const partner of partners) {
      const existing = await ctx.db
        .query("partners")
        .withIndex("by_externalId", (q) =>
          q.eq("externalId", partner.externalId),
        )
        .unique();

      if (existing) {
        if (existing.contentHash === partner.contentHash) {
          // Content unchanged — only update non-search fields (lastSyncedAt, phone, etc.)
          // Preserve existing embedding + searchText
          await ctx.db.patch(existing._id, {
            phone: partner.phone,
            homepage: partner.homepage,
            email: partner.email,
            latitude: partner.latitude,
            longitude: partner.longitude,
            logoUrl: partner.logoUrl,
            isUnstaffed: partner.isUnstaffed,
            activeFrom: partner.activeFrom,
            activeUntil: partner.activeUntil,
            lastSyncedAt: partner.lastSyncedAt,
          });
        } else {
          // Content changed — update everything, clear embedding for re-embedding
          await ctx.db.patch(existing._id, {
            ...partner,
            embedding: undefined, // will be re-embedded in the embedding step
          });
        }
        updated++;
      } else {
        // New partner — insert without embedding (will be embedded in the embedding step)
        await ctx.db.insert("partners", partner);
        added++;
      }
    }

    return { added, updated };
  },
});

// Internal mutation: remove stale partners in paginated batches
export const removeStalePartnersBatch = internalMutation({
  args: {
    activeExternalIds: v.array(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { activeExternalIds, cursor }) => {
    const activeSet = new Set(activeExternalIds);
    const PAGE_SIZE = 500;

    const result = await ctx.db
      .query("partners")
      .paginate({ numItems: PAGE_SIZE, cursor: cursor ?? null });

    let removed = 0;
    for (const partner of result.page) {
      if (!activeSet.has(partner.externalId)) {
        await ctx.db.delete(partner._id);
        removed++;
      }
    }

    return {
      removed,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

// Internal mutation: clear embeddings in batches (for model changes / re-embedding)
export const clearEmbeddingBatch = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Process a batch at a time to stay under transaction limits
    const partners = await ctx.db.query("partners").take(200);
    let cleared = 0;
    for (const p of partners) {
      if (p.embedding) {
        await ctx.db.patch(p._id, { embedding: undefined });
        cleared++;
      }
    }
    return { cleared, hasMore: partners.length === 200 };
  },
});

// Internal query: get partners that need embedding (paginated)
export const getPartnersNeedingEmbeddingBatch = internalQuery({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { cursor }) => {
    const PAGE_SIZE = 200;
    const result = await ctx.db
      .query("partners")
      .paginate({ numItems: PAGE_SIZE, cursor: cursor ?? null });

    const needsEmbedding = result.page
      .filter((p) => !p.embedding && p.searchText)
      .map((p) => ({ id: p._id, searchText: p.searchText! }));

    return {
      partners: needsEmbedding,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

// Internal mutation: write embeddings back to partners
export const writeEmbeddingBatch = internalMutation({
  args: {
    updates: v.array(
      v.object({
        id: v.id("partners"),
        embedding: v.array(v.number()),
      }),
    ),
  },
  handler: async (ctx, { updates }) => {
    for (const { id, embedding } of updates) {
      await ctx.db.patch(id, { embedding });
    }
    return { written: updates.length };
  },
});

// Internal mutation: update metadata
export const updateMetadata = internalMutation({
  args: {
    key: v.string(),
    data: v.any(),
  },
  handler: async (ctx, { key, data }) => {
    const existing = await ctx.db
      .query("metadata")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { data, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("metadata", { key, data, updatedAt: Date.now() });
    }
  },
});

// Internal mutation: log sync status
export const logSync = internalMutation({
  args: {
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    partnersAdded: v.number(),
    partnersUpdated: v.number(),
    partnersRemoved: v.number(),
    totalPartners: v.number(),
    status: v.string(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("syncLog", args);
  },
});

// Main sync action — called by cron and HTTP trigger
export const syncPartners = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    success: boolean;
    added: number;
    updated: number;
    removed: number;
    total: number;
  }> => {
    const startedAt = Date.now();

    try {
      // ── Phase 1: Fetch & Transform ──
      const response = await fetch(
        "https://app.sportnavi.de/api/v1/website/partners",
      );
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const json = await response.json();
      const rawPartners: any[] = json.data || [];
      const transformed = rawPartners.map(transformPartner);

      // ── Phase 2: Upsert partners (with hash-based change detection) ──
      let totalAdded = 0;
      let totalUpdated = 0;
      const BATCH_SIZE = 100;

      for (let i = 0; i < transformed.length; i += BATCH_SIZE) {
        const batch = transformed.slice(i, i + BATCH_SIZE);
        const result = await ctx.runMutation(
          internal.sync.upsertPartnerBatch,
          { partners: batch },
        );
        totalAdded += result.added;
        totalUpdated += result.updated;
      }

      // ── Phase 3: Remove stale partners (paginated) ──
      const activeIds = rawPartners.map((p: any) => p.id);
      let removed = 0;
      let cursor: string | undefined = undefined;
      let isDone = false;

      while (!isDone) {
        const result: { removed: number; isDone: boolean; continueCursor: string } =
          await ctx.runMutation(
            internal.sync.removeStalePartnersBatch,
            { activeExternalIds: activeIds, cursor },
          );
        removed += result.removed;
        isDone = result.isDone;
        cursor = result.continueCursor;
      }

      // ── Phase 4: Rebuild metadata ──
      await rebuildMetadata(ctx, transformed);

      // ── Phase 5: Log success ──
      // Note: Embedding is triggered separately via POST /api/embed
      // to avoid Windows Convex "use node" cross-action issues.
      await ctx.runMutation(internal.sync.logSync, {
        startedAt,
        completedAt: Date.now(),
        partnersAdded: totalAdded,
        partnersUpdated: totalUpdated,
        partnersRemoved: removed,
        totalPartners: transformed.length,
        status: "completed",
      });

      return {
        success: true,
        added: totalAdded,
        updated: totalUpdated,
        removed,
        total: transformed.length,
      };
    } catch (error: any) {
      await ctx.runMutation(internal.sync.logSync, {
        startedAt,
        completedAt: Date.now(),
        partnersAdded: 0,
        partnersUpdated: 0,
        partnersRemoved: 0,
        totalPartners: 0,
        status: "failed",
        error: error.message,
      });
      throw error;
    }
  },
});

// Helper: rebuild aggregated metadata from transformed partners
async function rebuildMetadata(ctx: any, partners: any[]) {
  const cityCounts: Record<string, number> = {};
  for (const p of partners) {
    if (p.city) {
      cityCounts[p.city] = (cityCounts[p.city] || 0) + 1;
    }
  }
  const cities = Object.entries(cityCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  await ctx.runMutation(internal.sync.updateMetadata, {
    key: "cities",
    data: cities,
  });

  const catCounts: Record<string, number> = {};
  for (const p of partners) {
    if (p.category) {
      catCounts[p.category] = (catCounts[p.category] || 0) + 1;
    }
  }
  const categories = Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  await ctx.runMutation(internal.sync.updateMetadata, {
    key: "categories",
    data: categories,
  });

  const sportCounts: Record<string, number> = {};
  for (const p of partners) {
    for (const s of p.sporttypes) {
      sportCounts[s] = (sportCounts[s] || 0) + 1;
    }
  }
  const sporttypes = Object.entries(sportCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  await ctx.runMutation(internal.sync.updateMetadata, {
    key: "sporttypes",
    data: sporttypes,
  });
}
