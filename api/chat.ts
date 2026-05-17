/**
 * Vercel Serverless Function — POST /api/chat
 *
 * Single endpoint for the Sport Navi Partner Agent.
 * Runs the 4-step RAG pipeline (enhance → search → rerank → respond)
 * with conversation history persisted in Convex.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { mastra } from "../src/mastra/index.prod";
import type { WorkflowOutput, ConversationEntry } from "../src/mastra/workflows/schemas";

const CONVEX_SITE_URL = process.env.CONVEX_SITE_URL || "http://127.0.0.1:3211";

async function getConversationHistory(threadId: string): Promise<ConversationEntry[]> {
  try {
    const res = await fetch(
      `${CONVEX_SITE_URL}/api/conversation?threadId=${encodeURIComponent(threadId)}`,
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

async function saveConversationHistory(
  threadId: string,
  history: ConversationEntry[],
): Promise<void> {
  try {
    await fetch(`${CONVEX_SITE_URL}/api/conversation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, history }),
    });
  } catch {
    // Non-critical — conversation will work without history on next turn
  }
}

async function runWorkflow(
  message: string,
  threadId: string,
  history: ConversationEntry[],
): Promise<WorkflowOutput> {
  const workflow = mastra.getWorkflow("partner-search-workflow");
  const run = await workflow.createRun();
  const result = await run.start({
    inputData: {
      message,
      threadId,
      resourceId: "api-user",
      conversationHistory: history,
    },
  });

  if (result.status !== "success") {
    throw new Error(
      result.status === "failed"
        ? (result as any).error?.message || "Workflow failed"
        : `Unexpected: ${result.status}`,
    );
  }

  return result.result as WorkflowOutput;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const { message, threadId = `thread-${Date.now()}` } = req.body || {};

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }

  try {
    // 1. Load conversation history from Convex
    const history = await getConversationHistory(threadId);

    // 2. Run the 4-step workflow
    const output = await runWorkflow(message, threadId, history);

    // 3. Update conversation history in Convex
    const updatedHistory = [...history];
    updatedHistory.push({ role: "user", content: message });
    updatedHistory.push({
      role: "assistant",
      content: output.text,
      retrievedPartners: output.memoryPayload?.retrievedPartners || [],
    });
    // Keep last 20 entries
    while (updatedHistory.length > 20) {
      updatedHistory.shift();
    }
    await saveConversationHistory(threadId, updatedHistory);

    // 4. Return response
    return res.status(200).json({
      text: output.text,
      intent: output.intent,
      confidence: output.confidence,
      selfCorrected: output.selfCorrected,
      threadId,
    });
  } catch (err: any) {
    console.error("Workflow error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
