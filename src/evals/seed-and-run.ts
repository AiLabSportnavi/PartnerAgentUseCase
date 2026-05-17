/**
 * Seed the partner agent eval dataset into Mastra Studio storage
 * and run a full experiment with all scorers.
 *
 * Usage:
 *   npx tsx src/evals/seed-and-run.ts              # seed + run experiment
 *   npx tsx src/evals/seed-and-run.ts --seed-only   # just seed the dataset
 *   npx tsx src/evals/seed-and-run.ts --run-only    # just run experiment (dataset must exist)
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { mastra } from "../mastra/index";
import { partnerAgentDataset } from "./dataset";
// Scorer IDs must match the keys registered in mastra config

const args = process.argv.slice(2);
const seedOnly = args.includes("--seed-only");
const runOnly = args.includes("--run-only");

const DATASET_NAME = "Partner Agent Eval Suite";

async function seedDataset() {
  console.log("📦 Creating dataset in Mastra Studio...\n");

  // Create the dataset
  const dataset = await mastra.datasets.create({
    name: DATASET_NAME,
    description:
      "30 test cases covering city resolution, sport matching, multilingual, partner search, detail requests, edge cases, and safety.",
    targetType: "agent",
    targetIds: ["partnerAgent"],
    scorerIds: [
      "answer-relevancy-scorer",
      "hallucination-scorer",
      "faithfulness-scorer",
      "prompt-alignment-scorer",
      "code-tool-call-accuracy-scorer",
    ],
  });

  console.log(`   Dataset ID: ${dataset.id}`);

  // Add all items in bulk
  const items = partnerAgentDataset.map((item) => ({
    input: { messages: item.input },
    groundTruth: item.groundTruth,
    metadata: { category: item.category },
  }));

  await dataset.addItems({ items });
  console.log(`   Added ${items.length} test cases\n`);

  // Print category breakdown
  const categories = new Map<string, number>();
  for (const item of partnerAgentDataset) {
    categories.set(item.category, (categories.get(item.category) || 0) + 1);
  }
  console.log("   Categories:");
  for (const [cat, count] of categories) {
    console.log(`     ${cat}: ${count} items`);
  }

  return dataset;
}

async function runExperiment(datasetId?: string) {
  let dataset;

  if (datasetId) {
    dataset = await mastra.datasets.get({ id: datasetId });
  } else {
    // Find existing dataset by listing
    const { datasets: allDatasets } = await mastra.datasets.list();
    const found = allDatasets.find((d: any) => d.name === DATASET_NAME);
    if (!found) {
      console.error("❌ Dataset not found. Run with --seed-only first.");
      process.exit(1);
    }
    dataset = await mastra.datasets.get({ id: found.id });
  }

  console.log("\n🧪 Starting experiment...\n");
  console.log("   Target: partnerAgent");
  console.log("   Scorers: answerRelevancy, hallucination, faithfulness, promptAlignment");
  console.log("   ─".repeat(15));

  const startTime = Date.now();

  const summary = await dataset.startExperiment({
    name: `eval-${new Date().toISOString().slice(0, 16)}`,
    description: "Full eval suite run",
    targetType: "agent",
    targetId: "partnerAgent",
    // Scorers are resolved from the dataset's scorerIds set at creation
    maxConcurrency: 2,
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n" + "═".repeat(60));
  console.log("📊 EXPERIMENT RESULTS");
  console.log("═".repeat(60));
  console.log(`   Experiment ID: ${summary.experimentId}`);
  console.log(`   Status: ${summary.status}`);
  console.log(`   Total: ${summary.totalItems} | Passed: ${summary.succeededCount} | Failed: ${summary.failedCount}`);
  console.log(`   Time: ${elapsed}s`);

  // Print per-item results
  console.log("\n📋 Item Results:");
  for (const result of summary.results) {
    const input =
      typeof result.input === "string"
        ? result.input
        : JSON.stringify(result.input);
    const shortInput =
      input.length > 50 ? input.slice(0, 50) + "..." : input;

    console.log(`\n   "${shortInput}"`);
    for (const score of result.scores) {
      const icon =
        score.score !== null
          ? score.score >= 0.7
            ? "✅"
            : score.score >= 0.4
              ? "⚠️"
              : "❌"
          : "❓";
      console.log(
        `     ${icon} ${score.scorerName}: ${score.score?.toFixed(2) ?? "N/A"} ${score.reason ? `— ${score.reason.slice(0, 80)}` : ""}`
      );
    }
  }

  console.log("\n" + "═".repeat(60));
  console.log(
    "\n🔍 View full results in Mastra Studio → Experiments tab"
  );
  console.log("   http://localhost:4111/experiments\n");
}

async function main() {
  if (runOnly) {
    await runExperiment();
  } else if (seedOnly) {
    await seedDataset();
    console.log(
      "\n✅ Dataset seeded! Open Mastra Studio → Datasets to view it."
    );
    console.log("   http://localhost:4111/datasets\n");
  } else {
    const dataset = await seedDataset();
    await runExperiment(dataset.id);
  }
}

main().catch((e) => {
  console.error("❌ Error:", e.message);
  console.error(e.stack);
  process.exit(1);
});
