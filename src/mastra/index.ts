import { Mastra } from "@mastra/core";
import { MastraCompositeStore } from "@mastra/core/storage";
import { Observability, MastraStorageExporter, SamplingStrategyType } from "@mastra/observability";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { DuckDBStore } from "@mastra/duckdb";
import { enhanceAgent } from "./agents/enhanceAgent";
import { rerankAgent } from "./agents/rerankAgent";
import { responseAgent } from "./agents/responseAgent";
import { partnerWorkflow } from "./workflows/partnerWorkflow";
import {
  answerRelevancy,
  hallucination,
  faithfulness,
  promptAlignment,
  toolCallAccuracy,
} from "../evals/scorers";

// LibSQL: handles datasets, experiments, agents, memory, workflows, etc.
const libsqlStore = new LibSQLStore({
  id: "libsql-store",
  url: `file:${process.cwd()}/mastra.db`,
});

// DuckDB: in-memory for observability (traces, logs, metrics, scores)
// Using :memory: avoids file lock issues between mastra dev bundler and CLI
const duckdbStore = new DuckDBStore({
  id: "duckdb-store",
  path: ":memory:",
});

// Composite storage: LibSQL as default, DuckDB for observability domain
const storage = new MastraCompositeStore({
  id: "composite-store",
  default: libsqlStore,
  domains: {
    observability: duckdbStore.observability,
  },
});

// Logger: Pino with info level — logs are stored in DuckDB via observability
const logger = new PinoLogger({ level: "info" });

// Observability: MastraStorageExporter persists traces + logs to DuckDB
const observability = new Observability({
  configs: {
    default: {
      serviceName: "partner-agent",
      exporters: [new MastraStorageExporter()],
      sampling: { type: SamplingStrategyType.ALWAYS },
      logging: {
        enabled: true,
        level: "info",
      },
    },
  },
});

export const mastra = new Mastra({
  agents: { enhanceAgent, rerankAgent, responseAgent },
  workflows: { "partner-search-workflow": partnerWorkflow },
  storage,
  logger,
  observability,
  scorers: {
    "answer-relevancy-scorer": answerRelevancy,
    "hallucination-scorer": hallucination,
    "faithfulness-scorer": faithfulness,
    "prompt-alignment-scorer": promptAlignment,
    "code-tool-call-accuracy-scorer": toolCallAccuracy,
  },
});
