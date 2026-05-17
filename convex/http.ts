import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";

const http = httpRouter();

// POST /api/search — search partners
http.route({
  path: "/api/search",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.json();
    const results = await ctx.runQuery(api.partners.searchPartners, {
      query: body.query,
      city: body.city,
      category: body.category,
      sporttype: body.sporttype,
      limit: body.limit,
    });
    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// POST /api/partner — get partner details
http.route({
  path: "/api/partner",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.json();
    const result = await ctx.runQuery(api.partners.getPartnerDetails, {
      partnerId: body.partnerId,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// GET /api/metadata — get cities, categories, sporttypes
http.route({
  path: "/api/metadata",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const result = await ctx.runQuery(api.partners.getMetadata, {});
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// POST /api/city-overview — get city breakdown
http.route({
  path: "/api/city-overview",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.json();
    const result = await ctx.runQuery(api.partners.getCityOverview, {
      city: body.city,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// POST /api/partners-for-sync — get partners needing embedding (paginated)
http.route({
  path: "/api/partners-for-sync",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.json().catch(() => ({}));
    const results = await ctx.runQuery(api.partners.getPartnersForSync, {
      cursor: body.cursor,
    });
    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// POST /api/hybrid-search — hybrid BM25 + semantic search
http.route({
  path: "/api/hybrid-search",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.json();
    const result = await ctx.runQuery(api.partners.hybridSearch, {
      queryText: body.queryText,
      queryVector: body.queryVector,
      city: body.city,
      category: body.category,
      limit: body.limit,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// POST /api/clear-embeddings — clear all embeddings in batches (for model changes)
http.route({
  path: "/api/clear-embeddings",
  method: "POST",
  handler: httpAction(async (ctx) => {
    let totalCleared = 0;
    let hasMore = true;
    while (hasMore) {
      const result = await ctx.runMutation(internal.sync.clearEmbeddingBatch, {});
      totalCleared += result.cleared;
      hasMore = result.hasMore;
    }
    return new Response(JSON.stringify({ cleared: totalCleared }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// POST /api/write-embeddings — write pre-computed embeddings to partner documents
http.route({
  path: "/api/write-embeddings",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.json();
    const result = await ctx.runMutation(internal.sync.writeEmbeddingBatch, {
      updates: body.updates,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// GET /api/conversation — get conversation history by threadId
http.route({
  path: "/api/conversation",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const threadId = url.searchParams.get("threadId");
    if (!threadId) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const history = await ctx.runQuery(api.conversations.getConversation, {
      threadId,
    });
    return new Response(JSON.stringify(history), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// POST /api/conversation — update conversation history
http.route({
  path: "/api/conversation",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.json();
    await ctx.runMutation(api.conversations.updateConversation, {
      threadId: body.threadId,
      history: body.history,
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// POST /api/sync — trigger manual sync
http.route({
  path: "/api/sync",
  method: "POST",
  handler: httpAction(async (ctx) => {
    const result = await ctx.runAction(internal.sync.syncPartners, {});
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
