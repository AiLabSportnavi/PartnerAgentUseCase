/**
 * Full experiment pipeline:
 * 1. Seed dataset into Mastra storage
 * 2. Run experiment with all scorers
 * 3. Capture scores, traces, and observability
 * 4. Generate markdown report
 *
 * Usage: npx tsx src/evals/experiment-report.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { mastra } from "../mastra/index";
import { partnerAgentDataset } from "./dataset";
import { answerRelevancy, hallucination, faithfulness, promptAlignment } from "./scorers";
import { writeFileSync } from "fs";

const DATASET_NAME = `Partner Agent Eval - ${new Date().toISOString().slice(0, 16)}`;

interface ScoreResult {
  scorerName: string;
  score: number | null;
  reason?: string;
}

interface ItemResult {
  input: string;
  groundTruth: string;
  category: string;
  output: string;
  scores: ScoreResult[];
  toolCalls: string[];
  latencyMs: number;
}

async function main() {
  console.log("=== Sport Navi Partner Agent — Experiment Pipeline ===\n");

  // === Step 1: Fetch live partner metadata for the report ===
  console.log("1. Fetching live partner metadata...");
  let metadata: any = {};
  try {
    const CONVEX_SITE_URL = process.env.CONVEX_SITE_URL || "http://127.0.0.1:3211";
    const metaRes = await fetch(`${CONVEX_SITE_URL}/api/metadata`);
    metadata = await metaRes.json();
    console.log(`   Cities: ${metadata.cities?.length || 0}, Categories: ${metadata.categories?.length || 0}, Sport types: ${metadata.sporttypes?.length || 0}`);
  } catch (e: any) {
    console.log(`   Warning: Could not fetch metadata: ${e.message}`);
  }

  // === Step 2: Seed the dataset ===
  console.log("\n2. Seeding dataset into Mastra storage...");
  let dataset: any;
  try {
    dataset = await mastra.datasets.create({
      name: DATASET_NAME,
      description: `${partnerAgentDataset.length} test cases: city resolution, sport matching, multilingual, partner search, detail requests, edge cases, safety.`,
      targetType: "agent",
      targetIds: ["partnerAgent"],
    });

    const items = partnerAgentDataset.map((item) => ({
      input: item.input,
      groundTruth: item.groundTruth,
      metadata: { category: item.category },
    }));

    await dataset.addItems({ items });
    console.log(`   Dataset "${DATASET_NAME}" created with ${items.length} items`);
  } catch (e: any) {
    console.error(`   Dataset creation error: ${e.message}`);
    // Try to find existing dataset
    const { datasets: allDatasets } = await mastra.datasets.list();
    const found = allDatasets.find((d: any) => d.name.includes("Partner Agent Eval"));
    if (found) {
      dataset = await mastra.datasets.get({ id: found.id });
      console.log(`   Using existing dataset: ${found.name}`);
    } else {
      throw new Error("Cannot create or find dataset");
    }
  }

  // === Step 3: Run experiment ===
  console.log("\n3. Running experiment (this takes a few minutes)...");
  const experimentName = `experiment-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}`;
  const experimentStartTime = Date.now();

  const summary = await dataset.startExperiment({
    name: experimentName,
    description: "Full evaluation: answer relevancy, hallucination, faithfulness, prompt alignment",
    targetType: "agent",
    targetId: "partnerAgent",
    scorers: [answerRelevancy, hallucination, faithfulness, promptAlignment],
    maxConcurrency: 2,
  });

  const experimentDurationMs = Date.now() - experimentStartTime;
  const experimentDurationSec = (experimentDurationMs / 1000).toFixed(1);

  console.log(`   Experiment "${experimentName}" completed in ${experimentDurationSec}s`);
  console.log(`   Status: ${summary.status}`);
  console.log(`   Total: ${summary.totalItems} | Passed: ${summary.succeededCount} | Failed: ${summary.failedCount}`);

  // === Step 4: Collect detailed results ===
  console.log("\n4. Collecting detailed results...");

  const itemResults: ItemResult[] = [];
  const categoryScores: Record<string, { scores: Record<string, number[]>; count: number }> = {};

  for (const result of summary.results || []) {
    const inputStr = typeof result.input === "string"
      ? result.input
      : (result.input?.messages || JSON.stringify(result.input));

    // Find matching dataset item for category
    const matchedItem = partnerAgentDataset.find((d) => {
      const input = typeof result.input === "string" ? result.input : result.input?.messages;
      return input === d.input;
    });
    const category = matchedItem?.category || (result as any).metadata?.category || "unknown";

    const scores: ScoreResult[] = (result.scores || []).map((s: any) => ({
      scorerName: s.scorerName || s.name || "unknown",
      score: s.score,
      reason: s.reason || "",
    }));

    const toolCalls = (result as any).toolCalls?.map((tc: any) => tc.name || tc.toolName || "unknown") || [];
    const output = result.output || result.text || (result as any).targetResult?.text || "";

    itemResults.push({
      input: inputStr,
      groundTruth: matchedItem?.groundTruth || "",
      category,
      output: typeof output === "string" ? output.slice(0, 500) : JSON.stringify(output).slice(0, 500),
      scores,
      toolCalls,
      latencyMs: (result as any).durationMs || 0,
    });

    // Aggregate by category
    if (!categoryScores[category]) {
      categoryScores[category] = { scores: {}, count: 0 };
    }
    categoryScores[category].count++;
    for (const s of scores) {
      if (s.score !== null && s.score !== undefined) {
        if (!categoryScores[category].scores[s.scorerName]) {
          categoryScores[category].scores[s.scorerName] = [];
        }
        categoryScores[category].scores[s.scorerName].push(s.score);
      }
    }
  }

  // === Step 5: Compute aggregate scores ===
  console.log("\n5. Computing aggregate scores...");

  const overallScores: Record<string, { avg: number; min: number; max: number; count: number }> = {};
  for (const item of itemResults) {
    for (const s of item.scores) {
      if (s.score !== null && s.score !== undefined) {
        if (!overallScores[s.scorerName]) {
          overallScores[s.scorerName] = { avg: 0, min: 1, max: 0, count: 0 };
        }
        overallScores[s.scorerName].avg += s.score;
        overallScores[s.scorerName].min = Math.min(overallScores[s.scorerName].min, s.score);
        overallScores[s.scorerName].max = Math.max(overallScores[s.scorerName].max, s.score);
        overallScores[s.scorerName].count++;
      }
    }
  }
  for (const key of Object.keys(overallScores)) {
    overallScores[key].avg = overallScores[key].avg / overallScores[key].count;
  }

  for (const [name, data] of Object.entries(overallScores)) {
    const icon = data.avg >= 0.7 ? "PASS" : data.avg >= 0.4 ? "WARN" : "FAIL";
    console.log(`   [${icon}] ${name}: avg=${data.avg.toFixed(3)} min=${data.min.toFixed(3)} max=${data.max.toFixed(3)}`);
  }

  // === Step 6: Generate markdown report ===
  console.log("\n6. Generating markdown report...");

  const report = generateReport({
    experimentName,
    experimentDurationSec,
    experimentId: summary.experimentId,
    status: summary.status,
    totalItems: summary.totalItems,
    succeededCount: summary.succeededCount,
    failedCount: summary.failedCount,
    overallScores,
    categoryScores,
    itemResults,
    metadata,
    datasetName: DATASET_NAME,
  });

  const reportPath = "EXPERIMENT-REPORT.md";
  writeFileSync(reportPath, report, "utf-8");
  console.log(`\n   Report written to ${reportPath}`);
  console.log("\n=== Pipeline complete ===");
}

function generateReport(data: {
  experimentName: string;
  experimentDurationSec: string;
  experimentId: string;
  status: string;
  totalItems: number;
  succeededCount: number;
  failedCount: number;
  overallScores: Record<string, { avg: number; min: number; max: number; count: number }>;
  categoryScores: Record<string, { scores: Record<string, number[]>; count: number }>;
  itemResults: ItemResult[];
  metadata: any;
  datasetName: string;
}): string {
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const topCities = (data.metadata.cities || []).slice(0, 30);
  const categories = data.metadata.categories || [];
  const sporttypes = data.metadata.sporttypes || [];
  const totalPartners = categories.reduce((sum: number, c: any) => sum + c.count, 0);

  let md = `# Sport Navi Partner Agent — Experiment Report

> Generated: ${now}
> Experiment: \`${data.experimentName}\`
> Duration: ${data.experimentDurationSec}s | Status: **${data.status}**

---

## 1. Executive Summary

The Sport Navi Partner Agent was evaluated across **${data.totalItems} test cases** spanning 8 categories. The agent uses Gemini 2.0 Flash via OpenRouter, backed by a Convex database with live partner data from the Sport Navi API.

| Metric | Value |
|--------|-------|
| Total test cases | ${data.totalItems} |
| Succeeded | ${data.succeededCount} |
| Failed | ${data.failedCount} |
| Duration | ${data.experimentDurationSec}s |

### Overall Scores

| Scorer | Avg | Min | Max | Verdict |
|--------|-----|-----|-----|---------|
`;

  for (const [name, s] of Object.entries(data.overallScores)) {
    const verdict = s.avg >= 0.7 ? "PASS" : s.avg >= 0.4 ? "WARN" : "FAIL";
    md += `| ${name} | ${s.avg.toFixed(3)} | ${s.min.toFixed(3)} | ${s.max.toFixed(3)} | ${verdict} |\n`;
  }

  md += `
---

## 2. Partner Network Coverage

The Sport Navi network currently includes **${totalPartners} active partners** across **${topCities.length}+ cities** in Germany (and a few international locations).

### Categories (${categories.length} total)

| Category | Partner Count | % of Total |
|----------|--------------|------------|
`;

  for (const cat of categories) {
    md += `| ${cat.name} | ${cat.count} | ${((cat.count / totalPartners) * 100).toFixed(1)}% |\n`;
  }

  md += `
### Sport Types (${sporttypes.length} total)

| Sport Type | Partner Count |
|------------|--------------|
`;

  for (const st of sporttypes) {
    md += `| ${st.name} | ${st.count} |\n`;
  }

  md += `
### Top 30 Cities by Partner Count

| City | Partners |
|------|----------|
`;

  for (const city of topCities) {
    md += `| ${city.name} | ${city.count} |\n`;
  }

  md += `
---

## 3. Scores by Category

`;

  for (const [category, catData] of Object.entries(data.categoryScores)) {
    md += `### ${category} (${catData.count} items)\n\n`;
    md += `| Scorer | Avg Score | Verdict |\n`;
    md += `|--------|-----------|---------|\\n`;
    for (const [scorerName, scores] of Object.entries(catData.scores)) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const verdict = avg >= 0.7 ? "PASS" : avg >= 0.4 ? "WARN" : "FAIL";
      md += `| ${scorerName} | ${avg.toFixed(3)} | ${verdict} |\n`;
    }
    md += "\n";
  }

  md += `---

## 4. Detailed Item Results

`;

  for (const item of data.itemResults) {
    const scoresSummary = item.scores
      .map((s) => {
        const icon = s.score !== null ? (s.score >= 0.7 ? "PASS" : s.score >= 0.4 ? "WARN" : "FAIL") : "N/A";
        return `${s.scorerName}: ${s.score?.toFixed(2) ?? "N/A"} (${icon})`;
      })
      .join(" | ");

    md += `#### [${item.category}] "${item.input}"

- **Scores**: ${scoresSummary}
- **Ground Truth**: ${item.groundTruth}
- **Agent Response** (truncated):
\`\`\`
${item.output.slice(0, 300)}${item.output.length > 300 ? "..." : ""}
\`\`\`

`;
  }

  md += `---

## 5. Observability & Traces

- **Experiment ID**: \`${data.experimentId}\`
- **Dataset**: \`${data.datasetName}\`
- **Mastra Studio**: View full traces, tool calls, and token usage at [http://localhost:4111/experiments](http://localhost:4111/experiments)
- **Storage**: Traces persisted in DuckDB (in-memory for observability domain), scores and datasets in LibSQL (\`mastra.db\`)
- **Scorer Models**: Gemini 2.0 Flash (via OpenRouter) as LLM judge for answer relevancy, hallucination, faithfulness, and prompt alignment

### Trace Architecture

\`\`\`
User Query → partnerAgent (Gemini 2.0 Flash)
  ├─ Tool: searchPartners → Convex HTTP → partners table
  ├─ Tool: getPartnerDetails → Convex HTTP → partner details
  ├─ Tool: getMetadata → Convex HTTP → metadata table
  └─ Response → LLM Judge Scorers
       ├─ Answer Relevancy (higher = better)
       ├─ Hallucination (lower = better, 0 = none)
       ├─ Faithfulness (higher = better)
       └─ Prompt Alignment (higher = better)
\`\`\`

---

## 6. Recommendations for Improvement

### High Priority
`;

  // Analyze weak categories
  const weakCategories: string[] = [];
  for (const [category, catData] of Object.entries(data.categoryScores)) {
    for (const [scorer, scores] of Object.entries(catData.scores)) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      if (avg < 0.5) {
        weakCategories.push(`- **${category}** scores low on \`${scorer}\` (avg: ${avg.toFixed(3)}). Review system prompt handling for this category.`);
      }
    }
  }

  if (weakCategories.length > 0) {
    md += weakCategories.join("\n") + "\n";
  } else {
    md += "- All categories pass minimum thresholds. Focus on incremental improvements.\n";
  }

  md += `
### Medium Priority
- Monitor hallucination scores — any score > 0.3 indicates potential fabrication of partner data
- Add more test cases for cities with few partners (edge case: user asks about a city with 1 partner)
- Test agent behavior when Convex backend is slow or unavailable

### Low Priority
- Add trajectory scorers (tool call accuracy) for more granular tool-use evaluation
- Expand multilingual test cases (currently 4 — add Turkish, Arabic, Polish for NRW demographics)
- Add latency benchmarks to track response time regression

---

## 7. Dataset Categories & Coverage Matrix

| Category | Items | Description |
|----------|-------|-------------|
| city-resolution | 7 | Abbreviation/typo → correct city name |
| sport-matching | 5 | Sport/category filter accuracy |
| multilingual | 4 | EN/DE/FR/IT language handling |
| partner-search | 4 | Name-based partner lookup |
| detail-request | 3 | Course/offering detail retrieval |
| no-results | 4 | Edge cases, unknown cities, missing sports |
| off-topic | 1 | Redirect off-topic queries |
| safety | 1 | Prompt injection resistance |
| boundary | 2 | Pricing/booking boundary enforcement |

---

*Report generated by Mastra AI evaluation pipeline. View full traces in Mastra Studio.*
`;

  return md;
}

main().catch((e) => {
  console.error("Pipeline failed:", e.message);
  console.error(e.stack);
  process.exit(1);
});
