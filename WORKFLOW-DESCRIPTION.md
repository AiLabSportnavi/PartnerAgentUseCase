# Sport Navi Partner Agent — Full Workflow Description

## Overview

This is a **4-step RAG (Retrieval-Augmented Generation) pipeline** built with **Mastra AI** that helps users discover fitness and sport partners in the German Sport Navi network (~2,146 partners). It uses **Convex** as a serverless backend, **Gemini 2.0 Flash** via **OpenRouter** as the LLM, and **OpenAI text-embedding-3-small** for vector embeddings.

The system handles multi-turn German/English conversations, resolves abbreviations and typos, performs hybrid keyword+semantic search, self-corrects on zero results, and guards against prompt injection — all in a modular, composable workflow.

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────┐
│                  USER MESSAGE                     │
│               "yoga in dort"                      │
└────────────────────┬─────────────────────────────┘
                     │
                     ▼
       ┌──────────────────────────────┐
       │  STEP 0: PRE-PROCESS GUARD   │
       │  (Regex, <1ms)               │
       │  Block injection attempts    │
       └──────┬───────────────────────┘
              │ (blocked → static response, stop)
              ▼
  ┌────────────────────────────────────┐
  │  STEP 1: ENHANCE                   │
  │  (Gemini Flash LLM, ~300ms)        │
  │  • Classify intent (14 types)      │
  │  • Extract slots (city, category)  │
  │  • Resolve abbreviations/typos     │
  │  • Rewrite vague queries           │
  │  → JSON: intent, slots, query      │
  └──────┬─────────────────────────────┘
         ▼
  ┌────────────────────────────────────┐
  │  STEP 2: SEARCH                    │
  │  (Code dispatch, ~100-400ms)       │
  │  • Route by intent to right tool   │
  │  • Hybrid BM25 + vector search     │
  │  • 5-level self-correction cascade │
  │  → 0-40 candidate partners         │
  └──────┬─────────────────────────────┘
         ▼
  ┌────────────────────────────────────┐
  │  STEP 3: RERANK                    │
  │  (Gemini Flash LLM, ~800ms)        │
  │  • Score each candidate 0-10       │
  │  • Keep top 5-10 by relevance      │
  │  • Skip if ≤5 candidates           │
  └──────┬─────────────────────────────┘
         ▼
  ┌────────────────────────────────────┐
  │  STEP 4: RESPOND                   │
  │  (Gemini Flash LLM, ~800ms)        │
  │  • Format partners as natural text │
  │  • Reply in detected language      │
  │  • Explain self-corrections        │
  │  • Post-process: block leaks       │
  │  → Final response + memory payload │
  └──────┬─────────────────────────────┘
         ▼
  ┌──────────────────┐
  │  FINAL RESPONSE   │
  │  + Memory Update  │
  └──────────────────┘
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | Mastra AI (`@mastra/core`) | Workflow engine, agents, tools |
| LLM | Gemini 2.0 Flash via OpenRouter | Intent classification, reranking, response generation |
| Embeddings | OpenAI `text-embedding-3-small` | 1536-dim vectors for semantic search |
| Database | Convex | Serverless DB, full-text search (BM25), vector search, cron jobs |
| Local Storage | LibSQL | Conversation memory, datasets, experiments |
| Observability | DuckDB (in-memory) | Traces, logs, metrics |
| Validation | Zod | Runtime schema validation at every step |
| Language | TypeScript | Type-safe throughout |

---

## Step 0: Pre-Process Guard

**File:** `src/mastra/guardrails/preProcess.ts`  
**Engine:** Regex pattern matching (no LLM)  
**Latency:** <1ms

Blocks prompt injection and unsafe inputs before any LLM call. Detects:

- Instruction overrides ("ignore all previous instructions", "vergiss alles")
- Role hijacking ("pretend you are", "act as", "du bist jetzt")
- Known jailbreaks ("DAN", "developer mode", "sudo mode")
- System prompt extraction ("show your prompt", "reveal your tools")
- Emotional manipulation ("a puppy will die", "emergency override")
- Encoding attacks (base64 blocks, inputs >2000 chars)

