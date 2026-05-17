/**
 * Chat API server — serves the frontend and exposes POST /api/chat
 * that connects to the Mastra v3 workflow.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { createServer } from "http";
import { readFileSync } from "fs";
import { join } from "path";
import { mastra } from "./mastra/index";
import type { WorkflowOutput, ConversationEntry } from "./mastra/workflows/schemas";

const PORT = Number(process.env.PORT) || 3000;

// In-memory session store (threadId → conversationHistory)
const sessions = new Map<string, ConversationEntry[]>();

async function runWorkflow(
  message: string,
  threadId: string,
  resourceId: string,
): Promise<WorkflowOutput> {
  // Get or create session
  if (!sessions.has(threadId)) {
    sessions.set(threadId, []);
  }
  const history = sessions.get(threadId)!;

  const workflow = mastra.getWorkflow("partner-search-workflow");
  const run = await workflow.createRun();
  const result = await run.start({
    inputData: {
      message,
      threadId,
      resourceId,
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

  const output = result.result as WorkflowOutput;

  // Save to session memory for next turn
  history.push({ role: "user", content: message });
  history.push({
    role: "assistant",
    content: output.text,
    retrievedPartners: output.memoryPayload?.retrievedPartners || [],
  });
  // Keep last 20 entries
  while (history.length > 20) {
    history.shift();
  }

  return output;
}

const server = createServer(async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // POST /api/chat — run the workflow
  if (req.method === "POST" && req.url === "/api/chat") {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString());

      const { message, threadId = `thread-${Date.now()}` } = body;
      if (!message) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "message is required" }));
        return;
      }

      const output = await runWorkflow(message, threadId, "web-user");

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          text: output.text,
          intent: output.intent,
          confidence: output.confidence,
          selfCorrected: output.selfCorrected,
          memoryPayload: output.memoryPayload,
        }),
      );
    } catch (err: any) {
      console.error("Workflow error:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET / — serve the chat UI
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    try {
      const html = readFileSync(
        join(process.cwd(), "stitch_sport_navi_partner_chat", "code.html"),
        "utf-8",
      );
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(404);
      res.end("Chat UI not found");
    }
    return;
  }

  // 404
  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`\n🚀 Sport Navi Chat Server running at http://localhost:${PORT}`);
  console.log(`   Chat UI:  http://localhost:${PORT}/`);
  console.log(`   Chat API: POST http://localhost:${PORT}/api/chat`);
  console.log(`\n   Make sure Convex is running: npx convex dev --typecheck=disable\n`);
});
