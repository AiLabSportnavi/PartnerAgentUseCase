import { createStep } from "@mastra/core/workflows";
import { EnhanceOutputSchema, SearchOutputSchema } from "../schemas";
import type { EnhanceOutput, RichPartner } from "../schemas";
import {
  searchPartners,
  getPartnerDetails,
  getCityOverview,
  getMetadata,
  hybridSearchPartners,
} from "../../tools/partnerTools";

/**
 * Step 2: SEARCH — Hybrid search + self-correction cascade.
 *
 * Handles ALL intents in one step:
 * - Non-search intents (greeting, injection, etc.) → pass through
 * - Metadata/overview intents → call specific tools
 * - Search intents → hybrid search (BM25 + vector + RRF)
 * - Zero results → 5-level self-correction cascade
 *
 * Returns full partner data (description + courses) for the reranker.
 */

// Neighboring cities for self-correction
const NEIGHBORING_CITIES: Record<string, string[]> = {
  Herne: ["Bochum", "Gelsenkirchen", "Essen", "Dortmund", "Recklinghausen"],
  Bochum: ["Herne", "Essen", "Dortmund", "Gelsenkirchen", "Witten"],
  Gelsenkirchen: ["Herne", "Bochum", "Essen", "Gladbeck", "Recklinghausen"],
  Essen: ["Bochum", "Gelsenkirchen", "Mülheim an der Ruhr", "Oberhausen", "Duisburg"],
  Dortmund: ["Bochum", "Herne", "Witten", "Unna", "Lünen", "Castrop-Rauxel"],
  Düsseldorf: ["Neuss", "Ratingen", "Erkrath", "Mettmann", "Hilden"],
  Köln: ["Leverkusen", "Bergisch Gladbach", "Hürth", "Brühl", "Troisdorf"],
  Hamburg: ["Norderstedt", "Pinneberg", "Ahrensburg", "Wedel"],
  Berlin: ["Potsdam", "Teltow", "Bernau", "Oranienburg"],
  München: ["Dachau", "Freising", "Starnberg", "Erding"],
  Bielefeld: ["Gütersloh", "Herford", "Bad Salzuflen", "Detmold"],
  Paderborn: ["Bad Lippspringe", "Delbrück", "Salzkotten"],
  Münster: ["Greven", "Telgte", "Warendorf"],
  Frankfurt: ["Offenbach", "Wiesbaden", "Mainz", "Darmstadt"],
  Duisburg: ["Oberhausen", "Mülheim an der Ruhr", "Moers", "Krefeld"],
  Oberhausen: ["Duisburg", "Essen", "Mülheim an der Ruhr", "Bottrop"],
  Wuppertal: ["Solingen", "Remscheid", "Velbert"],
  Gütersloh: ["Bielefeld", "Rheda-Wiedenbrück", "Verl", "Harsewinkel"],
  Hagen: ["Iserlohn", "Herdecke", "Ennepetal", "Schwerte"],
};

async function callTool(
  toolName: string,
  params: Record<string, unknown>,
): Promise<{ data: any; isEmpty: boolean }> {
  try {
    let data: any;
    switch (toolName) {
      case "searchPartners":
        data = await searchPartners.execute!(params as any, {} as any);
        break;
      case "getPartnerDetails":
        data = await getPartnerDetails.execute!(params as any, {} as any);
        break;
      case "getCityOverview":
        data = await getCityOverview.execute!(params as any, {} as any);
        break;
      case "getMetadata":
        data = await getMetadata.execute!(params as any, {} as any);
        break;
      case "hybridSearchPartners":
        data = await hybridSearchPartners.execute!(params as any, {} as any);
        break;
      default:
        return { data: null, isEmpty: true };
    }

    const isEmpty = isEmptyResult(data);
    return { data, isEmpty };
  } catch (error: any) {
    return { data: { error: error.message }, isEmpty: true };
  }
}

function isEmptyResult(data: unknown): boolean {
  if (!data) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.partners)) return obj.partners.length === 0;
    if (typeof obj.totalPartners === "number") return obj.totalPartners === 0;
    if (obj.error) return true;
  }
  return false;
}

function extractRichPartners(data: any): RichPartner[] {
  const partners = data?.partners || (Array.isArray(data) ? data : []);
  return partners.map((p: any) => ({
    id: p.id || p._id || "",
    name: p.name || "",
    city: p.city || "",
    address: p.address || "",
    category: p.category || "",
    sporttypes: p.sporttypes || [],
    description: (p.description || "").slice(0, 300),
    courseNames: (p.courses || []).map((c: any) => c.name).filter(Boolean),
  }));
}

