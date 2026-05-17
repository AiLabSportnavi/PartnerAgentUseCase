import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { runEvals } from "@mastra/core/evals";
import { mastra } from "../mastra/mastraDev";
const partnerAgent = mastra.getAgent("responseAgent"); // evals target the response agent
import { partnerAgentDataset } from "./dataset";
import { allScorers } from "./scorers";

async function main() {
  const args = process.argv.slice(2);
  const categoryFilter = args[0]; // Optional: run only one category
  const concurrency = parseInt(args[1] || "3"); // Parallel eval items

  let dataset = partnerAgentDataset;
  if (categoryFilter) {
    dataset = dataset.filter((item) => item.category === categoryFilter);
    console.log(`\n🎯 Filtering to category: "${categoryFilter}" (${dataset.length} items)\n`);
  } else {
    console.log(`\n🧪 Running full eval suite: ${dataset.length} test cases\n`);
  }

  console.log("Scorers: answer-relevancy, hallucination, faithfulness");
  console.log(`Concurrency: ${concurrency}`);
  console.log("─".repeat(60));

  const startTime = Date.now();
  let completedCount = 0;

  const results = await runEvals({
    target: partnerAgent,
    data: dataset.map((item) => ({
      input: item.input,
      groundTruth: item.groundTruth,
    })),
    scorers: allScorers,
    concurrency,
    onItemComplete: ({ item, targetResult, scorerResults }) => {
      completedCount++;
      const input =
        typeof item.input === "string"
          ? item.input
          : JSON.stringify(item.input);
      const truncatedInput =
        input.length > 50 ? input.slice(0, 50) + "..." : input;

      console.log(
        `\n[${completedCount}/${dataset.length}] "${truncatedInput}"`
      );
      console.log(`  Response: ${targetResult.text?.slice(0, 100)}...`);

      // Print individual scores
      for (const [scorerName, result] of Object.entries(scorerResults)) {
        const score =
          typeof result === "object" && result?.score !== undefined
            ? result.score
            : result;
        const icon =
          typeof score === "number"
            ? score >= 0.7
              ? "✅"
              : score >= 0.4
                ? "⚠️"
                : "❌"
            : "❓";
        console.log(`  ${icon} ${scorerName}: ${score}`);
      }
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n" + "═".repeat(60));
  console.log("📊 EVAL SUMMARY");
  console.log("═".repeat(60));
  console.log(`Total items: ${results.summary.totalItems}`);
  console.log(`Time: ${elapsed}s`);
  console.log("\nAggregate Scores:");

  for (const [scorerName, scoreData] of Object.entries(results.scores)) {
    const score =
      typeof scoreData === "object" && scoreData?.score !== undefined
        ? scoreData.score
        : scoreData;
    const icon =
      typeof score === "number"
        ? score >= 0.7
          ? "✅"
          : score >= 0.4
            ? "⚠️"
            : "❌"
        : "❓";
    console.log(`  ${icon} ${scorerName}: ${score}`);
  }

  console.log("\n" + "═".repeat(60));
}

main().catch((e) => {
  console.error("❌ Eval failed:", e.message);
  process.exit(1);
});
