# Deployment Setup Guide

How to get the Sport Navi Partner Agent running on Vercel + Convex.

---

## Prerequisites

- [Vercel](https://vercel.com) account with this repo imported
- [Convex](https://convex.dev) account with project created
- API keys for OpenRouter, OpenAI, and Google AI

---

## Step 1: Deploy Convex

```bash
# Set your Convex deploy key
$env:CONVEX_DEPLOY_KEY = "your-convex-deploy-key"

# Deploy functions and schema
npx convex deploy
```

Your deployment URL will look like:
```
https://your-project-name.eu-west-1.convex.cloud
```

The HTTP site URL (used for API calls) is:
```
https://your-project-name.eu-west-1.convex.site
```

---

## Step 2: Set Vercel Environment Variables

Go to **Vercel Dashboard > Your Project > Settings > Environment Variables** and add:

| Variable | Value | Used For |
|----------|-------|----------|
| `OPENROUTER_API_KEY` | `sk-or-v1-...` | LLM calls (enhance, rerank, respond agents) |
| `OPENAI_API_KEY` | `sk-proj-...` | Text embeddings (text-embedding-3-small) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | `AIza...` | Google AI SDK |
| `CONVEX_SITE_URL` | `https://your-project.eu-west-1.convex.site` | Database and search API calls |

Make sure all variables are enabled for **Production** (and optionally Preview/Development).

---

## Step 3: Seed the Database

Populate the partners table from the Sport Navi API:

```bash
# Point to your production Convex instance
$env:CONVEX_SITE_URL = "https://your-project.eu-west-1.convex.site"

# Run the seed script
npm run seed
```

This fetches ~2,146 partners and inserts them into Convex. The hourly cron job will keep them updated automatically.

---

## Step 4: Sync Vector Embeddings

Partners need vector embeddings for hybrid search (BM25 + semantic) to work:

```bash
npm run sync:vectors
```

This uses OpenAI's `text-embedding-3-small` model to generate 1536-dim embeddings for each partner's `searchText` field.

---

## Step 5: Redeploy on Vercel

After setting environment variables, trigger a redeploy so they take effect:

1. Go to **Vercel Dashboard > Deployments**
2. Click the **...** menu on the latest deployment
3. Select **Redeploy**

---

## Step 6: Test the API

Send a POST request to your Vercel deployment:

```bash
curl -X POST https://your-app.vercel.app/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "yoga in Dortmund"}'
```

Expected response:

```json
{
  "text": "In Dortmund gibt es mehrere Yoga-Partner...",
  "intent": "city-category",
  "confidence": "high",
  "selfCorrected": false,
  "threadId": "thread-1234567890"
}
```

To test multi-turn conversation, pass the `threadId` from the first response:

```bash
curl -X POST https://your-app.vercel.app/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "und in Essen?", "threadId": "thread-1234567890"}'
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `500` error on `/api/chat` | Check Vercel logs — usually a missing env variable |
| Empty search results | Run `npm run seed` then `npm run sync:vectors` against production |
| `CONVEX_SITE_URL` not working | Make sure you use `.convex.site` (not `.convex.cloud`) |
| Timeout errors | The `vercel.json` sets `maxDuration: 30s` — check if your Vercel plan supports it |
| Embeddings missing | Run `npm run sync:vectors` — partners without embeddings skip vector search |

---

## Architecture Overview

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design.

```
POST /api/chat
     |
     v
Pre-Process Guard --> Enhance Agent --> Search --> Rerank Agent --> Response Agent --> Post-Process Guard
     (regex)           (LLM #1)        (code)     (LLM #2)         (LLM #3)           (regex)
```

- **3 LLM calls** per message (Gemini 2.0 Flash via OpenRouter)
- **2 regex guards** (pre + post)
- **Hybrid search** (BM25 + vector via Convex)
- **Conversation memory** stored in Convex
