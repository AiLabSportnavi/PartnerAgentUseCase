import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Main partners table — stores cleaned, structured partner data
  partners: defineTable({
    // Original API ID for deduplication
    externalId: v.number(),
    name: v.string(),
    city: v.string(),
    address: v.string(),
    category: v.string(),
    sporttypes: v.array(v.string()),
    description: v.string(), // Plain text, HTML stripped
    phone: v.optional(v.string()),
    homepage: v.optional(v.string()),
    email: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    logoUrl: v.optional(v.string()),
    isUnstaffed: v.boolean(),
    // Courses with tier-based limits
    courses: v.array(
      v.object({
        name: v.string(),
        sporttypes: v.array(v.string()),
        usageLimits: v.optional(v.any()),
        courseFees: v.optional(v.any()),
      })
    ),
    // Sync metadata
    activeFrom: v.optional(v.string()),
    activeUntil: v.optional(v.string()),
    lastSyncedAt: v.number(),

    // Hybrid search fields (populated during sync)
    // SHA-256 hash of semantic content — detects when re-embedding is needed
    contentHash: v.optional(v.string()),
    // Combined text for BM25 full-text search (name + sporttypes + description + courses)
    searchText: v.optional(v.string()),
    // Vector embedding of searchText for semantic cosine similarity search (1536 dims)
    embedding: v.optional(v.array(v.number())),
  })
    .index("by_externalId", ["externalId"])
    .index("by_city", ["city"])
    .index("by_category", ["category"])
    .index("by_name", ["name"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["city", "category"],
    })
    // BM25 search on the full combined text, filterable by city/category
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["city", "category"],
    }),

  // Aggregated metadata — loaded into agent context
  metadata: defineTable({
    key: v.string(), // "cities", "categories", "sporttypes"
    data: v.any(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  // Conversation sessions — persists chat history for multi-turn support
  conversations: defineTable({
    threadId: v.string(),
    history: v.array(
      v.object({
        role: v.string(),
        content: v.string(),
        retrievedPartners: v.optional(
          v.array(
            v.object({
              id: v.string(),
              name: v.string(),
              city: v.string(),
            })
          )
        ),
      })
    ),
    updatedAt: v.number(),
  }).index("by_threadId", ["threadId"]),

  // Sync log — track sync runs
  syncLog: defineTable({
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    partnersAdded: v.number(),
    partnersUpdated: v.number(),
    partnersRemoved: v.number(),
    totalPartners: v.number(),
    status: v.string(), // "running", "completed", "failed"
    error: v.optional(v.string()),
  }),
});
