import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

/**
 * Get conversation history for a thread.
 * Returns the history array or empty array if thread doesn't exist.
 */
export const getConversation = query({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .first();
    return conversation?.history ?? [];
  },
});

/**
 * Upsert conversation history for a thread.
 * Creates a new conversation or updates the existing one.
 */
export const updateConversation = mutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        history: args.history,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("conversations", {
        threadId: args.threadId,
        history: args.history,
        updatedAt: Date.now(),
      });
    }
  },
});