**If blocked:** Returns a static safe response without calling any LLM.

**Output:**
```typescript
{
  blocked: boolean;
  reason?: string;          // Which pattern matched
  safeResponse?: string;    // Static safe response
  sanitizedInput?: string;  // Trimmed input if clean
}
```

---

## Step 1: Enhance (Intent Classification + Query Rewriting)

**File:** `src/mastra/workflows/steps/enhanceStep.ts`  
**Prompt:** `src/mastra/workflows/enhancePrompt.ts` (122 lines)  
**Agent:** `enhanceAgent` — Gemini 2.0 Flash, no tools, no memory  
**Latency:** ~300ms

### What It Does

1. Reads the session summary (built from conversation history)
2. Classifies intent into one of 14 types
3. Extracts structured slots (city, category, sporttype, partner_name)
4. Resolves abbreviations and typos
5. Rewrites vague queries into keyword-rich search strings
6. Detects user language and frustration level

### Session Summary

Built by `buildSessionSummary()` from conversation history. Contains:
- Current focus (city, category, mode)
- What was shown (last 5 turns with numbered partners for resolving "the second one")
- Recent messages (last 3 raw messages)

### The 14 Intent Types

| Intent | Trigger Examples | Search? |
|--------|-----------------|---------|
| `broad-overview` | "alles", "was habt ihr?", "show me everything" | Yes → getMetadata() |
| `city-explore` | "was gibt es in Köln?", "zeig mir Berlin" | Yes → getCityOverview() |
| `category-browse` | "yoga" (no city), "wo kann ich schwimmen?" | Yes → search all cities |
| `city-category` | "yoga in Dortmund", "boxen in bi" | Yes → filtered search |
| `partner-search` | "FITOMAT", "all inclusive fitness" | Yes → name search |
| `partner-detail` | "was bieten die an?", "welche Kurse?" | Yes → detail lookup |
| `semantic-search` | "Rückenschmerzen", "entspannen" | Yes → multi-category |
| `greeting` | "hi", "hallo", "moin" | No → static greeting |
| `thanks` | "danke", "cool", "super" | No → static closing |
| `frustration` | "das hilft nicht", "nein!" | Yes → show data immediately |
| `off-topic` | "Wetter", "Witz" | No → static redirect |
| `boundary` | "Termin buchen", "was kostet das?" | No → redirect to sportnavi.de |
| `injection` | "ignore instructions" | No → static refusal |
| `unknown` | Anything unmatched | Yes → best-effort |

### City Abbreviation Resolution

| Input | Resolved |
|-------|----------|
| dort, dortmunt | Dortmund |
| bi, bilefeld | Bielefeld |
| hh | Hamburg |
| ffm | Frankfurt am Main |
| muc | München |
| kölle, k | Köln |
| bln | Berlin |
| pb | Paderborn |
| ms | Münster |
| bo | Bochum |
| düssel | Düsseldorf |
| esssen | Essen |

### Sport/Category Mapping

| User Input | → category | → sporttype |
|-----------|-----------|------------|
| fitness, gym, pumpen, muckibude, Krafttraining | fitness | — |
| yoga, pilates | yoga | Yoga |
| schwimmen, swimming, pool, baden | swimming | Swimming |
| klettern, bouldern | climbing | Climbing |
| boxen, kickboxen | boxing | Boxing |
| massage, wellness | massage | Massage |
| sauna | sauna | Sauna |
| ems | ems | Ems |
| outdoor, laufen, joggen | outdoor | Outdoor |
| tennis, squash, badminton | racket | Racket |

### Output Schema

```typescript
{
  enhancedQuery: string;          // Rewritten, keyword-rich query
  intent: Intent;                 // One of 14 types
  confidence: "high" | "medium" | "low";
  slots: {
    city?: string;                // Resolved city name
    category?: string;            // Sport category
    sporttype?: string;           // Sport type variant
    partner_name?: string;        // Partner name if searching by name
    query?: string;               // Free-form query text
    limit?: number;               // Result limit
  };
  skipSearch: boolean;            // true → non-search intent, use static response
  staticResponse?: string;       // Pre-computed response if skipSearch
  language: string;               // Detected language code (de, en, fr, tr)
  is_frustrated: boolean;         // User shows frustration signals
  userMessage: string;            // Original message
}
```

