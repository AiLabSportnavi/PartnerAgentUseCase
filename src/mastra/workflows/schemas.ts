import { z } from "zod";

// ── Intent enum (same 14 types as before) ──
export const IntentEnum = z.enum([
  "broad-overview",
  "city-explore",
  "category-browse",
  "city-category",
  "partner-search",
  "partner-detail",
  "semantic-search",
  "greeting",
  "thanks",
  "frustration",
  "off-topic",
  "boundary",
  "injection",
  "unknown",
]);
export type Intent = z.infer<typeof IntentEnum>;

// ── Retrieved partner reference (stored in memory per turn) ──
export const RetrievedPartnerSchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string(),
});

// ── Conversation entry (one message + what was shown) ──
export const ConversationEntrySchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  retrievedPartners: z.array(RetrievedPartnerSchema).optional(),
});
export type ConversationEntry = z.infer<typeof ConversationEntrySchema>;

// ── Workflow input ──
export const WorkflowInputSchema = z.object({
  message: z.string(),
  threadId: z.string(),
  resourceId: z.string(),
  conversationHistory: z
    .array(ConversationEntrySchema)
    .optional()
    .default([]),
});
export type WorkflowInput = z.infer<typeof WorkflowInputSchema>;

// Helper: accept null OR undefined for optional fields (LLMs return null, Zod wants undefined)
const optStr = z.string().nullish().transform((v) => v ?? undefined);
const optNum = z.number().nullish().transform((v) => v ?? undefined);

// ── Enhance step output (query enhancement + intent + slots) ──
export const EnhanceOutputSchema = z.object({
  enhancedQuery: z.string(),
  intent: IntentEnum,
  confidence: z.enum(["high", "medium", "low"]),
  slots: z.object({
    city: optStr,
    category: optStr,
    sporttype: optStr,
    partner_name: optStr,
    query: optStr,
    limit: optNum,
  }),
  skipSearch: z.boolean(),
  staticResponse: optStr,
  language: z.string(),
  is_frustrated: z.boolean(),
  userMessage: z.string(),
  // RAG Fusion: multiple query reformulations for better recall
  queryVariants: z.array(z.string()).optional().default([]),
});
export type EnhanceOutput = z.infer<typeof EnhanceOutputSchema>;

// ── Rich partner (full data for reranking) ──
export const RichPartnerSchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string(),
  address: z.string(),
  category: z.string(),
  sporttypes: z.array(z.string()),
  description: z.string(),
  courseNames: z.array(z.string()),
});
export type RichPartner = z.infer<typeof RichPartnerSchema>;

// ── Search step output ──
export const SearchOutputSchema = z.object({
  enhanceOutput: EnhanceOutputSchema,
  candidates: z.array(RichPartnerSchema),
  searchStrategy: z.string(),
  selfCorrected: z.boolean(),
  correctionStrategy: z.string().optional(),
  // Passthrough for non-search results
  metadataResult: z.any().optional(),
  cityOverviewResult: z.any().optional(),
  partnerDetailResult: z.any().optional(),
});
export type SearchOutput = z.infer<typeof SearchOutputSchema>;

// ── Ranked partner (after reranking with CRAG tiers) ──
export const RankedPartnerSchema = RichPartnerSchema.extend({
  relevanceScore: z.number(),
  relevanceReason: z.string(),
  // CRAG tier: perfect (8-10), good (5-7), weak (3-4)
  tier: z.enum(["perfect", "good", "weak"]).default("good"),
});
export type RankedPartner = z.infer<typeof RankedPartnerSchema>;

// ── Rerank step output ──
export const RerankOutputSchema = z.object({
  enhanceOutput: EnhanceOutputSchema,
  rankedPartners: z.array(RankedPartnerSchema),
  searchStrategy: z.string(),
  selfCorrected: z.boolean(),
  correctionStrategy: z.string().optional(),
  metadataResult: z.any().optional(),
  cityOverviewResult: z.any().optional(),
  partnerDetailResult: z.any().optional(),
});
export type RerankOutput = z.infer<typeof RerankOutputSchema>;

// ── Memory payload (saved after each turn for the feedback loop) ──
export const MemoryPayloadSchema = z.object({
  enhancedQuery: z.string(),
  retrievedPartners: z.array(RetrievedPartnerSchema),
  response: z.string(),
});

// ── Workflow output ──
export const WorkflowOutputSchema = z.object({
  text: z.string(),
  intent: IntentEnum,
  confidence: z.enum(["high", "medium", "low"]),
  selfCorrected: z.boolean(),
  memoryPayload: MemoryPayloadSchema.optional(),
});
export type WorkflowOutput = z.infer<typeof WorkflowOutputSchema>;
