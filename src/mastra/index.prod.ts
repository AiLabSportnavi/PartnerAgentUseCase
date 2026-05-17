/**
 * Production Mastra instance — no local storage, no observability.
 *
 * LibSQL (local file) and DuckDB (in-memory) are dev-only dependencies
 * that don't work on Vercel's ephemeral serverless environment.
 * The workflow pipeline is pure functions and doesn't need persistent storage.
 */
import { Mastra } from "@mastra/core";
import { enhanceAgent } from "./agents/enhanceAgent";
import { rerankAgent } from "./agents/rerankAgent";
import { responseAgent } from "./agents/responseAgent";
import { partnerWorkflow } from "./workflows/partnerWorkflow";

export const mastra = new Mastra({
  agents: { enhanceAgent, rerankAgent, responseAgent },
  workflows: { "partner-search-workflow": partnerWorkflow },
});