export const searchStep = createStep({
  id: "search",
  inputSchema: EnhanceOutputSchema,
  outputSchema: SearchOutputSchema,
  execute: async ({ inputData }) => {
    const enhance: EnhanceOutput = inputData;
    const slots = enhance.slots;

    const base = {
      enhanceOutput: enhance,
      candidates: [] as RichPartner[],
      searchStrategy: "none",
      selfCorrected: false,
    };

    // ── Non-search intents: pass through ──
    if (enhance.skipSearch) {
      return { ...base, searchStrategy: "skip" };
    }

    // ── Metadata intent ──
    if (enhance.intent === "broad-overview") {
      const { data } = await callTool("getMetadata", {});
      return { ...base, searchStrategy: "metadata", metadataResult: data };
    }

    // ── City explore intent ──
    if (enhance.intent === "city-explore") {
      if (slots.city) {
        const { data } = await callTool("getCityOverview", { city: slots.city });
        return { ...base, searchStrategy: "cityOverview", cityOverviewResult: data };
      }
      const { data } = await callTool("getMetadata", {});
      return { ...base, searchStrategy: "metadata", metadataResult: data };
    }

    // ── Partner detail intent ──
    if (enhance.intent === "partner-detail") {
      const query = slots.partner_name || slots.query || enhance.enhancedQuery;
      const searchResult = await callTool("searchPartners", {
        query,
        city: slots.city,
      });
      if (
        !searchResult.isEmpty &&
        searchResult.data?.length > 0
      ) {
        const partnerId = searchResult.data[0]?.id || searchResult.data[0]?._id;
        if (partnerId) {
          const { data } = await callTool("getPartnerDetails", { partnerId });
          return { ...base, searchStrategy: "partnerDetail", partnerDetailResult: data };
        }
      }
      // Fallback: treat as regular search
    }

    // ── Main search path: RAG Fusion (multi-query) ──
    // Run the primary enhanced query + variants in parallel, merge via RRF
    const variants = enhance.queryVariants || [];
    const useRagFusion =
      variants.length > 0 && enhance.confidence !== "high";

    if (useRagFusion) {
      // RAG Fusion: search primary + all variants in parallel
      const allQueries = [enhance.enhancedQuery, ...variants.slice(0, 3)];
      const searches = await Promise.all(
        allQueries.map((q) =>
          callTool("hybridSearchPartners", {
            query: q,
            city: slots.city,
            category: slots.category,
            limit: 20,
          }),
        ),
      );

      // Merge via RRF across all result sets
      const K = 60;
      const rrfScores = new Map<
        string,
        { partner: any; score: number }
      >();

      for (const search of searches) {
        const partners = search.data?.partners || [];
        partners.forEach((p: any, rank: number) => {
          const id = p.id || p._id || p.name;
          const existing = rrfScores.get(id);
          rrfScores.set(id, {
            partner: existing?.partner || p,
            score: (existing?.score || 0) + 1 / (K + rank),
          });
        });
      }

      if (rrfScores.size > 0) {
        const merged = Array.from(rrfScores.values())
          .sort((a, b) => b.score - a.score)
          .slice(0, 40)
          .map((entry) => entry.partner);
        return {
          ...base,
          candidates: extractRichPartners({ partners: merged }),
          searchStrategy: "rag-fusion",
        };
      }
    } else {
      // Single query (high confidence or no variants)
      const { data, isEmpty } = await callTool("hybridSearchPartners", {
        query: enhance.enhancedQuery,
        city: slots.city,
        category: slots.category,
        limit: 40,
      });

      if (!isEmpty) {
        return {
          ...base,
          candidates: extractRichPartners(data),
          searchStrategy: "hybrid",
        };
      }
    }

    // ── Self-correction cascade (0 results from hybrid search) ──

    // Level 1: Drop sporttype, keep city + category
    if (slots.sporttype && slots.city && slots.category) {
      const result = await callTool("searchPartners", {
        city: slots.city,
        category: slots.category,
        limit: 10,
      });
      if (!result.isEmpty) {
        return {
          ...base,
          candidates: extractRichPartners(result.data),
          searchStrategy: "hybrid",
          selfCorrected: true,
          correctionStrategy: "dropped_sporttype",
        };
      }
    }

    // Level 2: Try as text query
    const searchTerm = slots.sporttype || slots.category || slots.query;
    if (searchTerm && slots.city) {
      const result = await callTool("searchPartners", {
        query: searchTerm,
        city: slots.city,
        limit: 10,
      });
      if (!result.isEmpty) {
        return {
          ...base,
          candidates: extractRichPartners(result.data),
          searchStrategy: "hybrid",
          selfCorrected: true,
          correctionStrategy: "text_query_fallback",
        };
      }
    }

    // Level 3: Search neighboring cities
    if (slots.city) {
      const neighbors = NEIGHBORING_CITIES[slots.city] || [];
      if (neighbors.length > 0) {
        const searches = await Promise.all(
          neighbors.slice(0, 3).map((neighborCity) =>
            callTool("searchPartners", {
              city: neighborCity,
              category: slots.category,
              sporttype: slots.sporttype,
              limit: 5,
            }),
          ),
        );
        const neighborPartners = searches
          .filter((r) => !r.isEmpty)
          .flatMap((r) => extractRichPartners(r.data));

        if (neighborPartners.length > 0) {
          return {
            ...base,
            candidates: neighborPartners,
            searchStrategy: "hybrid",
            selfCorrected: true,
            correctionStrategy: `neighboring_cities:${neighbors.slice(0, 3).join(",")}`,
          };
        }
      }
    }

    // Level 4: City overview
    if (slots.city) {
      const { data: overview } = await callTool("getCityOverview", { city: slots.city });
      if (!isEmptyResult(overview)) {
        return {
          ...base,
          searchStrategy: "cityOverview",
          cityOverviewResult: overview,
          selfCorrected: true,
          correctionStrategy: "city_overview_fallback",
        };
      }
    }

    // Level 5: Full metadata (always succeeds)
    const { data: metadata } = await callTool("getMetadata", {});
    return {
      ...base,
      searchStrategy: "metadata",
      metadataResult: metadata,
      selfCorrected: true,
      correctionStrategy: "full_metadata_fallback",
    };
  },
});