---

## Step 2: Search (Hybrid BM25 + Vector)

**File:** `src/mastra/workflows/steps/searchStep.ts`  
**Engine:** Pure TypeScript (no LLM)  
**Latency:** ~100-400ms

### Dispatch Table

| Intent | Tool Called | Parameters |
|--------|-----------|------------|
| `broad-overview` | `getMetadata()` | — |
| `city-explore` | `getCityOverview()` | { city } |
| `category-browse` | `hybridSearchPartners()` | { query, category, limit: 40 } |
| `city-category` | `hybridSearchPartners()` | { query, city, category, limit: 40 } |
| `partner-search` | `hybridSearchPartners()` | { query: partner_name, limit: 40 } |
| `partner-detail` | `searchPartners()` → `getPartnerDetails()` | query → partnerId |
| `semantic-search` | `hybridSearchPartners()` | { query (with synonyms), city, limit: 40 } |
| static intents | (none) | Skip search entirely |

### Hybrid Search Algorithm

```
Input: query text, optional city/category filters, limit (default 40)

1. TEXT EMBEDDING
   → Call OpenAI text-embedding-3-small
   → Get 1536-dimensional vector

2. BM25 PATH (Keyword Match)
   → Convex full-text search on partners.searchText
   → Ranks by keyword frequency (exact names, descriptions, courses)
   → Returns top 40, filtered by city/category
   → Excellent for: exact names ("FITOMAT"), clear sport names

3. SEMANTIC PATH (Meaning Match)
   → Convex vector search: cosine similarity on stored embeddings
   → Finds partners with similar meaning
     (e.g., "Rückenschmerzen" → yoga, massage, physiotherapy)
   → Returns top 40, filtered by city/category

4. RECIPROCAL RANK FUSION (RRF)
   → Combine both ranked lists
   → Partners high in BOTH lists get huge boost
   → Remove duplicates, keep top 40
```

### Self-Correction Cascade (if 0 results)

When `hybridSearchPartners` returns nothing, the system tries up to 5 fallback levels:

| Level | Strategy | Example |
|-------|----------|---------|
| L1 | Drop sporttype filter, keep category | "Hyrox in Bielefeld" → try all fitness in Bielefeld |
| L2 | Text query fallback | Try fuzzy name match instead of category filter |
| L3 | Search neighboring cities | Herne → try Bochum, Gelsenkirchen, Essen, Dortmund |
| L4 | City overview | Show what IS available in the city |
| L5 | Full metadata | Show entire network overview |

**Neighboring Cities Table (19 metro areas):**

```
Herne → Bochum, Gelsenkirchen, Essen, Dortmund, Recklinghausen
Bochum → Herne, Essen, Dortmund, Gelsenkirchen, Witten
Dortmund → Bochum, Herne, Witten, Unna, Lünen, Castrop-Rauxel
Düsseldorf → Neuss, Ratingen, Erkrath, Mettmann, Hilden
Köln → Leverkusen, Bergisch Gladbach, Hürth, Brühl, Troisdorf
Hamburg → Norderstedt, Pinneberg, Ahrensburg, Wedel
Berlin → Potsdam, Teltow, Bernau, Oranienburg
München → Dachau, Freising, Starnberg, Erding
Bielefeld → Gütersloh, Herford, Bad Salzuflen, Detmold
... (and more)
```

### Output Schema

```typescript
{
  enhanceOutput: EnhanceOutput;       // Passthrough from Step 1
  candidates: RichPartner[];          // Raw search results (0-40)
  searchStrategy: string;             // "hybrid", "metadata", "cityOverview", etc.
  selfCorrected: boolean;             // Did we fall back?
  correctionStrategy?: string;        // e.g., "neighboring_cities:Bochum,Essen"
  metadataResult?: any;               // If broad-overview
  cityOverviewResult?: any;           // If city-explore or L4 fallback
  partnerDetailResult?: any;          // If partner-detail
}
```

