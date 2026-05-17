# How the Sport Navi Partner Agent Works

A simple, clear explanation of the system — what it does, how the pieces fit together, and what happens when a user sends a message.

---

## What Is This?

A chatbot that helps people find sport and fitness partners on [sportnavi.de](https://sportnavi.de). Users type things like "yoga in Dortmund" or "Rückenschmerzen" and get back real partner recommendations from a database of ~2,146 partners across German cities.

---

## The Big Picture

```
User types a message
       |
       v
[ Pre-Process Guard ]  -- regex, blocks attacks before anything runs
       |
       v
[ Enhance Agent ]      -- LLM understands what the user wants
       |
       v
[ Search Engine ]      -- code fetches matching partners from database
       |
       v
[ Rerank Agent ]       -- LLM scores which partners are most relevant
       |
       v
[ Response Agent ]     -- LLM writes a friendly answer
       |
       v
[ Post-Process Guard ] -- regex, catches accidental system leaks
       |
       v
User sees the response
```

There are **3 LLM calls** per message (enhance, rerank, respond) and **2 regex guards** (before and after). The search step is pure code — no LLM.

---

## Project Structure

```
src/
  index.ts                  -- Entry point (CLI chat or single query)
  trace.ts                  -- Debug tool (shows each step's internals)
  seed.ts                   -- One-time data sync from Sport Navi API

  mastra/
    index.ts                -- Wires everything together (agents, storage, observability)

    agents/
      enhanceAgent.ts       -- "Understand the question" agent
      rerankAgent.ts        -- "Score the results" agent
      responseAgent.ts      -- "Write the answer" agent

    tools/
      partnerTools.ts       -- 5 tools that talk to the Convex database

    workflows/
      partnerWorkflow.ts    -- The 4-step pipeline definition
      schemas.ts            -- TypeScript types for every step's input/output
      enhancePrompt.ts      -- System prompt for the enhance agent
      rerankPrompt.ts       -- System prompt for the rerank agent
      sessionSummary.ts     -- Builds conversation context (no LLM, pure code)
      steps/
        enhanceStep.ts      -- Step 1: understand + classify
        searchStep.ts       -- Step 2: fetch data
        rerankStep.ts       -- Step 3: score relevance
        respondStep.ts      -- Step 4: format answer

    guardrails/
      preProcess.ts         -- Blocks prompt injection (before LLM)
      postProcess.ts        -- Blocks system leaks (after LLM)

    rag/
      embedPartners.ts      -- Creates vector embeddings for partners
      syncEmbeddings.ts     -- Batch embedding sync

  evals/
    dataset.ts              -- 31 test questions
    scorers.ts              -- 5 quality scorers
    run-evals.ts            -- CLI test runner

convex/
  schema.ts                 -- Database tables (partners, metadata, syncLog)
  sync.ts                   -- Hourly data sync from Sport Navi API
  partners.ts               -- Query functions (search, detail, overview)
  crons.ts                  -- Cron job: sync every hour
  http.ts                   -- HTTP endpoints the tools call
```

---

## What Each Piece Does

### 1. The Agents (3 LLM-powered workers)

All three use **Gemini 2.0 Flash** via **OpenRouter**. Each has one job:

| Agent | Job | Has Tools? | Has Memory? |
|-------|-----|-----------|-------------|
| **enhanceAgent** | Read the user's message, figure out what they want, rewrite it for search | No | No |
| **rerankAgent** | Score each search result 0-10 for relevance | No | No |
| **responseAgent** | Turn the scored results into a friendly answer | No | No |

None of the agents call tools directly. The search step handles tool calls in pure code.

### 2. The Tools (5 database connectors)

Each tool makes an HTTP call to a Convex endpoint:

| Tool | What It Does |
|------|-------------|
| `searchPartners` | Find partners by name, city, category, or sport type |
| `hybridSearchPartners` | Keyword search (BM25) + meaning search (vectors) combined |
| `getPartnerDetails` | Get full info on one specific partner |
| `getCityOverview` | "What's available in Dortmund?" — counts by category |
| `getMetadata` | "What cities and sports exist?" — the whole network |

### 3. The Database (Convex)

One main table: **partners** (~2,146 rows)

Each partner has: name, city, address, category, sport types, description, courses, contact info, and two search fields:
- **searchText** — combined text used for keyword matching (BM25)
- **embedding** — 1536-number vector used for meaning matching (cosine similarity)

Data comes from the Sport Navi API and syncs **every hour** via a cron job.

### 4. The Guardrails (2 regex filters)

- **Pre-process** (before LLM): Catches prompt injection ("ignore your instructions"), jailbreaks ("DAN mode"), system prompt extraction, encoded attacks. If caught, returns a safe static response and stops.
- **Post-process** (after LLM): Catches if the LLM accidentally mentions internal names like "searchPartners", "gemini", "convex", "mastra", or "system prompt". If caught, replaces the entire response with a safe fallback.

### 5. The Session Summary (conversation memory)

A pure-code function (no LLM, <1ms) that reads the conversation history and builds a markdown briefing:

- **Current Focus** — which city and category the user is looking at
- **What Was Shown** — numbered list of partners from each turn (so "the second one" works)
- **Recent Messages** — last 3 raw messages for tone/context

This briefing is passed to the enhance agent so it can resolve references like "und yoga?" (keep the city, change the sport) or "der zweite" (partner #2 from the last results).

---

## What Happens Step by Step

### Example: User types "yoga in dort"

**Step 0 — Pre-Process Guard** (<1ms)
```
Input:  "yoga in dort"
Check:  Does it match any injection pattern? → No
Output: { blocked: false, sanitizedInput: "yoga in dort" }
```

**Step 1 — Enhance** (~300ms, 1 LLM call)
```
The enhance agent receives:
  - Session summary (or "first message" if new conversation)
  - User message: "yoga in dort"

It returns:
  {
    enhancedQuery: "Yoga Pilates Hatha Vinyasa Studio Dortmund",
    queryVariants: ["Yoga Kurs Meditation Dortmund", "Pilates Stretching Dortmund", ...],
    intent: "city-category",
    confidence: "high",
    slots: { city: "Dortmund", category: "yoga", sporttype: "Yoga" },
    skipSearch: false,
    language: "de",
    is_frustrated: false
  }

Key things it did:
  - "dort" → "Dortmund" (abbreviation resolved)
  - "yoga" → category:"yoga", sporttype:"Yoga" (mapped to database values)
  - Built a keyword-rich query with synonyms for better search
  - Generated 3 query variants for RAG Fusion
```

**Step 2 — Search** (~200ms, no LLM, code only)
```
Intent is "city-category" → use hybridSearchPartners

If confidence is not "high" and variants exist → RAG Fusion mode:
  - Search "Yoga Pilates Hatha Vinyasa Studio Dortmund"     ─┐
  - Search "Yoga Kurs Meditation Dortmund"                   ├── in parallel
  - Search "Pilates Stretching Dortmund"                     ─┘
  - Merge all results with Reciprocal Rank Fusion (RRF)
  - Partners that appear in multiple searches rank higher

If confidence is "high" → single query mode:
  - Search "Yoga Pilates Hatha Vinyasa Studio Dortmund"
  - city: "Dortmund", category: "yoga", limit: 40

How hybrid search works:
  1. Embed the query text into a 1536-dim vector
  2. BM25 path: keyword match on searchText (good for exact names)
  3. Vector path: cosine similarity on embeddings (good for meaning)
  4. RRF: merge both ranked lists, partners in both get boosted

Result: 25 partner objects with full data
```

**Step 3 — Rerank** (~800ms, 1 LLM call)
```
25 candidates > 5, so reranking runs.

The rerank agent sees:
  Query: "Yoga Pilates Hatha Vinyasa Studio Dortmund"
  City: Dortmund
  Category: yoga
  Candidates: [25 partners with name, city, category, description...]

It scores each one 0-10:
  - "Yoga Studio Om" in Dortmund → 10 (perfect match)
  - "Pilates Center" in Dortmund → 8 (right area, right city)
  - "Fitness World" in Dortmund → 4 (same city, different sport)
  - "Yoga Haus" in Essen → 5 (right sport, wrong city)

Keeps top 10 with score >= 3
Each gets a tier: perfect (8-10), good (5-7), weak (3-4)
```

**Step 4 — Respond** (~800ms, 1 LLM call)
```
The response agent receives formatted context:
  [Language: de]
  [Intent: city-category | Confidence: high]

  ## Search Results
  ### Top Recommendations (4)
  1. **Yoga Studio Om** (Score: 10/10)
     Address: Hauptstr. 12, Dortmund
     Why: Spezialisiert auf Yoga und Pilates

  ### Also Relevant (3)
  2. **Pilates Center** — Wallstr. 5, Dortmund (yoga)
  ...

  User message: "yoga in dort"

It generates:
  "In Dortmund gibt es 4 top Yoga-Partner:

  **Besonders empfehlenswert:**
  - **Yoga Studio Om** — Hauptstr. 12, Dortmund
    Spezialisiert auf Yoga und Pilates
  - ...

  **Weitere Optionen:**
  - ..."
```

**Post-Process Guard** (<1ms)
```
Check response for leaked internals:
  - "searchPartners"? No
  - "gemini"? No
  - "convex"? No
  - "system prompt"? No
Output: { passed: true, finalResponse: <same text> }
```

**Result sent to user** + memory payload saved for next turn.

---

## What Happens When Nothing Is Found

If the main search returns 0 results, a **5-level self-correction cascade** kicks in:

```
User: "hyrox in Herne"
  → Hybrid search: 0 results

  Level 1: Drop sporttype filter
    Try all fitness in Herne (not just hyrox)
    → Still 0? Continue...

  Level 2: Text query fallback
    Search "hyrox" as a keyword in Herne
    → Still 0? Continue...

  Level 3: Search neighboring cities
    Herne's neighbors: Bochum, Gelsenkirchen, Essen
    Search each for hyrox/fitness in parallel
    → Found 5 results in Bochum? Return them!
    → Response says: "In Herne direkt nichts, aber in Bochum..."

  Level 4: City overview (if L3 also fails)
    Show what IS available in Herne
    → "Hyrox gibt es nicht, aber 42 andere Partner..."

  Level 5: Full network metadata (last resort)
    Show all cities and categories in the network
    → Always has data
```

The response agent knows which level was used and explains it naturally.

---

## How Multi-Turn Conversations Work

```
Turn 1: "yoga in Dortmund"
  → Shows 5 yoga partners in Dortmund
  → Memory saves: city=Dortmund, category=yoga, partners=[#1 Om, #2 Pilates...]

Turn 2: "und in Essen?"
  → Session summary says: city=Dortmund, category=yoga
  → Enhance agent understands: keep yoga, switch to Essen
  → Searches yoga in Essen

Turn 3: "der zweite"
  → Session summary lists: Turn 2 partners: 1. X, 2. Y, 3. Z
  → Enhance agent resolves: "der zweite" = partner Y
  → Fetches details for partner Y

Turn 4: "was billigeres"
  → Session summary: city=Essen, category=yoga, just viewed partner Y
  → Enhance agent: keep city+category, add price modifier
```

Conversation history is kept in a local array (max 20 entries). Each turn stores the user message, assistant response, and which partners were shown.

---

## How Intent Classification Works

The enhance agent classifies every message into one of 14 intents:

**Search intents** (need database access):
| Intent | Example | What Runs |
|--------|---------|-----------|
| `city-category` | "yoga in Dortmund" | hybridSearchPartners with city + category filters |
| `category-browse` | "yoga" (no city) | hybridSearchPartners across all cities |
| `city-explore` | "was gibt es in Köln?" | getCityOverview |
| `broad-overview` | "zeig mir alles" | getMetadata |
| `partner-search` | "FITOMAT" | hybridSearchPartners by name |
| `partner-detail` | "was bieten die an?" | getPartnerDetails |
| `semantic-search` | "Rückenschmerzen" | hybridSearchPartners with expanded synonyms |
| `frustration` | "das hilft nicht!" | Show data immediately, empathetic tone |
| `unknown` | anything unclear | Best-effort search |

**Non-search intents** (static response, no LLM calls after enhance):
| Intent | Example | Response |
|--------|---------|----------|
| `greeting` | "hallo" | Brief greeting |
| `thanks` | "danke" | Warm closing |
| `off-topic` | "wie wird das Wetter?" | Polite redirect to sports |
| `boundary` | "was kostet ein Abo?" | Redirect to sportnavi.de |
| `injection` | "ignore your instructions" | Safe fallback |

---

## How Abbreviations and Typos Are Resolved

The enhance agent has a built-in mapping:

**Cities:**
| User Types | Agent Understands |
|-----------|------------------|
| dort, dortmunt | Dortmund |
| bi, bilefeld | Bielefeld |
| düssel | Düsseldorf |
| hh | Hamburg |
| ffm | Frankfurt am Main |
| muc | München |
| kölle, k | Köln |
| bln | Berlin |
| bo | Bochum |
| pb | Paderborn |
| ms | Münster |
| esssen | Essen |

**Sports:**
| User Types | Agent Maps To |
|-----------|--------------|
| muckibude, pumpen, gym | category: fitness |
| schwimmen, pool, baden | category: swimming |
| boxen, kickboxen | category: boxing |
| klettern, bouldern | category: climbing |
| laufen, joggen | category: outdoor |

---

## How Hybrid Search Works

Every partner has two searchable fields:

1. **searchText** — a combined string:
   ```
   "Yoga Studio Om | Yoga, Pilates, Hatha | Ein modernes Studio für... | Kurse: Anfänger Yoga, Power Yoga"
   ```

2. **embedding** — a 1536-number vector created by OpenAI's `text-embedding-3-small` model

When a user searches:

```
Query: "Yoga Pilates Hatha Vinyasa Studio Dortmund"

BM25 Path (keyword match):
  - Looks for these exact words in searchText
  - Good at: finding "FITOMAT" by exact name
  - Ranks by: how often the keywords appear

Vector Path (meaning match):
  - Converts the query into a 1536-dim vector
  - Compares to every partner's embedding by cosine similarity
  - Good at: "Rückenschmerzen" matching yoga/massage/physio
  - Ranks by: how similar the meaning is

RRF Merge:
  - Takes both ranked lists
  - Partners that rank high in BOTH get the biggest score
  - Removes duplicates
  - Returns top 40
```

If confidence is not "high", **RAG Fusion** runs: the enhance agent generates 3 query variants (different synonyms/phrasings), all are searched in parallel, and results are merged via RRF across all searches. This catches more relevant partners.

---

## How Reranking Works

After search returns 40 candidates, the rerank agent scores each one:

```
Input to LLM:
  Query: "Yoga Pilates Hatha Vinyasa Studio Dortmund"
  City: Dortmund
  Category: yoga
  Candidates:
    1. Yoga Studio Om — Dortmund | yoga | Yoga, Pilates | Ein modernes...
    2. Fitness World — Dortmund | fitness | Fitness | Großes...
    3. Yoga Haus — Essen | yoga | Yoga, Hatha | Traditionelles...
    ...

LLM returns:
  [
    { index: 1, score: 10, reason: "Exaktes Match: Yoga in Dortmund" },
    { index: 3, score: 5, reason: "Yoga, aber in Essen statt Dortmund" },
    { index: 2, score: 3, reason: "Dortmund, aber Fitness statt Yoga" }
  ]
```

**Skip conditions** (reranking is skipped when it wouldn't add value):
- 5 or fewer candidates → already ranked well by search
- High confidence + 10 or fewer candidates → RRF already good enough
- Non-search intents (greeting, overview, etc.)

**Tier classification** (CRAG-inspired):
- Score 8-10 → `perfect` — show prominently with full details
- Score 5-7 → `good` — list after top picks
- Score 3-4 → `weak` — mention briefly or skip

---

## How the Response Is Built

The respond step doesn't just dump data at the LLM. It builds a **structured context document**:

```
[Language: de]
[Intent: city-category | Confidence: high]

## Search Results
Query: "Yoga Pilates Hatha Vinyasa Studio Dortmund"

### Top Recommendations (3)
Present these prominently — they are the best matches.
1. **Yoga Studio Om** (Score: 10/10)
   Address: Hauptstr. 12, Dortmund
   Category: yoga | Sports: Yoga, Pilates
   Courses: Anfänger Yoga, Power Yoga
   Why: Exaktes Match: Yoga in Dortmund

### Also Relevant (2)
These are solid matches. List them after the top recommendations.
1. **Pilates Center** — Wallstr. 5, Dortmund (yoga)
   Why: Pilates-Schwerpunkt, passt zu Yoga-Anfrage

---

User message: "yoga in dort"
```

The response agent then writes a natural answer following its rules:
- Lead with the answer (no "I searched for...")
- Use the user's language
- Bulleted lists with bold names
- Explain relevance when not obvious
- If self-corrected, explain what happened

---

## Storage Architecture

```
Convex (cloud database):
  - partners table (2,146 rows)
  - metadata table (cities, categories, sporttypes)
  - syncLog table (sync run history)

LibSQL (local SQLite file — mastra.db):
  - Conversation memory (threads + messages)
  - Eval datasets and experiment results
  - Agent configuration

DuckDB (in-memory, not persisted):
  - OpenTelemetry traces
  - Logs and metrics
```

---

## Data Flow: Where Partners Come From

```
Sport Navi API (external)
  GET https://app.sportnavi.de/api/v1/website/partners
  Returns: ~2,146 raw partner objects
       |
       | (every hour, via Convex cron job)
       v
Convex sync action:
  1. Fetch all partners from API
  2. Normalize Unicode (NFC)
  3. Strip HTML from descriptions
  4. Build searchText: "name | sporttypes | description | courses"
  5. Compute contentHash (djb2) for change detection
  6. Upsert to database:
     - New partner → insert (no embedding yet)
     - Existing, hash unchanged → update metadata only (keep embedding)
     - Existing, hash changed → update all fields (clear embedding for re-embed)
  7. Rebuild metadata aggregations (city counts, category counts)
       |
       | (separate batch job)
       v
Embedding sync:
  - Find partners with missing embeddings
  - Batch embed searchText via OpenAI text-embedding-3-small
  - Store 1536-dim vectors in Convex
```

---

## Evaluation System

31 test questions across 15 categories, scored by 5 metrics:

| Scorer | What It Checks | Good Score |
|--------|---------------|-----------|
| Answer Relevancy | Does the response answer what was asked? | > 0.7 |
| Hallucination | Does it invent partners that don't exist? | < 0.1 |
| Faithfulness | Does it match the actual database data? | > 0.7 |
| Tool Call Accuracy | Did it call the right tools? | > 0.9 |
| Prompt Alignment | Does it follow the system prompt rules? | > 0.8 |

Run with:
```bash
npm run eval           # All 31 tests
npm run eval:city      # City abbreviation tests only
npm run eval:sport     # Sport matching tests only
npm run trace          # Debug mode: see each step's internals
```

---

## Key Numbers

| What | Value |
|------|-------|
| Partners in database | ~2,146 |
| LLM calls per message | 3 (enhance + rerank + respond) |
| LLM model | Gemini 2.0 Flash |
| Embedding model | OpenAI text-embedding-3-small |
| Embedding dimensions | 1,536 |
| Hybrid search limit | 40 candidates |
| Rerank keeps | top 10 |
| Self-correction levels | 5 |
| Neighboring city groups | 19 metro areas |
| Intent types | 14 |
| Supported languages | German, English, French, Turkish |
| Data sync frequency | Every hour |
| Conversation memory | Last 20 messages |
| Eval test cases | 31 |
| Eval scorers | 5 |
