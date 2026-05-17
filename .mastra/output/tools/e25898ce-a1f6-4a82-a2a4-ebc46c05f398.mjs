import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const CONVEX_SITE_URL = process.env.CONVEX_SITE_URL || "http://127.0.0.1:3211";
async function convexFetch(path, options) {
  const url = `${CONVEX_SITE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers }
  });
  if (!res.ok) {
    throw new Error(`Convex HTTP error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}
const searchPartners = createTool({
  id: "searchPartners",
  description: "Search for Sport Navi partners by name, city, category, or sport type. Returns a compact list of matching partners. Use this to find partners based on user queries.",
  inputSchema: z.object({
    query: z.string().optional().describe("Partner name or partial name to search for"),
    city: z.string().optional().describe("City name to filter by (exact match, use full city name e.g. 'Dortmund' not 'dort')"),
    category: z.string().optional().describe("Category filter: fitness, yoga, boxing, swimming, climbing, ems, massage, sauna, racket, outdoor, specials, other"),
    sporttype: z.string().optional().describe("Sport type filter e.g. Fitness, Boxing, Yoga, Swimming, Cycling, Tennis, Martial Arts, Dance"),
    limit: z.number().optional().default(10).describe("Max results to return (default 10)")
  }),
  execute: async (input) => {
    const results = await convexFetch("/api/search", {
      method: "POST",
      body: JSON.stringify({
        query: input.query || void 0,
        city: input.city || void 0,
        category: input.category || void 0,
        sporttype: input.sporttype || void 0,
        limit: input.limit
      })
    });
    return results;
  }
});
const getPartnerDetails = createTool({
  id: "getPartnerDetails",
  description: "Get full details for a specific partner including courses, usage limits, fees, contact info. Use this after searchPartners to give the user detailed information about a specific partner.",
  inputSchema: z.object({
    partnerId: z.string().describe("The partner ID returned from searchPartners")
  }),
  execute: async (input) => {
    const result = await convexFetch("/api/partner", {
      method: "POST",
      body: JSON.stringify({ partnerId: input.partnerId })
    });
    return result;
  }
});
const getCityOverview = createTool({
  id: "getCityOverview",
  description: "Get a complete overview of what's available in a specific city: total partner count, category breakdown, sport type breakdown, and sample partners. Use this when the user asks broadly about a city (e.g. 'was gibt es in Dortmund?', 'zeig mir K\xF6ln') instead of searchPartners, because it gives richer context.",
  inputSchema: z.object({
    city: z.string().describe("City name (exact, full name e.g. 'Dortmund' not 'dort')")
  }),
  execute: async (input) => {
    const result = await convexFetch("/api/city-overview", {
      method: "POST",
      body: JSON.stringify({ city: input.city })
    });
    return result;
  }
});
const hybridSearchPartners = createTool({
  id: "hybridSearchPartners",
  description: 'Hybrid search combining keyword matching (BM25) and semantic meaning (vector similarity). Use this for natural language queries where the user describes goals, symptoms, or feelings rather than naming a specific sport. Embeds the query and searches both by keywords and by meaning. Examples: "R\xFCckenschmerzen", "nach der Arbeit entspannen", "was f\xFCr Anf\xE4nger".',
  inputSchema: z.object({
    query: z.string().describe("Natural language query to search for"),
    city: z.string().optional().describe("Optional city filter"),
    category: z.string().optional().describe("Optional category filter"),
    limit: z.number().optional().default(10).describe("Max results (default 10)")
  }),
  execute: async (input) => {
    const { embedSingle } = await import('../embedPartners.mjs');
    const queryVector = await embedSingle(input.query);
    const result = await convexFetch("/api/hybrid-search", {
      method: "POST",
      body: JSON.stringify({
        queryText: input.query,
        queryVector,
        city: input.city || void 0,
        category: input.category || void 0,
        limit: input.limit
      })
    });
    return result;
  }
});
const getMetadata = createTool({
  id: "getMetadata",
  description: "Get the full list of available cities (with partner counts), categories, and sport types. Use this if you need to check what cities or categories are available in the Sport Navi network.",
  inputSchema: z.object({}),
  execute: async () => {
    const result = await convexFetch("/api/metadata", { method: "GET" });
    return result;
  }
});

export { getCityOverview, getMetadata, getPartnerDetails, hybridSearchPartners, searchPartners };