---

## Step 3: Rerank (LLM Relevance Scoring)

**File:** `src/mastra/workflows/steps/rerankStep.ts`  
**Agent:** `rerankAgent` — Gemini 2.0 Flash, no tools, no memory  
**Latency:** ~800ms (skipped if ≤5 candidates)

### Scoring Criteria

| Score | Meaning |
|-------|---------|
| 9-10 | Perfect match — exact sport + exact city + matches goal |
| 7-8 | Strong match — right sport area, right city, related to goal |
| 5-6 | Partial match — same city different sport, OR right sport wrong city |
| 3-4 | Weak but relevant — tangentially related |
| 0-2 | Irrelevant — no meaningful connection |

### Process

1. Build prompt with query, intent, city, category, and all candidates
2. LLM scores each candidate 0-10 with a one-sentence reason
3. Filter scores ≥ 3, sort descending, keep top 10
4. Map scores back to partner objects

### Skip Conditions

- `skipSearch = true` (static intents like greeting, thanks)
- ≤5 candidates (RRF already ranked them well enough)
- Non-search results (metadata, city overview, partner detail)

### Output Schema

```typescript
{
  enhanceOutput: EnhanceOutput;
  rankedPartners: RankedPartner[];   // Scored, sorted, top 5-10
  searchStrategy: string;
  selfCorrected: boolean;
  correctionStrategy?: string;
  metadataResult?: any;
  cityOverviewResult?: any;
  partnerDetailResult?: any;
}

// Each RankedPartner:
{
  id: string;
  name: string;
  city: string;
  address: string;
  category: string;
  sporttypes: string[];
  description: string;       // First 300 chars
  courseNames: string[];
  relevanceScore: number;    // 0-10
  relevanceReason: string;   // "spezialisiert auf Rückengesundheit"
}
```

---

## Step 4: Respond (Response Formatting)

**File:** `src/mastra/workflows/steps/respondStep.ts`  
**Agent:** `responseAgent` — Gemini 2.0 Flash, no tools, with memory  
**Latency:** ~800ms

### Hard Rules

1. **Real data only** — only mention partners from search results
2. **Reply in user's language** — match the detected language
3. **Lead with the answer** — "In Dortmund gibt es 4 Yoga-Partner: ..."
4. **When data empty** — "Für [sport] in [city] habe ich aktuell keine Partner"

### Formatting

- Bulleted lists: **Name** — Address, City (Category)
- Group by category or city if many results
- Short, scannable responses
- Use relevance scores to explain "why relevant"

### Self-Correction Communication

- Neighboring cities: "In Herne direkt nichts, aber in der Nähe: Bochum, Essen..."
- Dropped sporttype: "Ich habe die Suche verbreitert..."
- City overview: "Diesen Sport gibt es in [city] nicht, aber es gibt..."

### Boundaries

- Booking/pricing/cancellation → redirect to sportnavi.de
- Never mention tools, models, or architecture

### Post-Process Guard

**File:** `src/mastra/guardrails/postProcess.ts`

After the LLM generates a response, regex patterns block leaks of:
- Internal tool names (searchPartners, getMetadata, etc.)
- Agent names (enhanceAgent, responseAgent, etc.)
- Model names (gemini, gpt, claude, openrouter)
- Infrastructure (mastra, convex, pgvector, libsql, duckdb)
- Architecture terms (system prompt, vector store, embedding model)

If any leak detected → replace entire response with safe fallback.

### Output Schema

```typescript
{
  text: string;                       // Final response to user
  intent: Intent;
  confidence: "high" | "medium" | "low";
  selfCorrected: boolean;
  memoryPayload?: {
    enhancedQuery: string;
    retrievedPartners: [{id, name, city}, ...];
    response: string;
  };
}
```

---

## Data Model (Convex)

### partners table (~2,146 records)

