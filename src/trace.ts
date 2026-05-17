/**
 * Trace Script — Shows exactly what happens at each step of the pipeline.
 * User-friendly, non-technical output with colors and clear labels.
 *
 * Usage:
 *   npx tsx src/trace.ts "yoga in dort"
 *   npx tsx src/trace.ts   (interactive mode)
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { createInterface } from "readline";
import { buildSessionSummary } from "./mastra/workflows/sessionSummary";
import { buildEnhanceUserPrompt } from "./mastra/workflows/enhancePrompt";
import { preProcess } from "./mastra/guardrails";
import { postProcess } from "./mastra/guardrails";
import { embedSingle } from "./mastra/rag/embedPartners";
import { mastra } from "./mastra/mastraDev";
import type { ConversationEntry } from "./mastra/workflows/schemas";

// ── Colors for terminal output ──
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BLUE = "\x1b[34m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";

function header(text: string) {
  console.log(`\n${BOLD}${BLUE}${"═".repeat(60)}${RESET}`);
  console.log(`${BOLD}${BLUE}  ${text}${RESET}`);
  console.log(`${BOLD}${BLUE}${"═".repeat(60)}${RESET}\n`);
}

function step(num: number, name: string, detail: string) {
  console.log(`${BOLD}${GREEN}  STEP ${num}: ${name}${RESET}`);
  console.log(`  ${DIM}${detail}${RESET}`);
  console.log();
}

function label(key: string, value: string) {
  console.log(`    ${CYAN}${key}:${RESET} ${value}`);
}

function divider() {
  console.log(`  ${DIM}${"─".repeat(50)}${RESET}`);
}

function warn(text: string) {
  console.log(`    ${YELLOW}⚠ ${text}${RESET}`);
}

function success(text: string) {
  console.log(`    ${GREEN}✓ ${text}${RESET}`);
}

function blocked(text: string) {
  console.log(`    ${RED}✗ ${text}${RESET}`);
}

// ── State ──
const conversationHistory: ConversationEntry[] = [];
const threadId = `trace-${Date.now()}`;

async function traceQuery(message: string) {
  const startTotal = Date.now();

  header(`Tracing: "${message}"`);

  // ════════════════════════════════════════════
  // STEP 0: PRE-PROCESS GUARD
  // ════════════════════════════════════════════
  step(0, "SAFETY GUARD", "Checks for prompt injection before anything else");

  const guardStart = Date.now();
  const guard = preProcess(message);
  const guardMs = Date.now() - guardStart;

  if (guard.blocked) {
    blocked(`BLOCKED — ${guard.reason}`);
    label("Response", guard.safeResponse || "");
    label("Time", `${guardMs}ms`);
    label("LLM calls", "0 (no tokens spent)");
    console.log(`\n${BOLD}${RED}  Pipeline stopped — injection detected.${RESET}\n`);
    return;
  }
  success(`PASSED — message is safe (${guardMs}ms)`);
  console.log();

  // ════════════════════════════════════════════
  // STEP 1: SESSION SUMMARY
  // ════════════════════════════════════════════
  step(1, "SESSION SUMMARY", "Builds a briefing from conversation history (no LLM, pure code)");

  const summary = buildSessionSummary(conversationHistory);
  if (conversationHistory.length === 0) {
    label("Context", "First message — no previous conversation");
  } else {
    label("Turns so far", `${summary.turnCount}`);
    if (summary.currentCity) label("Current city", summary.currentCity);
    if (summary.currentCategory) label("Current category", summary.currentCategory);
    console.log();
    console.log(`${DIM}    --- Session Briefing (what the LLM sees) ---${RESET}`);
    for (const line of summary.markdown.split("\n").slice(0, 15)) {
      console.log(`    ${DIM}${line}${RESET}`);
    }
  }
  console.log();

  // ════════════════════════════════════════════
  // STEP 2: QUERY ENHANCEMENT
  // ════════════════════════════════════════════
  step(2, "QUERY ENHANCEMENT", "LLM rewrites your message into a precise search query");

  const enhancePrompt = buildEnhanceUserPrompt(message, summary.markdown);
  label("LLM model", "Gemini 2.0 Flash (via OpenRouter)");
  label("What the LLM receives", `Session briefing + "${message}"`);

  const enhanceStart = Date.now();
  const enhanceAgent = mastra.getAgent("enhanceAgent");

  let enhanceOutput: any;
  try {
    const result = await enhanceAgent.generate(enhancePrompt, {
      structuredOutput: {
        schema: (await import("./mastra/workflows/schemas")).EnhanceOutputSchema.omit({ userMessage: true }),
      },
    });
    enhanceOutput = result.object;
  } catch {
    const fallback = await enhanceAgent.generate(enhancePrompt);
    try {
      const jsonMatch = (fallback.text || "").match(/\{[\s\S]*\}/);
      enhanceOutput = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      enhanceOutput = {};
    }
  }
  const enhanceMs = Date.now() - enhanceStart;

  // Apply defaults
  enhanceOutput = {
    enhancedQuery: enhanceOutput?.enhancedQuery || message,
    intent: enhanceOutput?.intent || "unknown",
    confidence: enhanceOutput?.confidence || "low",
    slots: enhanceOutput?.slots || {},
    skipSearch: enhanceOutput?.skipSearch ?? false,
    language: enhanceOutput?.language || "de",
    is_frustrated: enhanceOutput?.is_frustrated ?? false,
    staticResponse: enhanceOutput?.staticResponse,
  };

  console.log();
  divider();
  label("Your message", `"${message}"`);
  label("Enhanced query", `"${enhanceOutput.enhancedQuery}"`);
  label("Intent", `${enhanceOutput.intent} (${enhanceOutput.confidence} confidence)`);

  const slots = enhanceOutput.slots;
  const slotParts: string[] = [];
  if (slots.city) slotParts.push(`city: ${slots.city}`);
  if (slots.category) slotParts.push(`category: ${slots.category}`);
  if (slots.sporttype) slotParts.push(`sporttype: ${slots.sporttype}`);
  if (slots.partner_name) slotParts.push(`partner: ${slots.partner_name}`);
  if (slots.query) slotParts.push(`query: ${slots.query}`);
  label("Extracted data", slotParts.length > 0 ? slotParts.join(", ") : "(none)");
  label("Language", enhanceOutput.language);
  label("Skip search?", enhanceOutput.skipSearch ? "Yes (greeting/injection/off-topic)" : "No — searching");
  label("Time", `${enhanceMs}ms`);
  console.log();

  if (enhanceOutput.skipSearch) {
    console.log(`${BOLD}${MAGENTA}  FINAL RESPONSE${RESET}`);
    console.log(`  ${enhanceOutput.staticResponse || "(brief LLM greeting)"}`);
    console.log(`\n  ${DIM}Total time: ${Date.now() - startTotal}ms | LLM calls: 1${RESET}\n`);
    return;
  }

  // ════════════════════════════════════════════
  // STEP 3: SEARCH
  // ════════════════════════════════════════════

  const searchStart = Date.now();
  const CONVEX_SITE_URL = process.env.CONVEX_SITE_URL || "http://127.0.0.1:3211";

  // Handle broad-overview and city-explore separately (they use different endpoints)
  if (enhanceOutput.intent === "broad-overview") {
    step(3, "METADATA LOOKUP", "Fetching full network overview (all cities, categories, sporttypes)");
    try {
      const res = await fetch(`${CONVEX_SITE_URL}/api/metadata`);
      const metadata = await res.json();
      label("Cities", `${metadata.cities?.length || 0}`);
      label("Categories", `${metadata.categories?.length || 0}`);
      label("Time", `${Date.now() - searchStart}ms`);

      // Skip reranking, go straight to response
      step(4, "LLM RERANKING", "Skipped — metadata doesn't need reranking");
      step(5, "RESPONSE GENERATION", "LLM formats the metadata into a friendly overview");

      const respondStart = Date.now();
      const contextParts = [`[Language: ${enhanceOutput.language}]`, `[Intent: broad-overview]`, "", "## Network Overview Data", JSON.stringify(metadata, null, 2)];
      const prompt = `${contextParts.join("\n")}\n\n---\n\nUser message: "${message}"\n\nRespond with a complete overview. List top cities with counts, top categories with counts. Be helpful.`;
      const responseAgent = mastra.getAgent("responseAgent");
      const responseResult = await responseAgent.generate(prompt);
      const postGuard = postProcess(responseResult.text || "");
      label("Time", `${Date.now() - respondStart}ms`);

      header("FINAL RESPONSE");
      console.log(`  ${postGuard.finalResponse}`);
      console.log(`\n  ${DIM}Total time: ${Date.now() - startTotal}ms | LLM calls: 2${RESET}\n`);

      conversationHistory.push({ role: "user", content: message });
      conversationHistory.push({ role: "assistant", content: postGuard.finalResponse });
      return;
    } catch (e: any) {
      warn(`Metadata fetch failed: ${e.message}`);
    }
  }

  if (enhanceOutput.intent === "city-explore" && slots.city) {
    step(3, "CITY OVERVIEW", `Fetching breakdown for ${slots.city}`);
    try {
      const res = await fetch(`${CONVEX_SITE_URL}/api/city-overview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city: slots.city }),
      });
      const overview = await res.json();
      label("Total partners", `${overview?.totalPartners || 0}`);
      label("Categories", (overview?.categories || []).map((c: any) => `${c.name} (${c.count})`).join(", "));
      label("Time", `${Date.now() - searchStart}ms`);

      step(4, "LLM RERANKING", "Skipped — city overview doesn't need reranking");
      step(5, "RESPONSE GENERATION", `LLM formats the ${slots.city} overview`);

      const respondStart = Date.now();
      const contextParts = [`[Language: ${enhanceOutput.language}]`, `[Intent: city-explore]`, "", "## City Overview Data", JSON.stringify(overview, null, 2)];
      const prompt = `${contextParts.join("\n")}\n\n---\n\nUser message: "${message}"\n\nPresent the city overview with category breakdown and sample partners.`;
      const responseAgent = mastra.getAgent("responseAgent");
      const responseResult = await responseAgent.generate(prompt);
      const postGuard = postProcess(responseResult.text || "");
      label("Time", `${Date.now() - respondStart}ms`);

      header("FINAL RESPONSE");
      console.log(`  ${postGuard.finalResponse}`);
      console.log(`\n  ${DIM}Total time: ${Date.now() - startTotal}ms | LLM calls: 2${RESET}\n`);

      conversationHistory.push({ role: "user", content: message });
      conversationHistory.push({ role: "assistant", content: postGuard.finalResponse });
      return;
    } catch (e: any) {
      warn(`City overview failed: ${e.message}`);
    }
  }

  step(3, "HYBRID SEARCH", "BM25 keyword matching + vector similarity + Reciprocal Rank Fusion");

  // Embed the query
  label("Embedding model", "text-embedding-3-small (via OpenRouter)");
  const embedStart = Date.now();
  let queryVector: number[];
  try {
    queryVector = await embedSingle(enhanceOutput.enhancedQuery);
    label("Embedding", `${queryVector.length} dimensions (${Date.now() - embedStart}ms)`);
  } catch (e: any) {
    warn(`Embedding failed: ${e.message}`);
    queryVector = [];
  }

  // Call hybrid search
  label("Search method", "BM25 (keyword) + Cosine Similarity (vector) → RRF merge");
  label("Filters", `city: ${slots.city || "any"}, category: ${slots.category || "any"}`);

  let searchResults: any = { partners: [] };
  try {
    const res = await fetch(`${CONVEX_SITE_URL}/api/hybrid-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queryText: enhanceOutput.enhancedQuery,
        queryVector,
        city: slots.city,
        category: slots.category,
        limit: 20,
      }),
    });
    searchResults = await res.json();
  } catch (e: any) {
    warn(`Search failed: ${e.message}`);
  }
  const searchMs = Date.now() - searchStart;

  const candidates = searchResults.partners || [];
  label("Candidates found", `${candidates.length}`);
  if (candidates.length > 0) {
    console.log();
    console.log(`    ${DIM}Top results from hybrid search:${RESET}`);
    candidates.slice(0, 5).forEach((p: any, i: number) => {
      console.log(`    ${DIM}  ${i + 1}. ${p.name} — ${p.city} (${p.category})${RESET}`);
    });
    if (candidates.length > 5) {
      console.log(`    ${DIM}  ... and ${candidates.length - 5} more${RESET}`);
    }
  } else {
    warn("No results from hybrid search — running self-correction...");

    // Self-correction cascade
    // Level 1: Drop category filter, search city only
    if (slots.city) {
      console.log(`    ${DIM}  Trying: drop category, search all of ${slots.city}...${RESET}`);
      try {
        const res = await fetch(`${CONVEX_SITE_URL}/api/hybrid-search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            queryText: enhanceOutput.enhancedQuery,
            queryVector,
            city: slots.city,
            limit: 20,
          }),
        });
        const broader = await res.json();
        if (broader.partners?.length > 0) {
          searchResults = broader;
          success(`Found ${broader.partners.length} partners without category filter`);
        }
      } catch {}
    }

    // Level 2: Get city overview
    if ((searchResults.partners || []).length === 0 && slots.city) {
      console.log(`    ${DIM}  Trying: city overview for ${slots.city}...${RESET}`);
      try {
        const res = await fetch(`${CONVEX_SITE_URL}/api/city-overview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ city: slots.city }),
        });
        const overview = await res.json();
        if (overview && overview.totalPartners > 0) {
          searchResults = { cityOverview: overview, partners: [] };
          success(`City overview: ${overview.totalPartners} partners in ${slots.city}`);
        }
      } catch {}
    }

    // Level 3: Get metadata
    if ((searchResults.partners || []).length === 0 && !searchResults.cityOverview) {
      console.log(`    ${DIM}  Trying: full network metadata...${RESET}`);
      try {
        const res = await fetch(`${CONVEX_SITE_URL}/api/metadata`);
        searchResults = { metadata: await res.json(), partners: [] };
        success("Showing full network overview");
      } catch {}
    }
  }
  const searchMsFinal = Date.now() - searchStart;
  label("Time", `${searchMsFinal}ms`);
  console.log();

  // Re-read candidates after self-correction
  const finalCandidates = searchResults.partners || [];

  // ════════════════════════════════════════════
  // STEP 4: LLM RERANKING
  // ════════════════════════════════════════════
  step(4, "LLM RERANKING", "Gemini Flash scores each candidate 0-10 for relevance");

  let rankedPartners: any[] = [];
  let rerankMs = 0;

  if (finalCandidates.length <= 5) {
    label("Decision", `Only ${finalCandidates.length} candidates — skipping reranking (already good)`);
    rankedPartners = finalCandidates.map((c: any) => ({
      ...c,
      relevanceScore: 10,
      relevanceReason: "direct match",
    }));
  } else {
    const rerankStart = Date.now();
    label("LLM model", "Gemini 2.0 Flash (via OpenRouter)");
    label("Candidates sent", `${Math.min(finalCandidates.length, 20)}`);

    const { buildRerankUserPrompt } = await import("./mastra/workflows/rerankPrompt");
    const rerankPrompt = buildRerankUserPrompt(
      enhanceOutput.enhancedQuery,
      enhanceOutput.intent,
      slots.city,
      slots.category,
      finalCandidates.slice(0, 20),
    );

    const rerankAgent = mastra.getAgent("rerankAgent");
    try {
      const { z } = await import("zod");
      const RerankSchema = z.array(z.object({ index: z.number(), score: z.number(), reason: z.string() }));
      const result = await rerankAgent.generate(rerankPrompt, {
        structuredOutput: { schema: RerankSchema },
      });
      const scores = result.object as any[];
      rankedPartners = scores
        .filter((s: any) => s.score >= 3 && s.index >= 1 && s.index <= finalCandidates.length)
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 10)
        .map((s: any) => ({
          ...finalCandidates[s.index - 1],
          relevanceScore: s.score,
          relevanceReason: s.reason,
        }));
    } catch {
      rankedPartners = finalCandidates.slice(0, 10).map((c: any) => ({
        ...c,
        relevanceScore: 7,
        relevanceReason: "ranked by hybrid search",
      }));
    }
    rerankMs = Date.now() - rerankStart;
    label("Time", `${rerankMs}ms`);
  }

  console.log();
  if (rankedPartners.length > 0) {
    console.log(`    ${DIM}Reranked results:${RESET}`);
    rankedPartners.slice(0, 5).forEach((p: any, i: number) => {
      console.log(
        `    ${BOLD}  ${i + 1}. ${p.name}${RESET} — ${p.city} ${DIM}(score: ${p.relevanceScore}/10 — ${p.relevanceReason})${RESET}`,
      );
    });
  }
  console.log();

  // ════════════════════════════════════════════
  // STEP 5: RESPONSE GENERATION
  // ════════════════════════════════════════════
  step(5, "RESPONSE GENERATION", "LLM turns the ranked results into a friendly answer");

  const respondStart = Date.now();
  label("LLM model", "Gemini 2.0 Flash (via OpenRouter)");
  label("Context", `${rankedPartners.length} ranked partners + intent + language`);

  // Build context like the respond step does
  const contextParts: string[] = [];
  contextParts.push(`[Language: ${enhanceOutput.language}]`);
  contextParts.push(`[Intent: ${enhanceOutput.intent}]`);

  if (rankedPartners.length === 0 && !searchResults.cityOverview && !searchResults.metadata) {
    contextParts.push("[IMPORTANT: Search returned 0 results. Do NOT invent partner names. Say you couldn't find results and suggest alternatives.]");
  }

  contextParts.push("");

  if (rankedPartners.length > 0) {
    contextParts.push("## Search Results");
    contextParts.push(`Query: "${enhanceOutput.enhancedQuery}"`);
    rankedPartners.forEach((p: any, i: number) => {
      contextParts.push(`${i + 1}. **${p.name}** (Score: ${p.relevanceScore}/10)`);
      contextParts.push(`   Address: ${p.address || "N/A"}`);
      contextParts.push(`   Category: ${p.category} | Sports: ${(p.sporttypes || []).join(", ")}`);
      if (p.relevanceReason) contextParts.push(`   Why: ${p.relevanceReason}`);
    });
  }

  if (searchResults.cityOverview) {
    contextParts.push(`\n## City Overview (self-corrected — original search was empty)`);
    contextParts.push(JSON.stringify(searchResults.cityOverview, null, 2));
  }

  if (searchResults.metadata) {
    contextParts.push(`\n## Network Overview (self-corrected — no results for original query)`);
    contextParts.push(JSON.stringify(searchResults.metadata, null, 2));
  }

  const prompt = `${contextParts.join("\n")}\n\n---\n\nUser message: "${message}"\n\nRespond naturally. Lead with the answer, use bulleted lists.`;

  const responseAgent = mastra.getAgent("responseAgent");
  const responseResult = await responseAgent.generate(prompt);
  const rawText = responseResult.text || "";
  const respondMs = Date.now() - respondStart;

  // Post-process guard
  const postGuard = postProcess(rawText);
  if (!postGuard.passed) {
    warn(`Post-process guard caught: ${postGuard.reason}`);
  }

  label("Time", `${respondMs}ms`);
  console.log();

  // ════════════════════════════════════════════
  // FINAL RESPONSE
  // ════════════════════════════════════════════
  header("FINAL RESPONSE");
  console.log(`  ${postGuard.finalResponse}`);

  // ════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════
  const totalMs = Date.now() - startTotal;
  console.log();
  console.log(`${BOLD}${BLUE}${"─".repeat(60)}${RESET}`);
  console.log(`${BOLD}  PIPELINE SUMMARY${RESET}`);
  console.log(`${BOLD}${BLUE}${"─".repeat(60)}${RESET}`);
  console.log(`    ${CYAN}Total time:${RESET}      ${totalMs}ms`);
  console.log(`    ${CYAN}LLM calls:${RESET}       ${candidates.length > 5 ? 3 : 2} (enhance${candidates.length > 5 ? " + rerank" : ""} + respond)`);
  console.log(`    ${CYAN}Embedding calls:${RESET} 1`);
  console.log(`    ${CYAN}Convex queries:${RESET}  1 (hybrid search)`);
  console.log(`    ${CYAN}Intent:${RESET}          ${enhanceOutput.intent} (${enhanceOutput.confidence})`);
  console.log(`    ${CYAN}Enhanced query:${RESET}  "${enhanceOutput.enhancedQuery}"`);
  console.log(`    ${CYAN}Partners found:${RESET}  ${candidates.length} candidates → ${rankedPartners.length} ranked`);
  console.log(`    ${CYAN}Self-corrected:${RESET}  No`);
  console.log();
  console.log(`    ${DIM}Timing breakdown:${RESET}`);
  console.log(`    ${DIM}  Guard:     ${guardMs}ms${RESET}`);
  console.log(`    ${DIM}  Enhance:   ${enhanceMs}ms${RESET}`);
  console.log(`    ${DIM}  Search:    ${searchMs}ms${RESET}`);
  console.log(`    ${DIM}  Rerank:    ${rerankMs}ms${RESET}`);
  console.log(`    ${DIM}  Respond:   ${respondMs}ms${RESET}`);
  console.log();

  // Save to memory for next turn
  const retrieved = rankedPartners.map((p: any) => ({ id: p.id || "", name: p.name, city: p.city }));
  conversationHistory.push({ role: "user", content: message });
  conversationHistory.push({ role: "assistant", content: postGuard.finalResponse, retrievedPartners: retrieved });
  while (conversationHistory.length > 20) conversationHistory.shift();
}

async function main() {
  const singleQuery = process.argv[2];

  if (singleQuery) {
    await traceQuery(singleQuery);
    return;
  }

  // Interactive mode
  console.log(`\n${BOLD}${BLUE}🔍 Sport Navi Pipeline Tracer${RESET}`);
  console.log(`${DIM}   See exactly what happens at each step.${RESET}`);
  console.log(`${DIM}   Type a message to trace, 'quit' to exit.${RESET}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    rl.question(`${BOLD}You: ${RESET}`, async (input) => {
      const msg = input.trim();
      if (!msg || msg === "quit" || msg === "exit") {
        console.log("\nBye!");
        rl.close();
        return;
      }

      try {
        await traceQuery(msg);
      } catch (e: any) {
        console.log(`\n${RED}Error: ${e.message}${RESET}\n`);
      }

      ask();
    });
  };

  ask();
}

main().catch(console.error);
