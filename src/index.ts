import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { mastra } from "./mastra/index";
import { createInterface } from "readline";
import type { WorkflowOutput, ConversationEntry } from "./mastra/workflows/schemas";

const threadId = `thread-${Date.now()}`;
const resourceId = "cli-user";
const conversationHistory: ConversationEntry[] = [];

/**
 * Run the v3 RAG pipeline: enhance → search → rerank → respond
 */
async function runWorkflow(message: string): Promise<WorkflowOutput> {
  const workflow = mastra.getWorkflow("partner-search-workflow");
  const run = await workflow.createRun();
  const result = await run.start({
    inputData: {
      message,
      threadId,
      resourceId,
      conversationHistory,
    },
  });

  if (result.status === "success") {
    const output = result.result as WorkflowOutput;

    // Memory feedback: store what was shown for next turn
    conversationHistory.push({ role: "user", content: message });
    conversationHistory.push({
      role: "assistant",
      content: output.text,
      retrievedPartners: output.memoryPayload?.retrievedPartners || [],
    });
    while (conversationHistory.length > 20) {
      conversationHistory.shift();
    }

    return output;
  }

  const errorMsg =
    result.status === "failed"
      ? (result as any).error?.message || "Workflow failed"
      : `Unexpected status: ${result.status}`;
  throw new Error(errorMsg);
}

async function main() {
  const singleQuery = process.argv[2];

  if (singleQuery) {
    console.log(`\n🚀 Query: "${singleQuery}"\n---`);
    const result = await runWorkflow(singleQuery);
    console.log(result.text);
    console.log(
      `  [intent: ${result.intent} | confidence: ${result.confidence}${result.selfCorrected ? " | self-corrected" : ""}]`,
    );
    console.log("\n---");
    return;
  }

  // Interactive chat mode
  console.log("\n🚀 Sport Navi Partner Agent (v3 RAG pipeline)");
  console.log("   Pipeline: enhance → search → rerank → respond");
  console.log("   Type 'quit' to exit\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    rl.question("You: ", async (input) => {
      const msg = input.trim();
      if (!msg || msg === "quit" || msg === "exit") {
        console.log("\nBye! 🏃");
        rl.close();
        return;
      }

      try {
        const result = await runWorkflow(msg);
        console.log(`\nAgent: ${result.text}`);
        console.log(
          `  [intent: ${result.intent}${result.selfCorrected ? " | self-corrected" : ""}]`,
        );
        console.log();
      } catch (e: any) {
        console.log(`\nError: ${e.message}\n`);
      }

      ask();
    });
  };

  ask();
}

main().catch(console.error);