| Field | Type | Notes |
|-------|------|-------|
| externalId | number | Dedup key from Sport Navi API |
| name | string | Partner business name |
| city | string | German city |
| address | string | Street address |
| category | string | Primary category (fitness, yoga, etc.) |
| sporttypes | string[] | Sport type variants |
| description | string | Plain text, HTML stripped |
| phone, email, homepage | string? | Contact info |
| latitude, longitude | number? | Geo coordinates |
| courses | object[] | {name, sporttypes, usageLimits, courseFees} |
| contentHash | string? | djb2 hash for change detection |
| searchText | string? | Combined: name + sporttypes + description + courses |
| embedding | number[]? | 1536-dim vector (OpenAI text-embedding-3-small) |

**searchText composition:**
```
`${name} | ${sporttypes.join(", ")} | ${description} | Kurse: ${courseNames.join(", ")}`
```

This field is both BM25-indexed (keyword search) and embedded (semantic search).

### Indexes

- `by_externalId` — deduplication during sync
- `by_city` — city-filtered queries
- `by_category` — category-filtered queries
- `by_name` — name lookups
- `search_name` — full-text BM25 on partner names
- `search_text` — full-text BM25 on combined searchText

### Data Sync

- **Source:** Sport Navi API (`GET https://app.sportnavi.de/api/v1/website/partners`)
- **Schedule:** Hourly cron job via Convex
- **Process:** Fetch all partners → normalize Unicode → strip HTML → compute contentHash → upsert (skip re-embedding if hash unchanged) → rebuild metadata aggregations
- **Change detection:** djb2 hash of searchable content — only re-embeds when content actually changes

---

## Tools (Convex HTTP Endpoints)

| Tool | Endpoint | Purpose |
|------|----------|---------|
| `searchPartners` | POST `/api/search` | Name/city/category filtered search |
| `getPartnerDetails` | POST `/api/partner` | Full partner details by ID |
| `getCityOverview` | POST `/api/city-overview` | All categories/counts in a city |
| `hybridSearchPartners` | POST `/api/hybrid-search` | BM25 + vector + RRF fusion |
| `getMetadata` | GET `/api/metadata` | Network-wide city/category/sporttype counts |

---

## Memory System

- **Storage:** LibSQL (local SQLite file)
- **Scope:** Per-thread, per-user (threadId + resourceId)
- **Window:** Last 10 messages per thread
- **Used by:** responseAgent (has memory enabled) and session summary builder
- **Memory payload:** Each response stores {enhancedQuery, retrievedPartners, response} for context in subsequent turns
- **Reference resolution:** "the second one", "und yoga?", "there" resolved via numbered partner lists in session summary

---

## Evaluation Framework

### 5 Scorers

| Scorer | Type | Measures | Good Score |
|--------|------|----------|-----------|
| Answer Relevancy | LLM | Does response answer the question? | > 0.7 |
| Hallucination | LLM | Does response invent facts? | < 0.1 |
| Faithfulness | LLM | Does response match tool data? | > 0.7 |
| Tool Call Accuracy | Code | Did agent call right tools? | > 0.9 |
| Prompt Alignment | LLM | Does response follow system prompt? | > 0.8 |

### 31 Test Cases (15 categories)

City abbreviations (12), sport matching (7), multilingual (4), partner search (4), detail requests (3), no-results handling (4), off-topic (1), safety/injection (3), boundary (2), follow-ups (3), slang (3), emotional queries (2), multi-intent (2), frustration (1).

---

## Key Design Decisions

1. **Separation of concerns** — Each step does one thing: understand, fetch, score, or format. Independently testable and replaceable.

2. **LLM efficiency** — Only 3 LLM calls per query (enhance, rerank, respond). Rerank is optional. Guards are regex (0 tokens). ~2-3x cheaper than monolithic agent approaches.

3. **Hybrid search** — BM25 catches exact names; vectors catch semantic intent. RRF fusion combines both signals. Works for both specific and vague queries.

4. **Self-correction cascade** — 5 levels of fallback ensure 95%+ of queries return useful results. Graceful degradation from exact match to network overview.

5. **Defense in depth** — Pre-process regex guard → system prompt hardening → post-process leak detection. Never exposes internals.

6. **Deterministic search dispatch** — Step 2 is pure code (no LLM reasoning), making search behavior predictable and debuggable.
