# Sport Navi Partner Agent

An AI chatbot for [sportnavi.de](https://sportnavi.de) that helps visitors find fitness and sport partners in the Sport Navi network. Built with **Mastra AI**, **Convex**, and **OpenRouter**.

## Architecture

```
User Question
     |
     v
+----------------------------------+
|  Mastra Agent (OpenRouter)       |
|  google/gemini-2.0-flash-001    |
|                                  |
|  System prompt contains:         |
|  - Reasoning instructions        |
|  - City/sport resolution logic   |
|  - Multilingual response rules   |
+----------------------------------+
     |  tool calls
     v
+----------------------------------+
|  3 Tools                         |
|  - searchPartners(city, sport)   |
|  - getPartnerDetails(id)         |
|  - getMetadata()                 |
+----------------------------------+
     |  HTTP calls
     v
+----------------------------------+
|  Convex Backend                  |
|  - 2,146 partners indexed        |
|  - Hourly cron sync from API    |
|  - Full-text search on names    |
|  - Indexed by city/category     |
+----------------------------------+
     |  hourly sync
     v
Sport Navi API
https://app.sportnavi.de/api/v1/website/partners
```

## Prerequisites

- **Node.js** v20+ (v22 recommended)
- **npm** v10+
- An **OpenRouter** API key ([get one here](https://openrouter.ai/keys))

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/AiLabSportnavi/PartnerAgentUseCase.git
cd PartnerAgentUseCase
npm install
```

### 2. Set up environment

```bash
# Copy the example and add your OpenRouter key
cp .env.example .env
```

Edit `.env`:
```
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

### 3. Start Convex (local database)

```bash
npx convex dev
```

This starts the local Convex backend on `http://127.0.0.1:3210` and the HTTP actions on `http://127.0.0.1:3211`. Keep this terminal running.

### 4. Seed the partner database

In a second terminal:
```bash
npm run seed
```

This fetches all 2,146 partners from the Sport Navi API and loads them into your local Convex database. Takes about 30 seconds.

### 5. Test the agent (CLI)

```bash
npm start
# Or with a custom query:
npx tsx src/index.ts "fitness in dort"
```

### 6. Open Mastra Studio (visual playground)

```bash
mastra dev
```

Open the URL shown (usually `http://localhost:4111`) in your browser. You get:
- **Agents** tab: chat playground to test the agent interactively
- **Scorers** tab: view registered evaluation scorers
- **Datasets** tab: manage test datasets
- **Experiments** tab: run and review experiment results

## Project Structure

```
PartnerAgentUseCase/
|
+-- convex/                          # Convex backend
|   +-- schema.ts                    # DB schema (partners, metadata, syncLog)
|   +-- sync.ts                      # Sync action: fetches API, strips HTML, upserts
|   +-- partners.ts                  # Query functions (search, details, metadata)
|   +-- crons.ts                     # Hourly partner sync cron job
|   +-- http.ts                      # HTTP endpoints for Mastra tools
|   +-- tsconfig.json
|
+-- src/
|   +-- mastra/
|   |   +-- agents/partnerAgent.ts   # Agent definition + system prompt
|   |   +-- tools/partnerTools.ts    # 3 tools (search, details, metadata)
|   |   +-- index.ts                 # Mastra instance (storage, observability, scorers)
|   |
|   +-- evals/
|   |   +-- dataset.ts               # 31 test cases across 9 categories
|   |   +-- scorers.ts               # 5 eval scorers configured
|   |   +-- run-evals.ts             # CLI eval runner
|   |   +-- seed-and-run.ts          # Studio dataset seeder + experiment runner
|   |
|   +-- index.ts                     # CLI entry point
|   +-- seed.ts                      # Initial partner database sync
|
+-- .env.example                     # Environment template
+-- .env.local                       # Convex local config (auto-generated)
+-- package.json
+-- tsconfig.json
+-- CLAUDE.md                        # AI assistant context
+-- README.md                        # This file
```

## How the Agent Works

The agent uses a **"fat prompt, thin tools"** architecture:

1. **System prompt** contains reasoning instructions for city/sport resolution
2. The LLM **resolves abbreviations and typos** itself (e.g., "dort" -> "Dortmund", "bi" -> "Bielefeld")
3. The LLM emits **clean tool calls** with exact city names and sport types
4. Tools are **dumb pipes** that hit indexed Convex queries (fast, ~50ms)
5. The LLM **formats the response** in the user's language

### Example Flow

```
User: "kletter in bi"

Agent thinks:
  - "bi" -> most likely "Bielefeld" (95 partners there)
  - "kletter" -> climbing sporttype
  - Action: searchPartners({ city: "Bielefeld", sporttype: "Climbing" })

Agent responds:
  "In Bielefeld gibt es:
   - Center of Gravity Boulderhalle (Heidegrundweg 104-108)"
```

## Available Commands

### Development

| Command | Description |
|---------|-------------|
| `npx convex dev` | Start local Convex backend (keep running) |
| `mastra dev` | Start Mastra Studio (visual playground) |
| `npm run dev` | Start agent in watch mode (auto-reload) |
| `npm start` | Run agent once with default query |
| `npm run seed` | Sync partners from Sport Navi API into Convex |

### Evaluation (CLI)

| Command | Description |
|---------|-------------|
| `npm run eval` | Run full eval suite (31 test cases, all scorers) |
| `npm run eval:city` | Run city-resolution tests only (7 cases) |
| `npm run eval:sport` | Run sport-matching tests only (5 cases) |
| `npm run eval:multilingual` | Run multilingual tests only (4 cases) |
| `npm run eval:safety` | Run safety/boundary tests only |

### Evaluation (Studio)

| Command | Description |
|---------|-------------|
| `npm run eval:seed` | Seed test dataset into Mastra Studio |
| `npm run eval:studio` | Seed dataset + run experiment |
| `npm run eval:run` | Run experiment on existing dataset |

## Evaluation System

### Scorers

5 scorers are registered to evaluate agent quality:

| Scorer | What it measures | Scale | Good score |
|--------|-----------------|-------|------------|
| **Answer Relevancy** | Does the response answer the question? | 0-1 | > 0.7 |
| **Hallucination** | Does it invent partners/cities/data? | 0-1 | < 0.1 (lower = better) |
| **Faithfulness** | Does it match the tool results? | 0-1 | > 0.7 |
| **Prompt Alignment** | Does it follow system prompt rules? | 0-1 | > 0.8 |
| **Tool Call Accuracy** | Did it call the right tool? | 0-1 | > 0.9 |

### Dataset Categories

31 test cases across 9 categories:

| Category | Count | Tests |
|----------|-------|-------|
| **city-resolution** | 7 | Abbreviations ("dort", "bi"), typos ("bilefeld", "esssen") |
| **sport-matching** | 5 | Category mapping ("massage", "EMS", "tennis") |
| **multilingual** | 4 | German, English, French, Italian queries |
| **partner-search** | 4 | Name search ("Kampfsport-Team Freiberg", "FITOMAT") |
| **detail-request** | 3 | "Was kann ich bei X machen?" |
| **no-results** | 4 | Tokyo, McFit, missing sports |
| **off-topic** | 1 | Weather question |
| **safety** | 1 | Prompt injection attempt |
| **boundary** | 2 | Pricing, booking questions |

### Running Evals (Step by Step)

**Option A: CLI (recommended, full scoring)**

```bash
# Make sure Convex is running first
npx convex dev

# Run all 31 tests with all scorers
npm run eval

# Or run a specific category
npm run eval:city
```

Output looks like:
```
[1/7] "box studios in dort"
  Response: In Dortmund gibt es keine reinen Boxstudios...
  +-- answer-relevancy-scorer: 0.20
  +-- hallucination-scorer: 1.0
  +-- faithfulness-scorer: 0.0
  +-- prompt-alignment-scorer: 0.93

========================================
EVAL SUMMARY
========================================
Total items: 7
Time: 186.7s
Aggregate Scores:
  answer-relevancy-scorer: 0.64
  hallucination-scorer: 1.0
  faithfulness-scorer: 0.59
  prompt-alignment-scorer: 0.95
```

**Option B: Mastra Studio (visual, interactive)**

```bash
# Start Studio
mastra dev

# In another terminal, seed the dataset
npm run eval:seed
```

Then in the Studio UI:
1. Go to **Datasets** tab
2. Click **"Partner Agent Eval Suite"**
3. Click **"Run Experiment"**
4. Select Target Type: **Agent**
5. Select Agent: **Sport Navi Partner Assistant**
6. Click **Run**
7. Check **Experiments** tab for results

> **Note:** Scorer scoring in Studio has a known serialization bug in Mastra v1.35.0.
> For full scoring, use the CLI (`npm run eval`). The Studio experiment still runs the
> agent on all test cases and shows pass/fail status.

### Adding New Test Cases

Edit `src/evals/dataset.ts`:

```typescript
// Add to the partnerAgentDataset array:
{
  input: "your test query here",
  groundTruth: "What a correct response should contain/do",
  category: "city-resolution", // or any category name
},
```

Then re-run:
```bash
npm run eval           # CLI
npm run eval:seed      # re-seed Studio dataset
```

## Convex Database

### Schema

- **partners** (2,146 records): name, city, address, category, sporttypes, courses, usage limits, fees
- **metadata**: aggregated cities (with partner counts), categories, sporttypes
- **syncLog**: sync run history

### Indexes

- `by_externalId` - deduplication during sync
- `by_city` - fast city-filtered queries
- `by_category` - fast category-filtered queries
- `by_name` - name lookups
- `search_name` - full-text search on partner names

### Sync

The cron job runs every hour and:
1. Fetches all partners from the Sport Navi API
2. Strips HTML from descriptions
3. Upserts new/changed partners
4. Removes partners no longer in the API
5. Rebuilds metadata aggregations (city counts, categories, sporttypes)

To manually trigger a sync:
```bash
npm run seed
```

### Dashboard

When Convex is running locally, view the dashboard at:
```
http://127.0.0.1:6790/?d=anonymous-PartnerAgentUseCase
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | Yes | Your OpenRouter API key |
| `CONVEX_SITE_URL` | Auto | Convex HTTP endpoint (auto-set by `npx convex dev`) |
| `CONVEX_DEPLOYMENT` | Auto | Convex deployment name (auto-set) |
| `CONVEX_URL` | Auto | Convex client URL (auto-set) |

## Cost

| Component | Cost |
|-----------|------|
| Mastra AI | Free (open-source) |
| Convex (local) | Free |
| Convex (cloud free tier) | Free (1M calls/month, 512MB storage) |
| OpenRouter (Gemini Flash) | ~$0.0001 per query (~$3/month at 1000 queries/day) |
| Running 31 eval test cases | ~$0.01 |

## Troubleshooting

### "Storage not configured" in Studio

Make sure `@mastra/libsql` is installed and the Mastra instance has storage configured in `src/mastra/index.ts`.

### Convex "connection refused"

Start Convex first: `npx convex dev`. Keep it running in a separate terminal.

### "API key missing"

Add `OPENROUTER_API_KEY` to both `.env` and `.env.local`:
```bash
echo "OPENROUTER_API_KEY=sk-or-v1-your-key" >> .env.local
```

### Eval scorers show "No scorers configured" in Studio

Known bug in Mastra v1.35.0 with LibSQL array serialization. Use `npm run eval` (CLI) for full scoring. The Studio experiment still runs the agent correctly.

### Port conflicts

Mastra Studio picks the next available port if 4111 is taken. Check the terminal output for the actual URL (e.g., `http://localhost:4113`).

## Tech Stack

- **[Mastra AI](https://mastra.ai)** - TypeScript agent framework (agents, tools, evals, studio)
- **[Convex](https://convex.dev)** - Reactive database with cron jobs and HTTP actions
- **[OpenRouter](https://openrouter.ai)** - LLM API gateway (google/gemini-2.0-flash-001)
- **TypeScript** - Type-safe throughout
- **LibSQL** - Local SQLite storage for Mastra Studio datasets/experiments
